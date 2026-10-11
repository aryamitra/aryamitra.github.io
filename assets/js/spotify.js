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

  // "Last Played" overlay: clicking the sidebar card opens a list of the last 5
  // tracks instead of navigating away; each row then pops out to Spotify itself.
  const modal = document.getElementById("spotifyModal");
  const list = document.getElementById("spotifyTrackList");
  const closeBtn = document.getElementById("closeSpotifyBtn");
  if (modal && list && closeBtn) {
    let lastFocused = null;
    let loaded = false;

    function renderList(tracks) {
      list.innerHTML = "";
      if (!tracks || !tracks.length) {
        const empty = document.createElement("li");
        empty.className = "spotify-track-empty";
        empty.textContent = "Nothing played recently.";
        list.appendChild(empty);
        return;
      }
      tracks.slice(0, 5).forEach((t) => {
        const li = document.createElement("li");
        const row = document.createElement("a");
        row.className = "spotify-track-row";
        row.href = t.url || "https://open.spotify.com";
        row.target = "_blank";
        row.rel = "noopener";

        const img = document.createElement("img");
        img.className = "spotify-track-art";
        img.src = t.albumArt || "";
        img.alt = "";
        img.width = 44;
        img.height = 44;

        const info = document.createElement("div");
        info.className = "spotify-track-info";
        const rowTitle = document.createElement("div");
        rowTitle.className = "spotify-track-title";
        rowTitle.textContent = t.title;
        const rowArtist = document.createElement("div");
        rowArtist.className = "spotify-track-artist";
        rowArtist.textContent = t.artist;
        info.appendChild(rowTitle);
        info.appendChild(rowArtist);

        row.appendChild(img);
        row.appendChild(info);
        li.appendChild(row);
        list.appendChild(li);
      });
    }

    async function loadRecent() {
      try {
        const res = await fetch(WORKER_URL + "/recent", { cache: "no-store" });
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        renderList(data.tracks);
        loaded = true;
      } catch (e) {
        renderList([]);
      }
    }

    function openModal() {
      lastFocused = document.activeElement;
      modal.classList.add("is-active");
      document.body.style.overflow = "hidden";
      closeBtn.focus();
      if (!loaded) loadRecent();
    }

    function closeModal() {
      if (!modal.classList.contains("is-active")) return;
      modal.classList.remove("is-active");
      document.body.style.overflow = "";
      if (lastFocused) lastFocused.focus();
    }

    card.addEventListener("click", (e) => {
      e.preventDefault();
      openModal();
    });
    closeBtn.addEventListener("click", closeModal);
    modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal.classList.contains("is-active")) closeModal();
    });
  }
})();
