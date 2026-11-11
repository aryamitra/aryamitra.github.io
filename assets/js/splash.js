// Splash page (index.html): the card-flip transition to /portfolio/ and the theme toggle.

(function () {
  var link = document.querySelector('.splash-enter');
  var card = document.querySelector('.splash-card');
  var stage = document.querySelector('.flip-stage');
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // The flipping card's front is a copy of the real one
  stage.querySelector('.flip-front').appendChild(
    card.querySelector('.splash-card-inner').cloneNode(true));

  // Shared by the outgoing and returning animations: the starting pose that
  // lays the full-viewport flip card exactly over .splash-card.
  function setTargets() {
    var r = card.getBoundingClientRect();
    var vw = window.innerWidth, vh = window.innerHeight;
    // The front keeps the card's 7:4 shape at viewport width; scaleY(--fy) then
    // stretches it to fill the stage, which the stage's starting scale undoes,
    // so the text is only ever scaled uniformly.
    var frontH = vw * r.height / r.width;
    stage.style.setProperty('--k', vw / r.width);
    stage.style.setProperty('--front-h', frontH + 'px');
    stage.style.setProperty('--fy', vh / frontH);
    stage.style.setProperty('--tx', (r.left + r.width / 2 - vw / 2) + 'px');
    stage.style.setProperty('--ty', (r.top + r.height / 2 - vh / 2) + 'px');
    stage.style.setProperty('--sx', r.width / vw);
    stage.style.setProperty('--sy', r.height / vh);
  }

  // Arriving via the portfolio's back button: play the flip in reverse.
  // The stored value is the portfolio's scroll position.
  var returnScroll = null;
  try {
    returnScroll = sessionStorage.getItem('splash-return');
    sessionStorage.removeItem('splash-return');
  } catch (e) {}
  var iframe = stage.querySelector('iframe');
  function scrollIframe(y) {
    try { iframe.contentWindow.scrollTo({ top: y, behavior: 'instant' }); } catch (e) {}
  }
  if (returnScroll !== null && !reduced) {
    setTargets();
    // Nothing is painted until the back face has loaded (splash.css hides the page
    // while html.splash-returning is set), so the browser keeps showing the
    // portfolio instead of flashing an empty card. The timeout caps the wait.
    var started = false;
    var start = function () {
      if (started) return;
      started = true;
      scrollIframe(parseFloat(returnScroll) || 0);
      document.body.classList.add('returning');
      document.documentElement.classList.remove('splash-returning');
    };
    var doc = iframe.contentDocument;
    if (doc && doc.readyState === 'complete' && doc.URL !== 'about:blank') start();
    else iframe.addEventListener('load', start);
    setTimeout(start, 1500);
    stage.querySelector('.flip-card').addEventListener('animationend', function (e) {
      if (e.target !== e.currentTarget) return;
      document.body.classList.remove('returning');
      scrollIframe(0); // the next flip lands on a freshly loaded page, at the top
    });
  } else {
    document.documentElement.classList.remove('splash-returning');
  }

  // Restored from the back/forward cache after leaving: show the card again
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) document.body.classList.remove('leaving', 'returning');
  });

  link.addEventListener('click', function (e) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (reduced) return;
    e.preventDefault();
    if (document.body.classList.contains('leaving')) return;
    setTargets();
    document.body.classList.add('leaving');
    // Navigate once the flip has really finished. A fixed 1200ms timer starts at the
    // click, but the animation only starts after its first (heavy) frame is drawn, so
    // the timer cut off the last frames. The timer stays as a fallback in case
    // animationend never fires (e.g. the tab is hidden mid-flip).
    var gone = false;
    function go() {
      if (gone) return;
      gone = true;
      window.location.href = link.href;
    }
    stage.querySelector('.flip-card').addEventListener('animationend', function (ev) {
      if (ev.target === ev.currentTarget) go();
    });
    setTimeout(go, 2000);
  });
})();

(function () {
  var KEY = 'portfolio-theme';
  var root = document.documentElement;
  var btn = document.getElementById('themeToggle');
  var iframe = document.querySelector('.flip-back iframe');

  // .theme-switching (style.css) turns transitions off so the swap is instant.
  // Reading a computed style commits the new colors before the class comes off.
  function setTheme(doc, theme) {
    if (!doc) return;
    var el = doc.documentElement;
    el.classList.add('theme-switching');
    if (theme === 'dark') el.setAttribute('data-theme', 'dark');
    else el.removeAttribute('data-theme');
    if (doc.body) doc.defaultView.getComputedStyle(doc.body).color;
    setTimeout(function () { el.classList.remove('theme-switching'); }, 1);
  }

  function stored() {
    try { return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'; } catch (e) { return 'light'; }
  }

  // Applies the theme here AND to the preloaded portfolio on the back of the flip
  // card. That iframe loaded with whatever theme was stored at page load, so without
  // this the flip shows the old theme and the real portfolio then flashes to the new one.
  function apply(theme) {
    setTheme(document, theme);
    try { setTheme(iframe.contentDocument, theme); } catch (e) {}
    btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  }

  btn.setAttribute('aria-label', root.getAttribute('data-theme') === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');

  btn.addEventListener('click', function () {
    var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch (e) {}
    apply(next);
  });

  // Theme changed in another tab
  window.addEventListener('storage', function (e) {
    if (e.key === KEY) apply(stored());
  });

  // Restored from the back/forward cache (e.g. browser back after toggling on the
  // portfolio): this page and its iframe still hold the theme from before.
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) apply(stored());
  });
})();
