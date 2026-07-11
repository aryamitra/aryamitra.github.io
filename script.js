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
    const now = new Date();
    
    // Formats time to standard 12-hour AM/PM layout
    const formatter = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
    
    document.getElementById("live-clock").textContent = formatter.format(now);
  }
  
  // Updates clock immediately, then refreshes every second
  updateClock();
  setInterval(updateClock, 1000);


  // 2. LIVE VISITOR COUNTER ENGINE
  const username = "aryamitra"; 
  const namespace = "personal-portfolio";
  const counterUrl = `https://itsvg.in{username}-${namespace}`;

  async function fetchVisitorCount() {
    try {
      const response = await fetch(counterUrl);
      const data = await response.json();
      
      // Updates the HTML text with the real visitor number
      if (data && data.value) {
        document.getElementById("visitor-count").textContent = data.value;
      }
    } catch (error) {
      console.log("Visitor counter connection skipped:", error);
    }
  }

  fetchVisitorCount();
});
