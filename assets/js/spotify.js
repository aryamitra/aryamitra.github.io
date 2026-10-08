// Spotify "now playing" card. Fetches from a small Cloudflare Worker (see
// workers/README.md) that holds the Spotify credentials, so no secrets live here.
// Leave WORKER_URL empty and the card simply stays hidden.
(function () {
  const WORKER_URL = "https://spotify-now-playing.aryamitra.workers.dev";
  const POLL_MS = 30000;

  const card = document.getElementById("spotifyCard");
  if (!card || !WORKER_URL) return;

  const art = document.getElementById("spotifyArt");
  const status = document.getElementById("spotifyStatus");
  const title = document.getElementById("spotifyTitle");
  const artist = document.getElementById("spotifyArtist");

  // Last track is cached so a fresh page load (e.g. after the splash-card flip) paints
  // the card immediately instead of popping in once the fetch returns.
  const CACHE_KEY = "spotify-last";

  function render(t) {
    art.src = t.albumArt || "";
    title.textContent = t.title;
    artist.textContent = t.artist;
    title.title = t.title;
    artist.title = t.artist;
    card.href = t.url || "https://open.spotify.com";
    card.classList.toggle("playing", !!t.isPlaying);
    status.textContent = t.isPlaying ? "I'm listening to" : "I last listened to";
    card.hidden = false;
  }

  function cache(t) {
    try {
      if (t) sessionStorage.setItem(CACHE_KEY, JSON.stringify(t));
      else sessionStorage.removeItem(CACHE_KEY);
    } catch (e) {}
  }

  async function update() {
    try {
      const res = await fetch(WORKER_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      const t = await res.json();
      if (!t || !t.title) { card.hidden = true; cache(null); return; }
      render(t);
      cache(t);
    } catch (e) {
      card.hidden = true;
    }
  }

  try {
    const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY));
    if (cached && cached.title) render(cached);
  } catch (e) {}

  update();
  setInterval(() => { if (!document.hidden) update(); }, POLL_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) update(); });
})();
