const express = require('express');
const session = require('express-session');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

// Helper function for dynamic import of fetch
async function fetchWithDynamicImport(url, options) {
    const fetch = (await import('node-fetch')).default;
    return fetch(url, options);
}

const app = express();
const port = process.env.PORT || 3000;
const CLIENT_ID = '396494146c974c8eb1102bf96c2e463c';
const CLIENT_SECRET = 'ef8dc3565d894e6ca661fd679321fe4e';
const REDIRECT_URI = 'http://localhost:3000/callback';
const SCOPES = 'user-top-read playlist-modify-public playlist-modify-private';

app.use(session({
    secret: 'your_secret_key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

app.set('view engine', 'ejs');
app.use(express.static('public'));

// Render the homepage
app.get('/', (req, res) => {
    res.render('index');
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

    if (!accessToken) {
        return res.redirect('/login');
    }

    try {
        const userSeeds = await getUserTopArtistsAndTracks(accessToken);
        const recommendations = await searchTracks(mood, userSeeds, accessToken);

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

        const topArtists = (await topArtistsResponse.json()).items.map(artist => artist.id);
        const topTracks = (await topTracksResponse.json()).items.map(track => track.id);

        return { topArtists, topTracks };
    } catch (error) {
        console.error('Error retrieving user’s top artists and tracks:', error);
        throw error;
    }
}

// Refined `searchTracks` function with user-based seeds and mood attributes
async function searchTracks(mood, userSeeds, accessToken) {
    let params = {};

    // If the user has listening history, use personalized seeds
    if (userSeeds.topArtists.length > 0 || userSeeds.topTracks.length > 0) {
        const shuffledArtists = userSeeds.topArtists.sort(() => 0.5 - Math.random()).slice(0, 2).join(',');
        const shuffledTracks = userSeeds.topTracks.sort(() => 0.5 - Math.random()).slice(0, 2).join(',');
        params.seed_artists = shuffledArtists;
        params.seed_tracks = shuffledTracks;
    } else {
        // For new users, use specific genres to create a random playlist based on mood
        const moodGenres = {
            happy: ['pop', 'indie-pop', 'funk', 'soul', 'disco', 'hyperpop'],
            sad: ['shoegaze', 'folk', 'acoustic', 'singer-songwriter', 'melancholia', 'blues'],
            angry: ['metal', 'punk', 'hardcore', 'rock', 'grunge'],
            chill: ['lo-fi', 'chill', 'ambient', 'jazz', 'soul'],
            energetic: ['edm', 'dance', 'hip-hop', 'house', 'trap', 'drill']
        };
        params.seed_genres = moodGenres[mood].sort(() => 0.5 - Math.random()).slice(0, 3).join(',');
    }

    // Fine-tune attributes based on mood to ensure appropriate vibe
    switch (mood) {
        case 'happy':
            Object.assign(params, {
                min_valence: 0.7,
                min_energy: 0.6,
                min_tempo: 110,
                max_tempo: 150,
                min_danceability: 0.6
            });
            break;
        case 'sad':
            Object.assign(params, {
                max_valence: 0.4,
                max_energy: 0.5,
                min_acousticness: 0.5,
                max_tempo: 90,
                min_instrumentalness: 0.3
            });
            break;
        case 'angry':
            Object.assign(params, {
                min_tempo: 130,
                max_tempo: 180,
                min_energy: 0.8,
                max_valence: 0.4,
                min_loudness: -5
            });
            break;
        case 'chill':
            Object.assign(params, {
                max_tempo: 120,
                max_energy: 0.5,
                min_instrumentalness: 0.4,
                min_acousticness: 0.3,
                min_valence: 0.3
            });
            break;
        case 'energetic':
            Object.assign(params, {
                min_tempo: 120,
                max_tempo: 160,
                min_energy: 0.7,
                min_danceability: 0.7,
                min_valence: 0.5
            });
            break;
    }

    // Create the query string
    const query = new URLSearchParams(params).toString();
    const url = `https://api.spotify.com/v1/recommendations?${query}&limit=10`;

    const response = await fetchWithDynamicImport(url, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    const data = await response.json();
    return data.tracks;
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

// Start server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});