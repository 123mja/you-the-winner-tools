// Shared theme toggle (Light / Medium / Dark), included on every page
// alongside theme.css. Loaded as a plain (non-module, non-deferred) script
// near the top of <head> so part 1 below runs and paints correctly before
// the page becomes visible -- avoids a flash of the wrong theme for
// returning visitors. See SKILL.md "Dark mode" section for the full writeup.
(function () {
  var KEY = 'mel-theme';
  var EXPLICIT_KEY = 'mel-theme-explicit';
  var THEMES = ['light', 'medium', 'dark'];
  var ICONS = { light: '☀️', medium: '🌗', dark: '🌙' };

  function currentTheme() {
    var attr = document.documentElement.getAttribute('data-theme');
    return (attr === 'medium' || attr === 'dark') ? attr : 'light';
  }

  function applyTheme(theme) {
    if (theme === 'medium' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
    else document.documentElement.removeAttribute('data-theme');
  }

  // 1) Apply whatever this browser already remembers, immediately.
  var saved = localStorage.getItem(KEY);
  if (saved === 'medium' || saved === 'dark') applyTheme(saved);

  function applyIcon() {
    var btn = document.querySelector('.theme-toggle');
    if (btn) btn.textContent = ICONS[currentTheme()];
  }

  // 2) Manual toggle, wired to the ☀️/🌗/🌙 button on every page. Each
  //    click cycles Light -> Medium -> Dark -> Light.
  window.toggleTheme = function () {
    var idx = THEMES.indexOf(currentTheme());
    var next = THEMES[(idx + 1) % THEMES.length];
    applyTheme(next);
    localStorage.setItem(KEY, next);
    localStorage.setItem(EXPLICIT_KEY, '1'); // a deliberate choice always wins from here on
    applyIcon();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyIcon);
  else applyIcon();

  // 2b) When this page is embedded as an iframe, the parent may change the
  //     theme while we're already loaded. The parent's toggleTheme() writes
  //     to localStorage, which fires a 'storage' event in all same-origin
  //     iframes — pick it up and repaint immediately.
  window.addEventListener('storage', function (e) {
    if (e.key === KEY) { applyTheme(e.newValue || 'light'); applyIcon(); }
  });

  // 3) If this visitor has never explicitly picked a theme themselves,
  //    keep following the admin's sitewide default (mel-the-winner/config/
  //    theme-default, editable from admin-panel.html). Cached to localStorage
  //    so the NEXT load paints correctly with zero flash; only flashes once,
  //    the first time, or right after the admin changes the default.
  if (localStorage.getItem(EXPLICIT_KEY) !== '1') {
    import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js').then(function (appMod) {
      return import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js').then(function (dbMod) {
        var app = appMod.getApps().find(function (a) { return a.name === 'theme'; }) || appMod.initializeApp({
          apiKey: "AIzaSyBZEWMJbppoob8WklMvjULLJOeiglpwYDM",
          authDomain: "mel-the-winner.firebaseapp.com",
          databaseURL: "https://mel-the-winner-default-rtdb.firebaseio.com",
          projectId: "mel-the-winner",
          storageBucket: "mel-the-winner.firebasestorage.app",
          messagingSenderId: "442263365271",
          appId: "1:442263365271:web:f4dd3d63a1d3b55fffabd2"
        }, 'theme');
        return dbMod.get(dbMod.ref(dbMod.getDatabase(app), 'mel-the-winner/config/theme-default'));
      });
    }).then(function (snap) {
      var v = snap && snap.val();
      var def = (v === 'medium' || v === 'dark') ? v : 'light';
      localStorage.setItem(KEY, def);
      if (def !== currentTheme()) { applyTheme(def); applyIcon(); }
    }).catch(function () { /* offline, or config/theme-default not set yet -- stays light */ });
  }
})();

// ── SECOND LANGUAGE LABEL ──
// admin-panel.html writes the chosen label (e.g. "PT", "ES", "FR", or "" to
// hide) to Firebase config/lang2-label and to localStorage('mel-lang2-label').
// This block applies it to every page on load so the toggle button reflects
// whatever the admin chose without touching page-specific JS.
//
// Pattern A — two-button [EN][PT] toggles: index, timeaway, winner-story, about
//             → targets [data-lang="pt"] buttons
// Pattern B — single-button toggle on myday: #langToggle
//             → myday's applyLang() also reads localStorage for dynamic relabeling
(function () {
  var L2_KEY = 'mel-lang2-label';

  function applyLabel(label) {
    // Pattern A: replace button text, or hide the button entirely
    document.querySelectorAll('[data-lang="pt"]').forEach(function (btn) {
      if (!label) { btn.style.display = 'none'; }
      else { btn.textContent = label; btn.style.display = ''; }
    });
    // Pattern B: myday's single toggle shows the alternate language
    var singleToggle = document.getElementById('langToggle');
    if (singleToggle) {
      if (!label) {
        singleToggle.style.display = 'none';
      } else {
        singleToggle.style.display = '';
        // Only relabel when not currently showing 'EN' (i.e. user is in EN mode)
        if (singleToggle.textContent.trim() !== 'EN') {
          singleToggle.textContent = label;
        }
      }
    }
  }

  function run() {
    // 1. Apply cached value immediately (sync — no flash)
    var cached = localStorage.getItem(L2_KEY);
    if (cached !== null) applyLabel(cached);

    // 2. Always fetch from Firebase so the label stays in sync after admin changes it
    import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js').then(function (appMod) {
      return import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js').then(function (dbMod) {
        var app = appMod.getApps().find(function (a) { return a.name === 'theme'; }) ||
          appMod.initializeApp({
            apiKey: "AIzaSyBZEWMJbppoob8WklMvjULLJOeiglpwYDM",
            authDomain: "mel-the-winner.firebaseapp.com",
            databaseURL: "https://mel-the-winner-default-rtdb.firebaseio.com",
            projectId: "mel-the-winner",
            storageBucket: "mel-the-winner.firebasestorage.app",
            messagingSenderId: "442263365271",
            appId: "1:442263365271:web:f4dd3d63a1d3b55fffabd2"
          }, 'theme');
        return dbMod.get(dbMod.ref(dbMod.getDatabase(app), 'mel-the-winner/config/lang2-label'));
      });
    }).then(function (snap) {
      var v = snap && snap.val();
      if (v === null || v === undefined) return; // not configured yet — keep HTML default ("PT")
      var label = (typeof v === 'string' ? v : '').toUpperCase();
      localStorage.setItem(L2_KEY, label);
      applyLabel(label);
    }).catch(function () { /* offline — keep cached or HTML default */ });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
