# Moodfi 🎶

Moodfi is an AI-powered playlist generator that creates personalized Spotify playlists based on your mood, genre, and artist preferences. It leverages multiple AI APIs (OpenAI, Gemini, DeepSeek) for mood analysis and uses your listening history to refine recommendations.

## Features

- **Personalized Playlists:**  
  Generate playlists based on your mood and listening history.
  
- **AI Mood Analysis:**  
  Uses OpenAI as the primary engine for mood analysis, with Gemini and DeepSeek as fallbacks.

- **Fallback Logic:**  
  For new users, Moodfi provides generalized mood-based tracks. For existing users, it leverages your top artists and tracks to tailor recommendations.

- **Spotify Integration:**  
  Authenticates via Spotify OAuth, creates public playlists, and adds tracks to them.

- **Responsive UI:**  
  A modern, ChatGPT-like interface built with EJS and custom CSS.

## Installation

1. **Clone the Repository:**
   ```bash
   git clone https://github.com/yourusername/moodfi.git
   cd moodfi
2. **Install Dependencies:**
   npm install
   Ensure the following packages are installed:

   express
   node-fetch
   cookie-parser
   jsonwebtoken
   axios
   openai
   ejs
3. **Set Up Environment Variables: Create a .env file in the root directory with:**
   PORT=3000
   CLIENT_ID=your_spotify_client_id
   CLIENT_SECRET=your_spotify_client_secret
   JWT_SECRET=your_jwt_secret
   OPENAI_API_KEY=your_openai_api_key
   GEMINI_API_KEY=your_gemini_api_key
   DEEPSEEK_API_KEY=your_deepseek_api_key
   NODE_ENV=development

   Change NODE_ENV to production when deploying.

## Usage

1. **Run the App Locally:**
   npm run dev
   The app runs at http://localhost:3000.
2. **Login with Spotify:**
   Enter your mood/genre/artist query (e.g., "Create a sad Drake playlist") in the search bar.
   Press Enter or click the playlist button.
   You will be redirected to Spotify for authentication.
   Once logged in, Moodfi will generate a playlist based on your input and listening history.
3. **Playlist Display & Logout:**
   The generated playlist is embedded on the landing page.
   A Logout button appears in the bottom section once a playlist is generated. Clicking it clears your session and cookies, logging you out from Spotify.

## Deployment

   **Moodfi is deployed on Vercel. To deploy your own version:**
   1. Connect your GitHub Repository to Vercel.
   2. Set Environment Variables in Vercel's dashboard.
   3. Deploy the project.

## Future Improvements

   **API Limit Enhancements:**
   Work with Spotify and AI API providers (OpenAI, Gemini, DeepSeek) to increase rate limits and quotas.

   **Enhanced Fallback Mechanisms:**
   Refine recommendations by integrating more detailed user data and alternative fallback strategies.

   **User Analytics:**
   Integrate analytics to monitor user engagement and improve the user experience.

## Support

   If you encounter any issues or have questions, please open an issue on the GitHub repository or contact the developer at support@moodfi.com.

   Enjoy Moodfi and happy listening! 🎵🚀




