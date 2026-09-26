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
   PERFECT SINGLE-FORM MODAL TOGGLE, SYNC & ANIMATION AJAX
   ========================================== */
document.addEventListener("DOMContentLoaded", () => {
  const emailModal = document.getElementById('emailModal');
  const openFullscreenBtn = document.getElementById('openFullscreenBtn');
  const closeFullscreenBtn = document.getElementById('closeFullscreenBtn');
  const unifiedForm = document.getElementById('unifiedEmailForm');

  // Input fields for syncing
  const sidebarEmail = document.getElementById('sharedEmail');
  const sidebarText = document.getElementById('sharedMessage');
  const modalEmail = document.getElementById('modalEmail');
  const modalText = document.getElementById('modalMessage');

  // 1. Handle opening, closing, and text syncing
  if (openFullscreenBtn && emailModal) {
    openFullscreenBtn.addEventListener('click', () => {
      if(modalEmail && sidebarEmail) modalEmail.value = sidebarEmail.value;
      if(modalText && sidebarText) modalText.value = sidebarText.value;
      emailModal.classList.add('is-active');
    });
  }

  function closeModalAndSync() {
    if(sidebarEmail && modalEmail) sidebarEmail.value = modalEmail.value;
    if(sidebarText && modalText) sidebarText.value = modalText.value;
    emailModal.classList.remove('is-active');
  }

  if (closeFullscreenBtn && emailModal) {
    closeFullscreenBtn.addEventListener('click', closeModalAndSync);
  }

  window.addEventListener('click', (e) => {
    if (e.target === emailModal) {
      closeModalAndSync();
    }
  });

  // 2. Handle the silent Formspree submission with animations
  if (unifiedForm) {
    unifiedForm.addEventListener("submit", function(event) {
      event.preventDefault(); // Stop page refresh
      
      // Target BOTH submit buttons so they both visually animate if open
      const sidebarBtn = unifiedForm.querySelector('.btn-send');
      // .btn-send-large lives outside <form> now (linked via form="unifiedEmailForm"
      // so it still submits this form), so it can't be found with unifiedForm.querySelector.
      const modalBtn = document.querySelector('.btn-send-large');
      
      const originalSidebarText = sidebarBtn ? sidebarBtn.textContent : "Send Message";
      const originalModalText = modalBtn ? modalBtn.textContent : "Send Message";
      
      // Put buttons into a loading state
      if(sidebarBtn) { sidebarBtn.textContent = "Sending..."; sidebarBtn.disabled = true; }
      if(modalBtn) { modalBtn.textContent = "Sending..."; modalBtn.disabled = true; }
      
      // Before submitting, ensure both sets of fields have the same data
      if (emailModal.classList.contains('is-active')) {
        if(sidebarEmail && modalEmail) sidebarEmail.value = modalEmail.value;
        if(sidebarText && modalText) sidebarText.value = modalText.value;
      } else {
        if(modalEmail && sidebarEmail) modalEmail.value = sidebarEmail.value;
        if(modalText && sidebarText) modalText.value = sidebarText.value;
      }

      const data = new FormData(unifiedForm);

      fetch(unifiedForm.action, {
        method: unifiedForm.method,
        body: data,
        headers: { 'Accept': 'application/json' }
      }).then(response => {
        if (response.ok) {
          // 🎉 SUCCESS STATE TRIGGER (No more alert!)
          if(sidebarBtn) { sidebarBtn.textContent = "Sent ✓"; sidebarBtn.classList.add('success-state'); }
          if(modalBtn) { modalBtn.textContent = "Sent ✓"; modalBtn.classList.add('success-state'); }
          
          unifiedForm.reset();

          // Wait 1.5 seconds, then close the fullscreen modal if it's open
          setTimeout(() => {
            if (emailModal) emailModal.classList.remove('is-active');
          }, 1500);

          // Wait 3 seconds, then turn buttons back to normal
          setTimeout(() => {
            if(sidebarBtn) { sidebarBtn.textContent = originalSidebarText; sidebarBtn.classList.remove('success-state'); sidebarBtn.disabled = false; }
            if(modalBtn) { modalBtn.textContent = originalModalText; modalBtn.classList.remove('success-state'); modalBtn.disabled = false; }
          }, 3000);

        } else {
          alert("Oops! There was a problem sending your message.");
          if(sidebarBtn) { sidebarBtn.textContent = originalSidebarText; sidebarBtn.disabled = false; }
          if(modalBtn) { modalBtn.textContent = originalModalText; modalBtn.disabled = false; }
        }
      }).catch(error => {
        alert("Oops! There was a network error.");
        if(sidebarBtn) { sidebarBtn.textContent = originalSidebarText; sidebarBtn.disabled = false; }
        if(modalBtn) { modalBtn.textContent = originalModalText; modalBtn.disabled = false; }
      });
    });
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

  let lastFocused = null;

  function openImage(img) {
    lastFocused = img;
    modalImg.src = img.currentSrc || img.src;
    modalImg.alt = img.alt;
    // Prefer the visible caption under the photo; fall back to its alt text
    const frame = img.closest(".media-frame");
    const caption = frame && frame.nextElementSibling && frame.nextElementSibling.classList.contains("media-caption")
      ? frame.nextElementSibling.textContent.trim()
      : "";
    modalCaption.textContent = caption;
    modal.classList.add("is-active");
    document.body.style.overflow = "hidden";
    closeBtn.focus();
  }

  function closeImage() {
    if (!modal.classList.contains("is-active")) return;
    modal.classList.remove("is-active");
    document.body.style.overflow = "";
    modalImg.src = "";
    if (lastFocused) lastFocused.focus();
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

  closeBtn.addEventListener("click", closeImage);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeImage();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeImage();
  });
});
