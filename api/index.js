require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");
const path = require("path");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");

const app = express();
const port = process.env.PORT || 3000;

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const isProduction = process.env.NODE_ENV === 'production';
const REDIRECT_URI = isProduction 
    ? 'https://moodfi.vercel.app/callback'  // Vercel Production URL
    : 'http://localhost:3000/callback';     // Local Testing URL
const JWT_SECRET = process.env.JWT_SECRET;
const SCOPES = "user-top-read playlist-modify-public playlist-modify-private";

app.use(cookieParser());
app.use(express.json()); //  Ensure JSON request handling
app.use(express.urlencoded({ extended: true })); //  Ensure form data handling

// Set EJS as the view engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "../views"));
app.use(express.static(path.join(__dirname, "../public")));

//  Ensure Root Route is Working
app.get("/", (req, res) => {
    res.render("index");
});

//  Ensure Spotify Auth Works
app.get('/login', (req, res) => {
    console.log("Redirecting to Spotify authorization");
    const mood = req.query.mood || '';
    const authUrl = `https://accounts.spotify.com/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${SCOPES}&state=${mood}`;
    console.log(`Redirecting to: ${authUrl}`);  // ✅ Debug log
    res.redirect(authUrl);
});

//  Ensure Callback Handling Works
app.get("/callback", async (req, res) => {
    const code = req.query.code;
    const mood = req.query.state || "";

    if (!code) {
        console.log("Authorization code is missing. Redirecting to /login.");
        return res.redirect("/login");
    }

    try {
        const response = await fetch("https://accounts.spotify.com/api/token", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Authorization: "Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64"),
            },
            body: new URLSearchParams({
                grant_type: "authorization_code",
                code: code,
                redirect_uri: REDIRECT_URI,
            }),
        });

        const data = await response.json();
        if (data.access_token) {
            const token = jwt.sign(
                {
                    accessToken: data.access_token,
                    refreshToken: data.refresh_token,
                },
                JWT_SECRET,
                { expiresIn: "1h" }
            );

            res.cookie("token", token, { httpOnly: true, secure: process.env.NODE_ENV === "production" });
            console.log("JWT sent as cookie");
            return res.redirect(`/generate?mood=${mood}`);
        } else {
            console.error("Failed to obtain access token:", data);
            res.send("Authorization failed: Unable to obtain access token");
        }
    } catch (error) {
        console.error("Error during Spotify authorization:", error);
        res.send("Authorization error");
    }
});

//  Ensure Server Stays Running
app.listen(port, () => {
    console.log(`🚀 Moodfi server running at http://localhost:${port}`);
});

// Route to generate a playlist
app.get('/generate', async (req, res) => {
    const mood = req.query.mood;

    // Get JWT from cookies
    const token = req.cookies.token;
    if (!token) {
        console.error("JWT is missing. Redirecting to login.");
        return res.redirect('/login');
    }

    let accessToken, refreshToken;

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        accessToken = decoded.accessToken;
        refreshToken = decoded.refreshToken;
    } catch (error) {
        console.error("Error verifying JWT:", error);
        return res.redirect('/login');
    }

    console.log("Generating playlist with access token:", accessToken);

    try {
        const userSeeds = await getUserTopArtistsAndTracks(accessToken);

        // 🛑 Ensure userSeeds properties exist
        userSeeds.topArtists = userSeeds.topArtists || [];
        userSeeds.topTracks = userSeeds.topTracks || [];

        console.log("User Seeds:", userSeeds);

        // ✅ Check if user has any history; otherwise, use mood-based genres
        const recommendations = await searchTracks(mood, userSeeds, accessToken);
        console.log("Recommendations:", recommendations);

        if (!recommendations || recommendations.length === 0) {
            console.error("No recommendations found, redirecting to /");
            return res.redirect('/');
        }

        const trackUris = recommendations.map(track => track.uri);
        const playlistName = `Moodfi - ${mood.charAt(0).toUpperCase() + mood.slice(1)} Playlist`;
        const playlistId = await createPlaylist(playlistName, accessToken);
        await addTracksToPlaylist(playlistId, trackUris, accessToken);

        res.redirect(`https://open.spotify.com/playlist/${playlistId}`);
    } catch (error) {
        console.error('Error generating playlist:', error);
        res.send('Error generating playlist: ' + error.message);
    }
});


// Helper function to refresh the access token if needed
async function refreshAccessToken(refreshToken) {
    const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
        },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken
        })
    });

    const data = await response.json();
    if (data.access_token) {
        return data.access_token;
    } else {
        throw new Error('Failed to refresh access token');
    }
}

// Get user's top artists and tracks to use as seeds
async function getUserTopArtistsAndTracks(accessToken) {
    try {
        const [topArtistsResponse, topTracksResponse] = await Promise.all([
            fetch(`https://api.spotify.com/v1/me/top/artists?limit=5`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }),
            fetch(`https://api.spotify.com/v1/me/top/tracks?limit=5`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            })
        ]);

        // 🛑 Log Full API Responses for Debugging
        const topArtistsText = await topArtistsResponse.text();
        const topTracksText = await topTracksResponse.text();
        console.log("🔹 Raw Spotify Response (Artists):", topArtistsText);
        console.log("🔹 Raw Spotify Response (Tracks):", topTracksText);

        // Try parsing JSON safely
        const topArtistsData = JSON.parse(topArtistsText);
        const topTracksData = JSON.parse(topTracksText);

        const topArtists = topArtistsData.items ? topArtistsData.items.map(artist => artist.id) : [];
        const topTracks = topTracksData.items ? topTracksData.items.map(track => track.id) : [];

        return { topArtists, topTracks };
    } catch (error) {
        console.error("Error retrieving user’s top artists and tracks:", error);
        return { topArtists: [], topTracks: [] }; // Return empty arrays to prevent crashes
    }
}


