Moodfi 🎶

Moodfi is an AI-powered playlist generator that creates personalized Spotify playlists based on your mood, genre, and artist preferences. It leverages multiple AI APIs (OpenAI, Gemini, DeepSeek) for mood analysis and uses your listening history to refine recommendations.

Features
Personalized Playlists:
Generate playlists based on your mood and listening history.

AI Mood Analysis:
Uses OpenAI as the primary engine for mood analysis with Gemini and DeepSeek as fallbacks.

Fallback Logic:
For new users, it uses generalized mood-based tracks; for existing users, it leverages your top artists and tracks to tailor recommendations.

Spotify Integration:
Authenticates you via Spotify OAuth, creates public playlists, and adds tracks to them.

Responsive UI:
A modern, ChatGPT-like interface built with EJS and custom CSS.

Installation:
Clone the Repository:
git clone https://github.com/yourusername/moodfi.git
cd moodfi

Install Dependencies:
npm install
Ensure you have these packages installed:
express
node-fetch
cookie-parser
jsonwebtoken
axios
openai
ejs

Set Up Environment Variables:
Create a .env file in the root directory with the following:
PORT=3000
CLIENT_ID=your_spotify_client_id
CLIENT_SECRET=your_spotify_client_secret
JWT_SECRET=your_jwt_secret
OPENAI_API_KEY=your_openai_api_key
GEMINI_API_KEY=your_gemini_api_key
DEEPSEEK_API_KEY=your_deepseek_api_key
NODE_ENV=development
Change NODE_ENV to production when deploying.

Usage
Run the App Locally:
npm run dev
The app will run at http://localhost:3000.

Login with Spotify:
Enter your mood/genre/artist query into the search bar (e.g., "Create a sad Drake playlist") and press Enter or click the playlist button.
You will be redirected to Spotify for authentication.
Once logged in, Moodfi will generate a playlist based on your input and listening history.
Playlist Display & Logout:

The generated playlist will be embedded on the landing page.
A Logout button will appear in the bottom section once a playlist is generated. Clicking it will clear your session and cookies and log you out from Spotify.
Deployment
Moodfi is currently deployed on Vercel. To deploy your own version:

Connect your GitHub Repository to Vercel.
Set the Environment Variables in Vercel's dashboard.
Deploy the project.
Future Improvements
API Limit Enhancements:
Work with Spotify and AI API providers (OpenAI, Gemini, DeepSeek) to increase rate limits and quotas.

Enhanced Fallback Mechanisms:
Further refine recommendations by integrating more detailed user data and alternative fallback strategies.

User Analytics:
Integrate analytics tools to monitor user engagement and improve the user experience.

Support
If you encounter any issues or have questions, please open an issue in the GitHub repository or contact the developer at support@moodfi.com.

Enjoy Moodfi and happy listening! 🎵🚀