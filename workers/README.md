# Spotify now-playing setup

The site is static, so a tiny Cloudflare Worker (free tier) talks to Spotify and the page polls it.

1. **Spotify app**: https://developer.spotify.com/dashboard → Create app. Add redirect URI `http://127.0.0.1:8888/callback`. Note the Client ID and Secret.
2. **Refresh token** (one time): open in a browser, approve, and copy the `code` from the redirect URL:
   `https://accounts.spotify.com/authorize?client_id=CLIENT_ID&response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%3A8888%2Fcallback&scope=user-read-currently-playing%20user-read-recently-played`
   Then exchange it:
   ```bash
   curl -X POST https://accounts.spotify.com/api/token \
     -H "Authorization: Basic $(printf 'CLIENT_ID:CLIENT_SECRET' | base64)" \
     -d grant_type=authorization_code -d code=CODE \
     -d redirect_uri=http://127.0.0.1:8888/callback
   ```
   Save the `refresh_token` from the response.
3. **Deploy the worker**:
   ```bash
   npm i -g wrangler
   wrangler deploy workers/spotify-now-playing.js --name spotify-now-playing --compatibility-date 2024-01-01
   wrangler secret put SPOTIFY_CLIENT_ID --name spotify-now-playing
   wrangler secret put SPOTIFY_CLIENT_SECRET --name spotify-now-playing
   wrangler secret put SPOTIFY_REFRESH_TOKEN --name spotify-now-playing
   ```
4. Paste the worker URL into `WORKER_URL` in `assets/js/spotify.js`.
