require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const cookieParser = require('cookie-parser'); // Import cookie-parser for handling cookies
const jwt = require('jsonwebtoken'); // Import jsonwebtoken for JWT handling

const app = express();
const port = process.env.PORT || 3000;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://moodfi.vercel.app/callback';
const JWT_SECRET = process.env.JWT_SECRET;
const SCOPES = 'user-top-read playlist-modify-public playlist-modify-private';

app.use(cookieParser());

// Set up EJS as the view engine and point to the correct views directory
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views')); // Make sure the path is correct
app.use(express.static(path.join(__dirname, '../public')));

// Render the homepage
app.get('/', (req, res) => {
    res.render('index'); // Renders `index.ejs` in the `views` folder
});

// Spotify authorization login route
app.get('/login', (req, res) => {
    console.log("Redirecting to Spotify authorization");
    const mood = req.query.mood || '';
    res.redirect(`https://accounts.spotify.com/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${REDIRECT_URI}&scope=${SCOPES}&state=${mood}`);
});
// Callback route to get access token
app.get('/callback', async (req, res) => {
    const code = req.query.code;
    const mood = req.query.state || '';
    console.log("Callback received. Code:", code);

    if (!code) {
        console.log('Authorization code is missing. Redirecting to /login.');
        return res.redirect('/login');
    }

    try {
        const response = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: REDIRECT_URI
            })
        });

        const data = await response.json();
        console.log("Spotify token response:", data);

        if (data.access_token) {
            // Create a JWT containing the Spotify access and refresh tokens
            const token = jwt.sign(
                {
                    accessToken: data.access_token,
                    refreshToken: data.refresh_token
                },
                process.env.JWT_SECRET,
                { expiresIn: '1h' } // Set expiration as needed
            );

            // Send the JWT as a cookie to the client
            res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
            console.log("JWT sent as cookie");

            res.redirect(`/generate?mood=${mood}`);
        } else {
            console.error("Failed to obtain access token:", data);
            res.send('Authorization failed: Unable to obtain access token');
        }
    } catch (error) {
        console.error('Error during Spotify authorization:', error);
        res.send('Authorization error');
    }
});
// Route to generate a playlist
app.get('/generate', async (req, res) => {
    const mood = req.query.mood;

    // Get the JWT from the cookie
    const token = req.cookies.token;
    if (!token) {
        console.error("JWT is missing. Redirecting to login.");
        return res.redirect('/login');
    }

    let accessToken, refreshToken;

    try {
        // Verify and decode the JWT
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        accessToken = decoded.accessToken;
        refreshToken = decoded.refreshToken;
    } catch (error) {
        console.error("Error verifying JWT:", error);
        return res.redirect('/login'); // Redirect to login if JWT is invalid or expired
    }

    console.log("Generating playlist with access token:", accessToken);

    try {
        const userSeeds = await getUserTopArtistsAndTracks(accessToken);

        // Ensure userSeeds properties are defined
        userSeeds.topArtists = userSeeds.topArtists || [];
        userSeeds.topTracks = userSeeds.topTracks || [];
        console.log("User Seeds:", userSeeds);

        const recommendations = await searchTracks(mood, userSeeds, accessToken);
        console.log("Recommendations:", recommendations);

        if (recommendations.length === 0) {
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

        const topArtistsData = await topArtistsResponse.json();
        const topTracksData = await topTracksResponse.json();

        const topArtists = topArtistsData.items ? topArtistsData.items.map(artist => artist.id) : [];
        const topTracks = topTracksData.items ? topTracksData.items.map(track => track.id) : [];

        return { topArtists, topTracks };
    } catch (error) {
        console.error('Error retrieving user’s top artists and tracks:', error);
        return { topArtists: [], topTracks: [] }; // Return empty arrays on error
    }
}

// Helper function to ensure 10 songs if initial fetch lacks them
async function fetchAdditionalTracks(genres, requiredCount, accessToken) {
    let additionalTracks = [];
    let remainingCount = requiredCount;

    try {
        while (remainingCount > 0) {
            const url = `https://api.spotify.com/v1/recommendations?limit=${remainingCount}&seed_genres=${genres.slice(0, 2).join(',')}`;
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
    const params = { limit: 10 }; // Set the song count to 10 globally

    // Determine user type
    const isExistingUser = userSeeds.topArtists.length > 0 || userSeeds.topTracks.length > 0;

    // Mood genres for fallback
    const moodGenres = {
        happy: ['pop', 'indie-pop', 'funk', 'soul', 'disco'],
        sad: ['shoegaze', 'folk', 'acoustic', 'melancholia'],
        angry: ['metal', 'punk', 'hardcore', 'rock'],
        chill: ['lo-fi', 'ambient', 'jazz', 'soul'],
        energetic: ['edm', 'dance', 'hip-hop', 'house']
    };

    // Seed settings based on user type
    if (isExistingUser) {
        params.seed_artists = userSeeds.topArtists.slice(0, 2).join(',');
        params.seed_tracks = userSeeds.topTracks.slice(0, 2).join(',');
    } else {
        params.seed_genres = moodGenres[mood].slice(0, 2).join(',');
    }

    const query = new URLSearchParams(params).toString();
    const url = `https://api.spotify.com/v1/recommendations?${query}`;

    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        const data = await response.json();

        // Ensure data.tracks is an array and has at least 10 tracks
        if (!Array.isArray(data.tracks) || data.tracks.length < 10) {
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
    res.send(`
        <h1>Terms of Service</h1>
        <p>Welcome to Moodfi's Terms of Service page. Include your terms here.</p>
        <a href="/">Back to Home</a>
    `);
});

// Privacy Policy page
app.get('/privacy', (req, res) => {
    res.send(`
        <h1>Privacy Policy</h1>
        <p>This is Moodfi's Privacy Policy page. Include your privacy policy here.</p>
        <a href="/">Back to Home</a>
    `);
});

// Logout Route
app.get('/logout', (req, res) => {
    // Clear the JWT cookie
    res.clearCookie('token', { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
    console.log("User logged out successfully");
    res.redirect('/'); // Redirect to the homepage after logout
});


// Export the app for Vercel serverless function handling
module.exports = app;