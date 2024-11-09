require('dotenv').config();
const express = require('express');
const session = require('express-session');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://moodfi.vercel.app/callback';
const SCOPES = 'user-top-read playlist-modify-public playlist-modify-private';

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: process.env.NODE_ENV === 'production' } // Set cookie security based on environment
}));

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
    const mood = req.query.mood || '';
    res.redirect(`https://accounts.spotify.com/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${REDIRECT_URI}&scope=${SCOPES}&state=${mood}`);
});

// Callback route to get access token
app.get('/callback', async (req, res) => {
    const code = req.query.code || null;
    const mood = req.query.state || '';

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
        if (data.access_token) {
            console.log("Access Token Received:", data.access_token);
            req.session.accessToken = data.access_token;
            req.session.refreshToken = data.refresh_token;
            res.redirect(`/generate?mood=${mood}`);
        } else {
            throw new Error('Failed to obtain access token');
        }
    } catch (error) {
        console.error('Error during Spotify authorization:', error);
        res.send('Authorization error');
    }
});

// Route to generate a playlist
app.get('/generate', async (req, res) => {
    const accessToken = req.session.accessToken;
    const mood = req.query.mood;

    // Redirect to login if access token is missing
    if (!accessToken) {
        console.error("Access Token is missing. Redirecting to login.");
        return res.redirect('/login');
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

// Logout route to clear session and redirect to home
app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) console.error('Error clearing session:', err);
        res.redirect('/');
    });
});

// Export the app for Vercel serverless function handling
module.exports = app;
