document.querySelectorAll('.academic-tab').forEach(tab => {
            tab.addEventListener('click', function () {
                document.querySelectorAll('.academic-tab').forEach(t => t.classList.remove('active'));
                this.classList.add('active');
                const target = this.dataset.groupTarget;
                document.querySelectorAll('.academic-group').forEach(group => {
                    group.classList.toggle('active', group.dataset.group === target);
                });
                // Recalculate the open term's height now that its group is visible again
                document.querySelectorAll('.academic-group[data-group="' + target + '"] .term-header.open').forEach(header => {
                    header.nextElementSibling.style.maxHeight = header.nextElementSibling.scrollHeight + 'px';
                });
            });
        });

        // Accordion: clicking a term header smoothly expands/collapses its course list.
        // Only one term stays open per group at a time.
        document.querySelectorAll('.term-header').forEach(header => {
            header.addEventListener('click', function () {
                const isOpen = this.classList.contains('open');
                const accordion = this.closest('.term-accordion');

                accordion.querySelectorAll('.term-header').forEach(h => {
                    h.classList.remove('open');
                    h.nextElementSibling.style.maxHeight = null;
                });

                if (!isOpen) {
                    this.classList.add('open');
                    this.nextElementSibling.style.maxHeight = this.nextElementSibling.scrollHeight + 'px';
                }
            });
        });

        // Set the initial height for whichever terms start open (closest current period)
        document.querySelectorAll('.term-header.open').forEach(header => {
            header.nextElementSibling.style.maxHeight = header.nextElementSibling.scrollHeight + 'px';
        });