// Helper function to ensure 10 songs if initial fetch lacks them
async function fetchAdditionalTracks(genres, requiredCount, accessToken) {
    let additionalTracks = [];
    let remainingCount = requiredCount;

    try {
        while (remainingCount > 0) {
            const url = `https://api.spotify.com/v1/recommendations?limit=${remainingCount}&seed_genres=${genres.slice(0, 3).join(',')}`;
            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            const data = await response.json();

            if (Array.isArray(data.tracks) && data.tracks.length > 0) {
                additionalTracks = additionalTracks.concat(data.tracks);
                remainingCount -= data.tracks.length;
            } else {
                console.warn("No additional tracks found in response.");
                break;
            }
        }

        return additionalTracks.slice(0, requiredCount);
    } catch (error) {
        console.error("Error fetching additional tracks:", error);
        return [];
    }
}

// Refined `searchTracks` function with user-based seeds and mood attributes
async function searchTracks(mood, userSeeds, accessToken) {
    const params = { limit: 10 }; // Always request 10 tracks

    // Determine if the user has listening history
    const isExistingUser = userSeeds.topArtists.length > 0 || userSeeds.topTracks.length > 0;

    // Mood-based genres (ensuring we have enough variety)
    const moodGenres = {
        happy: ['pop', 'indie-pop', 'funk', 'soul', 'disco', 'electropop'],
        sad: ['shoegaze', 'folk', 'acoustic', 'melancholia', 'blues', 'piano'],
        angry: ['metal', 'punk', 'hardcore', 'rock', 'grunge', 'industrial'],
        chill: ['lo-fi', 'chill', 'ambient', 'jazz', 'soul', 'downtempo'],
        energetic: ['edm', 'dance', 'hip-hop', 'house', 'trap', 'drill']
    };

    if (isExistingUser) {
        params.seed_artists = userSeeds.topArtists.slice(0, 2).join(',');
        params.seed_tracks = userSeeds.topTracks.slice(0, 2).join(',');
    } else {
        console.log("User has no history. Using mood-based genres.");
        params.seed_genres = moodGenres[mood].slice(0, 3).join(',');
    }

    // Apply mood-based attributes (flexible ranges)
    const moodAttributes = {
        happy: { min_valence: 0.6, min_energy: 0.5, min_tempo: 120, max_tempo: 160 },
        sad: { max_valence: 0.4, max_energy: 0.6, min_acousticness: 0.3, max_tempo: 100 },
        chill: { max_energy: 0.5, min_acousticness: 0.3, max_tempo: 110 },
        energetic: { min_energy: 0.7, min_tempo: 130 },
        angry: { min_energy: 0.8, min_loudness: -5, min_tempo: 140 }
    };

    Object.assign(params, moodAttributes[mood]);

    const query = new URLSearchParams(params).toString();
    const url = `https://api.spotify.com/v1/recommendations?${query}`;

    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        const data = await response.json();

        // Ensure at least 10 songs
        if (!data.tracks || data.tracks.length < 10) {
            console.warn(`Only ${data.tracks ? data.tracks.length : 0} tracks found. Fetching more.`);
            const additionalTracks = await fetchAdditionalTracks(moodGenres[mood], 10 - (data.tracks ? data.tracks.length : 0), accessToken);
            return (data.tracks || []).concat(additionalTracks).slice(0, 10);
        }

        return data.tracks.slice(0, 10);
    } catch (error) {
        console.error("Error fetching recommendations:", error);
        return [];
    }
}
// Create a new playlist in Spotify
async function createPlaylist(name, accessToken) {
    const userId = await getUserId(accessToken);
    const response = await fetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name, public: true, description: 'Mood-based playlist generated by Moodfi' })
    });
    const data = await response.json();
    return data.id;
}

// Get Spotify user ID
async function getUserId(accessToken) {
    const response = await fetch(`https://api.spotify.com/v1/me`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const data = await response.json();
    return data.id;
}

// Add tracks to Spotify playlist
async function addTracksToPlaylist(playlistId, trackUris, accessToken) {
    await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uris: trackUris })
    });
}


// Terms of Service page
app.get('/terms', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/terms.html'));
});

// Privacy Policy page
app.get('/privacy', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/privacy.html'));
});

// Logout Route
app.get('/logout', (req, res) => {
    // 1️⃣ Clear the JWT cookie
    res.clearCookie('token', { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
    console.log("✅ User logged out and cookie cleared");

    // 2️⃣ Determine Redirect Based on Environment
    const isProduction = process.env.NODE_ENV === 'production';
    const REDIRECT_AFTER_LOGOUT = isProduction 
        ? "https://moodfi.vercel.app"   // ✅ Redirect to the live Moodfi site in production
        : "http://localhost:3000";       // ✅ Redirect to local dev site in development

    // 3️⃣ Redirect to Spotify’s Logout Page, Then Back to Moodfi
    const SPOTIFY_LOGOUT_URL = "https://accounts.spotify.com/en/logout";
    res.redirect(`${SPOTIFY_LOGOUT_URL}?continue=${encodeURIComponent(REDIRECT_AFTER_LOGOUT)}`);
});

// Export the app for Vercel serverless function handling
module.exports = app;