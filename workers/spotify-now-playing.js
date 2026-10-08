// Cloudflare Worker: returns Arya's current (or last) Spotify track as JSON.
// Secrets (set with `wrangler secret put`): SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET,
// SPOTIFY_REFRESH_TOKEN.

const ALLOWED_ORIGINS = [
  "https://aryamitra.me",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1/me/player";

async function getAccessToken(env) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(env.SPOTIFY_CLIENT_ID + ":" + env.SPOTIFY_CLIENT_SECRET),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: env.SPOTIFY_REFRESH_TOKEN,
    }),
  });
  if (!res.ok) throw new Error("token " + res.status);
  return (await res.json()).access_token;
}

function shape(track, isPlaying) {
  return {
    isPlaying,
    title: track.name,
    artist: track.artists.map((a) => a.name).join(", "),
    albumArt: (track.album.images[1] || track.album.images[0] || {}).url || "",
    url: track.external_urls.spotify,
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const headers = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      "Vary": "Origin",
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=15",
    };
    try {
      const token = await getAccessToken(env);
      const auth = { headers: { Authorization: "Bearer " + token } };

      const now = await fetch(API + "/currently-playing", auth);
      if (now.status === 200) {
        const data = await now.json();
        if (data.item && data.currently_playing_type === "track") {
          return new Response(JSON.stringify(shape(data.item, data.is_playing)), { headers });
        }
      }

      const recent = await fetch(API + "/recently-played?limit=1", auth);
      const items = recent.ok ? (await recent.json()).items : [];
      const body = items && items.length ? shape(items[0].track, false) : {};
      return new Response(JSON.stringify(body), { headers });
    } catch (e) {
      return new Response("{}", { status: 502, headers });
    }
  },
};
