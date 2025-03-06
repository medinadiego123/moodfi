require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");
const path = require("path");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const { OpenAI } = require("openai");

// API Keys from .env
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

const app = express();
const port = process.env.PORT || 3000;

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const isProduction = process.env.NODE_ENV === "production";
const REDIRECT_URI = isProduction
  ? "https://moodfi.vercel.app/callback"
  : "http://localhost:3000/callback";
const JWT_SECRET = process.env.JWT_SECRET;
const SCOPES = "user-top-read playlist-modify-public playlist-modify-private";

// OpenAI API Setup
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Set EJS as the view engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "../views"));
app.use(express.static(path.join(__dirname, "../public")));

// Home Route
app.get("/", (req, res) => {
  const token = req.cookies.token;
  res.render("index", { tracks: [], moodSelected: false, playlistId: null, isLoggedIn: Boolean(token) });
});

// Spotify Authentication
app.get("/login", (req, res) => {
  const mood = req.query.mood || "";
  const authUrl = `https://accounts.spotify.com/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(
    REDIRECT_URI
  )}&scope=${SCOPES}&state=${mood}`;
  res.redirect(authUrl);
});

// Callback Route for Spotify Authentication
app.get("/callback", async (req, res) => {
  const code = req.query.code;
  const mood = req.query.state || "";
  if (!code) return res.redirect("/login");

  try {
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64"),
      },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI }),
    });
    const data = await response.json();
    if (data.access_token) {
      const token = jwt.sign({ accessToken: data.access_token, refreshToken: data.refresh_token }, JWT_SECRET, { expiresIn: "1h" });
      res.cookie("token", token, { httpOnly: true, secure: isProduction });
      return res.redirect(`/generate?mood=${mood}`);
    } else {
      res.send("Authorization failed: Unable to obtain access token");
    }
  } catch (error) {
    res.send("Authorization error");
  }
});

async function refreshAccessToken(refreshToken) {
  try {
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64"),
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    });
    const data = await response.json();
    if (!data.access_token) {
      console.error("Failed to refresh token:", data);
    }
    return data.access_token;
  } catch (error) {
    console.error("Error refreshing access token:", error);
    return null;
  }
}

/**
 * Generates a playlist name based on the current day of the week.
 * For example, if today is Friday, it returns "Your Friday Playlist🤘🎶".
 *
 * @returns {string} - The generated playlist name.
 */
function generateDayPlaylistName() {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const today = new Date();
  const dayName = days[today.getDay()];
  return `Your ${dayName} Playlist🤘🎶`;
}

// AI Mood Analysis with Fallback Chain: OpenAI → Gemini → DeepSeek → Manual
async function analyzeMood(userInput) {
  const prompt = `
    Analyze the user input and extract:
    - Mood (e.g., happy, sad, chill, energetic)
    - Genre if mentioned (e.g., rap, rock, EDM, R&B)
    - Artist if mentioned (e.g., Future, Drake)

    Now analyze: "${userInput}"
    Return JSON format:
    {
        "mood": "detected_mood",
        "genre": "detected_genre_or_null",
        "artist": "detected_artist_or_null"
    }`;
  try {
    console.log("🔵 Trying OpenAI for Mood Analysis...");
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "system", content: prompt }],
    });
    return JSON.parse(response.choices[0].message.content);
  } catch (openaiError) {
    console.error("❌ OpenAI API failed:", openaiError.message);
    try {
      console.log("🟢 Trying Gemini API...");
      const geminiResult = await callGemini(userInput);
      return geminiResult;
    } catch (geminiError) {
      console.error("❌ Gemini API failed:", geminiError.message);
      try {
        console.log("🟡 Trying DeepSeek API...");
        const deepSeekResult = await callDeepSeek(userInput);
        return deepSeekResult;
      } catch (deepSeekError) {
        console.error("❌ DeepSeek API failed:", deepSeekError.message);
        console.log("Falling back to manual extraction.");
        return extractMoodFromKeywords(userInput);
      }
    }
  }
}

