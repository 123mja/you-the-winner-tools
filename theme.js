// Shared theme picker (Calm / Vivid / Paper / Spectrum / Sunrise / Midnight),
// included on every page alongside theme.css. Loaded as a plain (non-module,
// non-deferred) script near the top of <head> so part 1 below runs and
// paints correctly before the page becomes visible -- avoids a flash of the
// wrong theme for returning visitors.
//
// Ported from the You-The-Winner Hub project's theme system on 2026-07-25,
// replacing the old 3-way Light/Medium/Dark cycle button with a 6-swatch
// picker menu. "Calm" is the default and the only theme with no data-theme
// attribute at all, since it matches each page's plain :root variables
// (same role "Light" used to play). The floating button (already present on
// every page as <button class="theme-toggle" onclick="toggleTheme()">) now
// opens the picker instead of cycling, so no per-page markup changes were
// needed. window.setTheme(id) is also exposed directly for pages that want
// to offer their own in-page picker (e.g. my-daily-tools.html's Settings ->
// Appearance section) without going through the floating menu.
(function () {
  var KEY = 'mel-theme';

  var THEMES = [
    { id: 'calm',     label: 'Calm (default)',  emoji: '🌿', swatch: ['#f0f5f3', '#2a7d6f', '#1a5c7a'] },
    { id: 'vivid',    label: 'Vivid',           emoji: '🎉', swatch: ['#ffffff', '#cc0000', '#8f0000'] },
    { id: 'paper',    label: 'Paper',           emoji: '📄', swatch: ['#ffffff', '#1f6a5c', '#16455c'] },
    { id: 'spectrum', label: 'Spectrum',        emoji: '🎨', swatch: ['#ffffff', '#4a6cf7', '#ea4c60'] },
    { id: 'sunrise',  label: 'Sunrise',         emoji: '🌅', swatch: ['#fbf8f2', '#e8963c', '#2a7d6f'] },
    { id: 'midnight', label: 'Midnight (dark)', emoji: '🌙', swatch: ['#0f1720', '#4fd8bc', '#7fb8e8'] }
  ];
  var THEME_IDS = THEMES.map(function (t) { return t.id; });
  window.THEME_LIST = THEMES; // exposed so pages can build their own in-page pickers (e.g. Settings → Appearance)

  // Migrate old saved values from the retired 3-way system: 'dark' maps
  // cleanly onto the new dark theme; 'medium' has no direct equivalent, so
  // those visitors fall back to the new default (Calm) and can re-pick from
  // the full set. 'light' also just becomes Calm.
  function migrate(saved) {
    if (saved === 'dark') return 'midnight';
    if (saved === 'medium' || saved === 'light') return 'calm';
    return saved;
  }

  function currentTheme() {
    var attr = document.documentElement.getAttribute('data-theme');
    return (attr && THEME_IDS.indexOf(attr) !== -1) ? attr : 'calm';
  }

  function themeMeta(id) {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i];
    return THEMES[0];
  }

  function applyTheme(id) {
    if (id && id !== 'calm') document.documentElement.setAttribute('data-theme', id);
    else document.documentElement.removeAttribute('data-theme');
  }

  // 1) Apply whatever this browser already remembers, immediately.
  var rawSaved = localStorage.getItem(KEY);
  var saved = rawSaved === null ? null : migrate(rawSaved);
  if (saved && saved !== 'calm') applyTheme(saved);
  if (saved !== null && saved !== rawSaved) { try { localStorage.setItem(KEY, saved); } catch (e) {} }

  function applyIcon() {
    var btn = document.querySelector('.theme-toggle');
    if (btn) {
      var meta = themeMeta(currentTheme());
      btn.textContent = meta.emoji;
      btn.setAttribute('aria-label', 'Change color theme (current: ' + meta.label + ')');
      btn.setAttribute('title', 'Change color theme');
    }
  }

  function notify(id) {
    try { document.dispatchEvent(new CustomEvent('mel-theme-change', { detail: { theme: id } })); } catch (e) {}
  }

  // Sets the theme directly (no cycling needed now that there are 6
  // options). Exposed on window so other in-page pickers can call it.
  window.setTheme = function (id) {
    if (THEME_IDS.indexOf(id) === -1) id = 'calm';
    applyTheme(id);
    localStorage.setItem(KEY, id);
    applyIcon();
    closeMenu();
    notify(id);
  };

  function markActive() {
    var menu = document.getElementById('theme-menu');
    if (!menu) return;
    var current = currentTheme();
    var items = menu.querySelectorAll('.theme-menu-item');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('active', items[i].getAttribute('data-theme-id') === current);
    }
  }

  function buildMenu() {
    var existing = document.getElementById('theme-menu');
    if (existing) return existing;
    var menu = document.createElement('div');
    menu.className = 'theme-menu';
    menu.id = 'theme-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Choose a color theme');
    THEMES.forEach(function (t) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'theme-menu-item';
      item.setAttribute('data-theme-id', t.id);
      var swatchHtml = '';
      for (var i = 0; i < t.swatch.length; i++) {
        swatchHtml += '<span style="background:' + t.swatch[i] + '"></span>';
      }
      item.innerHTML =
        '<span class="theme-swatch">' + swatchHtml + '</span>' +
        '<span class="theme-menu-label">' + t.emoji + ' ' + t.label + '</span>';
      item.addEventListener('click', function (e) {
        e.stopPropagation();
        window.setTheme(this.getAttribute('data-theme-id'));
      });
      menu.appendChild(item);
    });
    document.body.appendChild(menu);
    return menu;
  }

  function openMenu() {
    var menu = buildMenu();
    markActive();
    menu.classList.add('open');
  }

  function closeMenu() {
    var menu = document.getElementById('theme-menu');
    if (menu) menu.classList.remove('open');
  }

  // 2) Manual toggle, wired to the floating button on every page. Opens/
  //    closes the swatch picker instead of cycling through a fixed order.
  window.toggleTheme = function () {
    var menu = document.getElementById('theme-menu');
    if (menu && menu.classList.contains('open')) closeMenu();
    else openMenu();
  };

  document.addEventListener('click', function (e) {
    var menu = document.getElementById('theme-menu');
    var btn = document.querySelector('.theme-toggle');
    if (!menu || !menu.classList.contains('open')) return;
    if (!menu.contains(e.target) && e.target !== btn) closeMenu();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeMenu();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyIcon);
  else applyIcon();

  // 2b) When this page is embedded as an iframe, the parent may change the
  //     theme while we're already loaded. The parent's setTheme() writes to
  //     localStorage, which fires a 'storage' event in all same-origin
  //     iframes — pick it up and repaint immediately.
  window.addEventListener('storage', function (e) {
    if (e.key === KEY) {
      var id = migrate(e.newValue || 'calm');
      applyTheme(id);
      applyIcon();
      notify(id);
    }
  });

  // 3) Sitewide default is always Calm. Per 2026-07-21 decision: no admin
  //    override, no Firebase fetch -- Calm is the default for every page
  //    unless a visitor has themselves picked something else.
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
    Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'),
      import('./client.config.js')
    ]).then(function (mods) {
      var appMod = mods[0], CLIENT = mods[1].CLIENT;
      return import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js').then(function (dbMod) {
        var app = appMod.getApps().find(function (a) { return a.name === 'theme'; }) ||
          appMod.initializeApp(CLIENT.firebase, 'theme');
        return dbMod.get(dbMod.ref(dbMod.getDatabase(app), 'tools-you-the-winner/config/lang2-label'));
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
