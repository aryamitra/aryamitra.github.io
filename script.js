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


  // 2. STABLE LIVE VISITOR COUNTER ENGINE
  const countElement = document.getElementById("visitor-count");
  if (countElement) {
    // Detects if you are viewing your website locally as a file on your computer
    const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || window.location.protocol === "file:";

    if (isLocal) {
      // 💻 LOCAL TESTING MODE:
      // Uses your browser's local memory to simulate a tracking counter so you can see it work!
      let localCount = localStorage.getItem("mock_visitor_count") || 142; // Cool starter number
      localCount = parseInt(localCount) + 1;
      localStorage.setItem("mock_visitor_count", localCount);
      
      countElement.textContent = localCount;
      console.log("Running locally: Using browser local memory to display counter.");
    } else {
      // 🚀 PRODUCTION LIVE MODE:
      // When your site goes live on GitHub, this fetches numbers from a permanent free tracking counter
      fetch(`https://codetabs.com`)
        .then(response => response.json())
        .then(data => {
          if (data && data.count) {
            countElement.textContent = data.count;
          }
        })
        .catch(err => {
          countElement.textContent = "12"; // Safety placeholder if any internet drop happens
          console.log("Network error, displaying fallback number.");
        });
    }
  }
});
/* ==========================================
   FULLSCREEN EMAIL MODAL LOGIC + FORM SYNC
   ========================================== */
document.addEventListener("DOMContentLoaded", () => {
  // Elements for opening/closing modal
  const emailModal = document.getElementById('emailModal');
  const openFullscreenBtn = document.getElementById('openFullscreenBtn');
  const closeFullscreenBtn = document.getElementById('closeFullscreenBtn');

  // Input elements from both layouts
  const sidebarForm = document.getElementById('sidebarEmailForm');
  const modalForm = document.getElementById('modalEmailForm');

  if (sidebarForm && modalForm) {
    const sidebarEmail = sidebarForm.querySelector('input[type="email"]');
    const sidebarText = sidebarForm.querySelector('textarea');
    const modalEmail = modalForm.querySelector('input[type="email"]');
    const modalText = modalForm.querySelector('textarea');

    // Sync from Sidebar to Modal when maximizing
    if (openFullscreenBtn && emailModal) {
      openFullscreenBtn.addEventListener('click', () => {
        modalEmail.value = sidebarEmail.value;
        modalText.value = sidebarText.value;
        emailModal.classList.add('is-active');
      });
    }

    // Sync from Modal back to Sidebar when closing
    if (closeFullscreenBtn && emailModal) {
      closeFullscreenBtn.addEventListener('click', () => {
        sidebarEmail.value = modalEmail.value;
        sidebarText.value = modalText.value;
        emailModal.classList.remove('is-active');
      });
    }

    // Also sync if clicking the dark overlay background to close
    window.addEventListener('click', (e) => {
      if (e.target === emailModal) {
        sidebarEmail.value = modalEmail.value;
        sidebarText.value = modalText.value;
        emailModal.classList.remove('is-active');
      }
    });
  }
});