async function callGemini(userInput) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
  const payload = {
    contents: [
      {
        parts: [
          { text: `Analyze: "${userInput}". Extract mood, genre, and artist in JSON format.` }
        ]
      }
    ]
  };
  try {
    const response = await axios.post(url, payload, { headers: { "Content-Type": "application/json" } });
    console.log("Gemini response data:", response.data);
    if (!response.data.candidates || !response.data.candidates.length) {
      throw new Error("No candidates returned from Gemini API");
    }
    let candidateContent = response.data.candidates[0].content;
    if (typeof candidateContent === "object" && candidateContent.parts && candidateContent.parts.length > 0) {
      candidateContent = candidateContent.parts[0].text;
    }
    candidateContent = candidateContent.replace(/```json\s*/, "").replace(/\s*```/, "").trim();
    return JSON.parse(candidateContent);
  } catch (error) {
    console.error("Error calling Gemini API:", error.response ? error.response.data : error.message);
    throw error;
  }
}

async function callDeepSeek(userInput) {
  try {
    const response = await axios.post(
      "https://api.deepseek.com/v1/chat/completions",
      {
        model: "deepseek-chat",
        messages: [{ role: "system", content: `Analyze: "${userInput}". Extract mood, genre, and artist in JSON format.` }],
      },
      { headers: { Authorization: `Bearer ${DEEPSEEK_API_KEY}`, "Content-Type": "application/json" } }
    );
    return JSON.parse(response.data.choices[0].message.content);
  } catch (error) {
    console.error("Error calling DeepSeek API:", error.response ? error.response.data : error.message);
    throw error;
  }
}

function extractMoodFromKeywords(userInput) {
  const keywords = userInput.toLowerCase().split(" ");
  const moods = ["happy", "sad", "chill", "energetic", "angry"];
  const detectedMood = moods.find(mood => keywords.includes(mood)) || "chill";
  return { mood: detectedMood, genre: null, artist: null };
}

// Playlist Generation Route
app.get("/generate", async (req, res) => {
  const mood = req.query.mood;
  if (!mood) return res.redirect("/");

  const token = req.cookies.token;
  if (!token) return res.redirect("/login");

  let accessToken, refreshToken, playlistId = null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    accessToken = decoded.accessToken;
    refreshToken = decoded.refreshToken;
  } catch (error) {
    return res.redirect("/login");
  }

  console.log("User input for mood:", mood);
  const moodData = await analyzeMood(mood);
  console.log("AI Mood Data:", moodData);

  // Use weekday-based naming for a short, clean playlist name.
  const playlistName = generateDayPlaylistName();
  console.log("Final Playlist Name:", playlistName);

  playlistId = await createPlaylist(playlistName, accessToken);
  if (!playlistId) {
    console.error("🚨 Failed to create a valid playlist ID.");
    return res.redirect("/");
  }
  console.log("Final Playlist ID:", playlistId);

  // Get user's listening history seeds.
  const userSeeds = await getUserTopArtistsAndTracks(accessToken);
  let trackUris = await searchTracks(moodData.mood, userSeeds, accessToken, mood);

  if (!trackUris || trackUris.length === 0) {
    console.warn("⚠ No tracks found, falling back to default.");
    trackUris = await fetchAdditionalTracks(["pop"], 10, accessToken);
  }
  if (!trackUris || trackUris.length === 0) {
    console.error("❌ No valid tracks to add. Redirecting back.");
    return res.redirect("/");
  }
  console.log("🎵 Track URIs to be added:", trackUris);

  const tracksAdded = await addTracksToPlaylist(playlistId, trackUris, accessToken);
  if (!tracksAdded) {
    console.error("🚨 Failed to add tracks to playlist.");
    return res.redirect("/");
  }

  return res.redirect(`/playlist?playlistId=${playlistId}`);
});

// New route for displaying the playlist separately
app.get("/playlist", (req, res) => {
  const token = req.cookies.token;
  const playlistId = req.query.playlistId;
  if (!playlistId) return res.redirect("/");

  res.render("playlist", {
    playlistId: playlistId,
    isLoggedIn: Boolean(token)
  });
});