document.addEventListener("DOMContentLoaded", () => {
  
  // 1. LIVE CLOCK ENGINE
  function updateClock() {
    const clockElement = document.getElementById("live-clock");
    if (!clockElement) return; // Keeps the script safe if element is missing

    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
    
    clockElement.textContent = formatter.format(now);
  }
  
  updateClock();
  setInterval(updateClock, 1000);


  // 2. LIVE "ONLINE" COUNTER (Supabase Realtime Presence)
  // Every open tab joins one shared presence channel; the count is the number
  // of distinct visitor keys in it. Tabs share one visitor id via localStorage
  // so opening the site twice in one browser still counts as one person.
  // The publishable key is meant to be public - it's safe to ship in client code.
  const countElement = document.getElementById("visitor-count");
  const SUPABASE_URL = "https://qfyklfboysoyaxoxsifm.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_OP8XpAXcQNPyirZqE_DsYQ_8-gNp94a";
  if (countElement && window.supabase) {
    let visitorId;
    try {
      visitorId = localStorage.getItem("presence-id");
      if (!visitorId) {
        visitorId = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
        localStorage.setItem("presence-id", visitorId);
      }
    } catch (e) {
      visitorId = String(Math.random()).slice(2);
    }

    const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    const channel = client.channel("online-visitors", {
      config: { presence: { key: visitorId } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const n = Object.keys(channel.presenceState()).length;
        countElement.textContent = Math.max(n, 1);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") channel.track({ joined_at: Date.now() });
      });

    window.addEventListener("pagehide", () => client.removeChannel(channel));
  }
});
/* ==========================================
   LIGHT / DARK THEME TOGGLE
   ========================================== */
document.addEventListener("DOMContentLoaded", () => {
  const THEME_KEY = "portfolio-theme";
  const root = document.documentElement;
  const toggleBtn = document.getElementById("themeToggle");
  if (!toggleBtn) return;

  function syncButton(theme) {
    const isLight = theme === "light";
    toggleBtn.setAttribute("aria-pressed", String(isLight));
    toggleBtn.setAttribute("aria-label", isLight ? "Switch to dark mode" : "Switch to light mode");
  }

  // The inline <head> script already set data-theme on <html> before paint;
  // this just syncs the button's a11y state to whatever it landed on.
  syncButton(root.getAttribute("data-theme") === "dark" ? "dark" : "light");

  toggleBtn.addEventListener("click", () => {
    const nextTheme = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    if (nextTheme === "dark") {
      root.setAttribute("data-theme", "dark");
    } else {
      root.removeAttribute("data-theme");
    }
    localStorage.setItem(THEME_KEY, nextTheme);
    syncButton(nextTheme);
  });
});


/* ==========================================
   IMAGE LIGHTBOX
   ========================================== */
document.addEventListener("DOMContentLoaded", () => {
  const modal = document.getElementById("imageModal");
  const modalImg = document.getElementById("imageModalImg");
  const modalCaption = document.getElementById("imageModalCaption");
  const closeBtn = document.getElementById("closeImageBtn");
  if (!modal || !modalImg) return;

  const prevBtn = document.getElementById("prevImageBtn");
  const nextBtn = document.getElementById("nextImageBtn");
  let lastFocused = null;
  let gallery = [];      // thumbnails that can be cycled through (cooking grid only)
  let galleryIndex = 0;

  let swapToken = 0;     // drops stale decodes when arrows are pressed quickly

  function setCaption(img) {
    // Prefer the visible caption under the photo; fall back to nothing
    const frame = img.closest(".media-frame");
    const caption = frame && frame.nextElementSibling && frame.nextElementSibling.classList.contains("media-caption")
      ? frame.nextElementSibling.textContent.trim()
      : "";
    modalCaption.textContent = caption;
  }

  // Decode off-screen so the swap into the lightbox never waits on the main thread
  function decoded(src) {
    const probe = new Image();
    probe.src = src;
    return probe.decode ? probe.decode().catch(() => {}) : Promise.resolve();
  }

  function lockScroll() {
    // Pad by the scrollbar width so hiding it doesn't shift and reflow the page
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbar > 0) document.body.style.paddingRight = scrollbar + "px";
    document.body.style.overflow = "hidden";
  }

  function unlockScroll() {
    document.body.style.overflow = "";
    document.body.style.paddingRight = "";
  }

  function openImage(img) {
    gallery = img.classList.contains("food-tile")
      ? Array.from(document.querySelectorAll(".food-tile"))
      : [];
    galleryIndex = gallery.indexOf(img);
    prevBtn.hidden = nextBtn.hidden = gallery.length < 2;
    modal.querySelector(".image-modal-content").classList.toggle("has-gallery", gallery.length > 1);

    lastFocused = img;
    const src = img.currentSrc || img.src;
    const token = ++swapToken;
    decoded(src).then(() => {
      if (token !== swapToken) return;
      modalImg.classList.remove("is-swapping");
      modalImg.src = src;
      modalImg.alt = img.alt;
      setCaption(img);
      lockScroll();
      // Next frame, so the new src is painted before the fade/scale begins
      requestAnimationFrame(() => {
        modal.classList.add("is-active");
        closeBtn.focus({ preventScroll: true });
      });
    });
  }

  function step(delta) {
    if (gallery.length < 2) return;
    galleryIndex = (galleryIndex + delta + gallery.length) % gallery.length;
    const img = gallery[galleryIndex];
    lastFocused = img;
    const src = img.currentSrc || img.src;
    const token = ++swapToken;
    modalImg.classList.add("is-swapping");
    Promise.all([decoded(src), new Promise(r => setTimeout(r, 150))]).then(() => {
      if (token !== swapToken) return;
      modalImg.src = src;
      modalImg.alt = img.alt;
      setCaption(img);
      requestAnimationFrame(() => modalImg.classList.remove("is-swapping"));
    });
  }

  function closeImage() {
    if (!modal.classList.contains("is-active")) return;
    swapToken++;
    modal.classList.remove("is-active");
    unlockScroll();
    if (lastFocused) lastFocused.focus({ preventScroll: true });
  }

  document.querySelectorAll(".media-frame img, .profile-frame img").forEach(img => {
    img.classList.add("zoomable");
    img.tabIndex = 0;
    img.setAttribute("role", "button");
    img.setAttribute("aria-label", "View larger: " + img.alt);
    img.addEventListener("click", () => openImage(img));
    img.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openImage(img);
      }
    });
  });

  // Cooking grid: build square thumbnails from food.js, click to expand in the lightbox
  const foodGrid = document.getElementById("foodGrid");
  if (foodGrid && typeof FOOD_IMAGES !== "undefined") {
    FOOD_IMAGES.forEach((src, i) => {
      const img = document.createElement("img");
      img.src = src;
      img.alt = "Cooking photo " + (i + 1);
      img.loading = "lazy";
      img.className = "food-tile";
      img.tabIndex = 0;
      img.setAttribute("role", "button");
      img.setAttribute("aria-label", "View larger: " + img.alt);
      img.addEventListener("click", () => openImage(img));
      img.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openImage(img);
        }
      });
      foodGrid.appendChild(img);
    });
  }

  closeBtn.addEventListener("click", closeImage);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeImage();
  });
  prevBtn.addEventListener("click", () => step(-1));
  nextBtn.addEventListener("click", () => step(1));
  document.addEventListener("keydown", (e) => {
    if (!modal.classList.contains("is-active")) return;
    if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "ArrowRight") step(1);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeImage();
  });
});
