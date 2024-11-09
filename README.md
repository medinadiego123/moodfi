Moodfi 🎶

Moodfi is a personalized Spotify playlist generator that curates music based on your mood. Choose from moods like "Happy," "Chill," "Energetic," and more to receive a custom playlist directly in your Spotify account. Moodfi aims to make music discovery simple, fun, and mood-driven.

Features

Generates Spotify playlists based on selected moods.
Integrates with Spotify's API to curate playlists using a user’s top artists or mood-specific genres.
Playlists are saved directly to users' Spotify accounts.
Ensures privacy by not storing user data.

Future Plans

Additional Moods: New mood options, such as "Focused," "Romantic," and "Adventurous."
Enhanced Algorithm: Refining playlist generation by analyzing aggregate trends and new Spotify endpoints.
User Interactivity: Allowing users to upvote or downvote tracks for more personalized recommendations over time.
Machine Learning: Leveraging ML to create even more precise, mood-based song suggestions.

Installation (For Developers)

Note: This section is for developers who want to run Moodfi locally. If you’re an end-user, simply visit the live link here (https://moodfi.vercel.app/).

Prerequisites (For Developers Only)

Node.js (version 14 or higher)
Spotify Developer Account: Register an app in the Spotify Developer Dashboard (https://developer.spotify.com/dashboard/) to obtain a Client ID and Client Secret.

Setup

1. Clone this repository:

git clone https://github.com/yourusername/moodfi.git
cd moodfi

2. Create a .env file in the root directory and add your Spotify credentials:

CLIENT_ID=your_spotify_client_id
CLIENT_SECRET=your_spotify_client_secret
REDIRECT_URI=https://your-deployed-app-url.com/callback

3. Install dependencies:

npm install

4. Run the app locally:

vercel dev

Usage

Visit the deployed app, select a mood, and let Moodfi generate a customized playlist in your Spotify account!

Technologies Used

Node.js and Express for the backend.
EJS for templating.
Spotify Web API to access user data and create playlists.

Contributing

Feel free to open an issue or submit a pull request if you have suggestions for improving Moodfi. All contributions are welcome!