// Helper function to fetch additional tracks if needed
async function fetchAdditionalTracks(genres, requiredCount, accessToken) {
  let additionalTracks = [];
  let remainingCount = requiredCount;
  let attempts = 0;
  try {
    while (remainingCount > 0 && attempts < 3) {
      const url = `https://api.spotify.com/v1/recommendations?limit=${Math.min(remainingCount, 5)}&seed_genres=${genres.slice(0, 3).join(",")}`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await response.json();
      if (Array.isArray(data.tracks) && data.tracks.length > 0) {
        additionalTracks = additionalTracks.concat(data.tracks);
        remainingCount -= data.tracks.length;
      } else {
        console.warn("No additional tracks found. Stopping fetch.");
        break;
      }
      attempts++;
    }
    return additionalTracks.slice(0, requiredCount);
  } catch (error) {
    console.error("Error fetching additional tracks:", error);
    return [];
  }
}

// Updated searchTracks function to use the original query for precision
async function searchTracks(mood, userSeeds, accessToken, originalQuery) {
  const params = { limit: 10 };

  // Define known genre keywords (expand as needed)
  const knownGenres = ["shoegaze", "hip-hop", "rap", "edm", "pop", "rock", "r&b", "jazz", "folk", "electronic"];
  let selectedGenre = null;
  const queryLower = originalQuery.toLowerCase();
  for (const genre of knownGenres) {
    if (queryLower.includes(genre)) {
      selectedGenre = genre;
      break;
    }
  }

  if (userSeeds.topArtists.length > 0 || userSeeds.topTracks.length > 0) {
    params.seed_artists = userSeeds.topArtists.slice(0, 2).join(",");
    params.seed_tracks = userSeeds.topTracks.slice(0, 2).join(",");
  } else {
    console.log("⚠ New user detected. Using default genres.");
    // Use the detected genre if available, otherwise fallback to the mood mapping.
    if (selectedGenre) {
      params.seed_genres = selectedGenre;
    } else {
      const moodGenres = {
        happy: ["pop", "indie-pop", "funk", "soul", "disco", "electropop"],
        sad: ["shoegaze", "folk", "acoustic", "melancholia", "blues", "piano"],
        angry: ["metal", "punk", "hardcore", "rock", "grunge", "industrial"],
        chill: ["lo-fi", "chill", "ambient", "jazz", "soul", "downtempo"],
        energetic: ["edm", "dance", "hip-hop", "house", "trap", "drill"],
      };
      params.seed_genres = (moodGenres[mood] || ["pop"]).slice(0, 3).join(",");
    }
  }

  // Apply default mood attributes (customize if needed)
  Object.assign(params, { min_valence: 0.4, max_valence: 0.6 });
  const queryStr = new URLSearchParams(params).toString();
  const url = `https://api.spotify.com/v1/recommendations?${queryStr}`;

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await response.json();
    console.log(`✅ Received ${data.tracks?.length || 0} tracks from Spotify API.`);
    return data.tracks ? data.tracks.map(track => track.uri) : [];
  } catch (error) {
    console.error("❌ Error fetching recommendations:", error);
    return [];
  }
}

async function addTracksToPlaylist(playlistId, trackUris, accessToken, retries = 3) {
  try {
    if (!playlistId) {
      throw new Error("⚠️ No valid playlist ID provided.");
    }
    if (!trackUris || trackUris.length === 0) {
      throw new Error("⚠️ No track URIs provided. Playlist will be empty.");
    }
    console.log("🎵 Adding tracks to playlist:", playlistId);
    console.log("📜 Tracks to add:", trackUris);
    const url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks`;
    const requestBody = { uris: trackUris };
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
    const data = await response.json();
    if (data.error) {
      console.error("🚨 Spotify API Error:", data.error);
      if (data.error.status === 429 && retries > 0) {
        console.warn("⏳ Rate limited. Retrying in 5 seconds...");
        await new Promise(resolve => setTimeout(resolve, 5000));
        return addTracksToPlaylist(playlistId, trackUris, accessToken, retries - 1);
      }
      throw new Error(`Failed to add tracks: ${data.error.message}`);
    }
    console.log("✅ Tracks added successfully!");
    return true;
  } catch (error) {
    console.error("❌ Error adding tracks to playlist:", error.message);
    if (retries > 0) {
      console.warn(`🔄 Retrying... (${retries} attempts left)`);
      return addTracksToPlaylist(playlistId, trackUris, accessToken, retries - 1);
    }
    return false;
  }
}

async function fetchArtistTopTracks(artistName, accessToken) {
  try {
    const searchResponse = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(artistName)}&type=artist&limit=1`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const searchData = await searchResponse.json();
    if (!searchData.artists.items.length) {
      console.error("Artist not found.");
      return [];
    }
    const artistId = searchData.artists.items[0].id;
    const topTracksResponse = await fetch(`https://api.spotify.com/v1/artists/${artistId}/top-tracks?market=US`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const topTracksData = await topTracksResponse.json();
    return topTracksData.tracks.slice(0, 10);
  } catch (error) {
    console.error("Error fetching artist's top tracks:", error);
    return [];
  }
}

async function getUserTopArtistsAndTracks(accessToken) {
  try {
    const [topArtistsResponse, topTracksResponse] = await Promise.all([
      fetch(`https://api.spotify.com/v1/me/top/artists?limit=5`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
      fetch(`https://api.spotify.com/v1/me/top/tracks?limit=5`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    ]);
    if (!topArtistsResponse.ok || !topTracksResponse.ok) {
      throw new Error("❌ Failed to fetch user’s top artists or tracks.");
    }
    const topArtistsData = await topArtistsResponse.json();
    const topTracksData = await topTracksResponse.json();
    return {
      topArtists: Array.isArray(topArtistsData.items) ? topArtistsData.items.map(artist => artist.id) : [],
      topTracks: Array.isArray(topTracksData.items) ? topTracksData.items.map(track => track.id) : [],
    };
  } catch (error) {
    console.error("❌ Error retrieving user’s top artists and tracks:", error);
    return { topArtists: [], topTracks: [] };
  }
}

async function createPlaylist(name, accessToken, retries = 3) {
  try {
    const userId = await getUserId(accessToken);
    console.log("🆔 Spotify User ID:", userId);
    const url = `https://api.spotify.com/v1/users/${userId}/playlists`;
    const requestBody = {
      name: name,
      public: true,
      description: "Mood-based playlist generated by Moodfi",
    };
    console.log(`📡 Attempting to create playlist: "${name}" (Retries left: ${retries})...`);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
    const data = await response.json();
    if (data.error) {
      console.error("🚨 Spotify API Error:", data.error);
      if (data.error.status === 429 && retries > 0) {
        console.warn("⏳ Rate limited. Retrying in 5 seconds...");
        await new Promise(resolve => setTimeout(resolve, 5000));
        return createPlaylist(name, accessToken, retries - 1);
      }
      throw new Error(`Failed to create playlist: ${data.error.message}`);
    }
    if (!data.id) {
      console.error("⚠ Unexpected API response:", data);
      throw new Error("Playlist creation failed - No playlist ID returned");
    }
    console.log("✅ Playlist Created Successfully:", data.id);
    return data.id;
  } catch (error) {
    console.error("❌ Error creating playlist:", error.message);
    if (retries > 0) {
      console.warn(`🔄 Retrying... (${retries} attempts left)`);
      return createPlaylist(name, accessToken, retries - 1);
    }
    return null;
  }
}

async function getUserId(accessToken) {
  try {
    const response = await fetch(`https://api.spotify.com/v1/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await response.json();
    return data.id;
  } catch (error) {
    console.error("Error fetching user ID:", error);
    throw new Error("Failed to get Spotify user ID");
  }
}

// Privacy Policy
app.get("/privacy", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/privacy.html"));
});

// Terms of Service
app.get("/terms", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/terms.html"));
});

// Logout Route
app.get("/logout", (req, res) => {
  res.clearCookie("token", { httpOnly: true, secure: isProduction });
  req.session = null;
  console.log("✅ User successfully logged out. Session and cookies cleared.");
  const SPOTIFY_LOGOUT_URL = "https://accounts.spotify.com/en/logout";
  const MOODFI_HOMEPAGE = isProduction ? "https://moodfi.vercel.app" : "http://localhost:3000";
  res.redirect(`${SPOTIFY_LOGOUT_URL}?continue=${encodeURIComponent(MOODFI_HOMEPAGE)}`);
});

app.listen(port, () => {
  console.log(`🚀 Moodfi server running at http://localhost:${port}`);
});
