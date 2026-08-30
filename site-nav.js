/**
 * site-nav.js — Mel The Winner shared navigation
 * Drop ONE line anywhere in <body>: <script src="site-nav.js"></script>
 * The script injects CSS + sticky top nav + mobile drawer automatically.
 * Auth-aware: Mel's Tools links appear only when signed in.
 */
(function () {
  'use strict';

  // ── Detect current page ──────────────────────────────────────────────
  const _page = location.pathname.split('/').pop().replace('.html', '') || 'index';

  // ── Navigation structure ─────────────────────────────────────────────

  // Always visible top-bar links (minimal)
  const PUBLIC_LINKS = [
    { href: 'daily-tools-landing.html', label: '🏠 Home' },
  ];

  // "My Projects" dropdown — not used on Tools (that's Mel/Engine-instance
  // content, lives in its own project now). Left empty rather than removed
  // so buildNav()'s existing "hide if nothing visible" logic just works.
  const PROJECTS_LINKS = [];

  // "My Tools" dropdown — shown only when signed in
  const TOOLS_LINKS = [
    { href: 'my-daily-tools.html', label: '🌿 My Daily Tools' },
    { href: 'calm-corner.html',    label: '🌊 Calm Corner' },
  ];

  // Admin-only extras (shown inside My Tools when admin)
  const ADMIN_LINKS = [
    { href: 'migrate-to-users.html', label: '🔧 Migrate Data' },
  ];

  // ── CSS ─────────────────────────────────────────────────────────────
  const CSS = `
:root { --sn-h: 52px; }
/* Hide language toggle by default — overridden by Firebase config if enabled */
.lang-toggle, .lang-toggle-btn { display: none !important; }
.site-lang-enabled .lang-toggle, .site-lang-enabled .lang-toggle-btn { display: flex !important; }
#mel-site-nav {
  position: sticky; top: 0; left: 0; right: 0; z-index: 900;
  background: var(--surface, #fff);
  border-bottom: 1.5px solid var(--border, #cfddd8);
  font-family: 'Nunito', sans-serif;
  box-shadow: 0 1px 8px rgba(0,0,0,0.06);
}
#mel-site-nav .nav-inner {
  max-width: 1100px; margin: 0 auto; height: var(--sn-h);
  display: flex; align-items: center; gap: 0; padding: 0 14px;
}
#mel-site-nav .nav-logo {
  font-size: 0.82rem; font-weight: 800; letter-spacing: 2.5px;
  text-transform: uppercase; color: var(--accent, #2a7d6f);
  text-decoration: none; white-space: nowrap; flex-shrink: 0;
  display: flex; align-items: center; gap: 5px;
}
#mel-site-nav .nav-logo .logo-trophy { font-size: 1rem; }
#mel-site-nav .nav-sep { width: 1px; height: 24px; background: var(--border, #cfddd8); margin: 0 10px; flex-shrink: 0; }
/* Desktop link bar */
#mel-site-nav .nav-links {
  display: flex; align-items: center; justify-content: center; gap: 1px; flex: 1;
  overflow: hidden; min-width: 0;
}
#mel-site-nav .nav-links a {
  display: inline-flex; align-items: center; padding: 6px 9px;
  border-radius: 8px; font-size: 0.68rem; font-weight: 700;
  letter-spacing: 0.5px; color: var(--muted, #6b8c85);
  text-decoration: none; white-space: nowrap;
  transition: background 0.15s, color 0.15s;
}
#mel-site-nav .nav-links a:hover,
#mel-site-nav .nav-links a.active {
  background: var(--accent-light, #e0eeea); color: var(--accent, #2a7d6f);
}
/* Dropdown trigger buttons in nav bar */
#mel-site-nav .nav-dropdown-btn {
  display: inline-flex; align-items: center; gap: 4px; padding: 6px 9px;
  border-radius: 8px; font-size: 0.68rem; font-weight: 700;
  letter-spacing: 0.5px; color: var(--muted, #6b8c85);
  background: none; border: none; cursor: pointer; white-space: nowrap;
  font-family: 'Nunito', sans-serif;
  transition: background 0.15s, color 0.15s;
}
#mel-site-nav .nav-dropdown-btn:hover,
#mel-site-nav .nav-dropdown-btn.active {
  background: var(--accent-light, #e0eeea); color: var(--accent, #2a7d6f);
}
/* "My Tools" pill button */
#mel-site-nav .tools-btn {
  display: none; align-items: center; gap: 5px;
  padding: 7px 12px; border-radius: 99px;
  background: var(--accent, #2a7d6f); color: #fff;
  font-family: 'Nunito', sans-serif; font-size: 0.7rem; font-weight: 800;
  border: none; cursor: pointer; white-space: nowrap; flex-shrink: 0;
  transition: background 0.15s;
}
#mel-site-nav .tools-btn:hover { background: #1e6058; }
#mel-site-nav .tools-btn.show { display: inline-flex; }
/* Right controls */
#mel-site-nav .nav-right {
  display: flex; align-items: center; gap: 6px; margin-left: auto; flex-shrink: 0;
}
#mel-site-nav .nav-icon-btn {
  width: 32px; height: 32px; border-radius: 50%; border: 1.5px solid var(--border, #cfddd8);
  background: var(--surface2, #e8f0ed); display: flex; align-items: center;
  justify-content: center; cursor: pointer; font-size: 0.9rem;
  transition: all 0.15s; flex-shrink: 0;
}
#mel-site-nav .nav-icon-btn:hover { background: var(--accent-light, #e0eeea); border-color: var(--accent, #2a7d6f); }
/* Hamburger */
#mel-site-nav .nav-hamburger {
  display: none; width: 34px; height: 34px; border-radius: 8px;
  background: var(--surface2, #e8f0ed); border: 1.5px solid var(--border, #cfddd8);
  flex-direction: column; align-items: center; justify-content: center;
  gap: 4px; cursor: pointer; flex-shrink: 0; transition: all 0.15s;
}
#mel-site-nav .nav-hamburger:hover { background: var(--accent-light, #e0eeea); }
#mel-site-nav .nav-hamburger span { display: block; width: 16px; height: 1.5px; background: var(--muted, #6b8c85); border-radius: 2px; transition: all 0.2s; }
#mel-site-nav .nav-hamburger.open span:nth-child(1) { transform: translateY(5.5px) rotate(45deg); }
#mel-site-nav .nav-hamburger.open span:nth-child(2) { opacity: 0; }
#mel-site-nav .nav-hamburger.open span:nth-child(3) { transform: translateY(-5.5px) rotate(-45deg); }
/* Shared dropdown panel styles */
.sn-dropdown {
  position: fixed; top: var(--sn-h);
  background: var(--surface, #fff); border: 1.5px solid var(--border, #cfddd8);
  border-radius: 16px; box-shadow: 0 8px 28px rgba(0,0,0,0.13);
  padding: 8px; min-width: 200px; display: none; flex-direction: column; gap: 2px;
  z-index: 901; animation: snFadeIn 0.15s ease;
}
.sn-dropdown.open { display: flex; }
.sn-dropdown a, #mel-drawer a {
  display: flex; align-items: center; padding: 8px 12px; border-radius: 9px;
  font-family: 'Nunito', sans-serif; font-size: 0.74rem; font-weight: 700;
  color: var(--muted, #6b8c85); text-decoration: none; transition: all 0.12s;
}
.sn-dropdown a:hover, #mel-drawer a:hover {
  background: var(--accent-light, #e0eeea); color: var(--accent, #2a7d6f);
}
.sn-dropdown a.active, #mel-drawer a.active {
  background: var(--accent-light, #e0eeea); color: var(--accent, #2a7d6f);
}
.sn-divider { height: 1px; background: var(--border, #cfddd8); margin: 5px 6px; }
.sn-section-label {
  font-family: 'Nunito', sans-serif; font-size: 0.56rem; font-weight: 800;
  letter-spacing: 2.5px; text-transform: uppercase; color: var(--soft, #a8c4bc);
  padding: 6px 12px 2px;
}
/* Mobile drawer */
#mel-drawer {
  position: fixed; inset: 0; top: var(--sn-h); z-index: 890;
  background: var(--surface, #fff); overflow-y: auto;
  display: none; flex-direction: column; padding: 10px 12px 30px;
  animation: snFadeIn 0.18s ease;
}
#mel-drawer.open { display: flex; }
#mel-drawer .dr-section-label {
  font-size: 0.58rem; font-weight: 800; letter-spacing: 2.5px;
  text-transform: uppercase; color: var(--soft, #a8c4bc); padding: 10px 12px 4px;
}
#mel-drawer .dr-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 6px;
}
#mel-drawer a {
  font-size: 0.78rem; border-radius: 10px; padding: 10px 12px;
}
@keyframes snFadeIn { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } }
/* Hide legacy site-menu ☰ buttons (replaced by this nav) */
.site-menu { display: none !important; }
/* Responsive */
@media (max-width: 768px) {
  #mel-site-nav .nav-links { display: none; }
  #mel-site-nav .nav-sep { display: none; }
  #mel-site-nav .tools-btn { display: none !important; }
  #mel-site-nav .nav-dropdown-btn { display: none; }
  #mel-site-nav .nav-hamburger { display: flex; }
}
@media (min-width: 769px) {
  #mel-drawer { display: none !important; }
}
`;

  // ── HTML builder ─────────────────────────────────────────────────────
  function isActive(href) {
    const name = href.replace('.html','');
    return name === _page || href === _page + '.html';
  }

  // Check if current page is inside a group (for highlighting the dropdown btn)
  function groupHasActive(links) {
    return links.some(l => isActive(l.href));
  }

  // Helper: turn href into page key (matches Firebase permission keys)
  function pageKey(href) { return href.replace('.html', '') || 'index'; }

  // Build an <a> tag with data-nav-page for permission filtering
  function navLink(l, extra) {
    return `<a href="${l.href}" class="${isActive(l.href)?'active':''}" data-nav-page="${pageKey(l.href)}"${extra||''}>${l.label}</a>`;
  }

  function buildNav() {
    const publicLinksHtml = PUBLIC_LINKS.map(l => navLink(l)).join('');
    const projActive = groupHasActive(PROJECTS_LINKS) ? ' active' : '';

    return `
<div class="nav-inner">
  <a class="nav-logo" href="daily-tools-landing.html"><span class="logo-trophy">🏆</span>daily tools</a>
  <div class="nav-sep"></div>
  <nav class="nav-links" aria-label="Main navigation">
    ${publicLinksHtml}
    <button class="nav-dropdown-btn${projActive}" id="snProjectsBtn" aria-haspopup="true" aria-expanded="false">🌟 My Projects ▾</button>
  </nav>
  <div class="nav-right">
    <a href="login.html" id="snSignInLink" style="display:none;align-items:center;gap:4px;padding:7px 13px;border-radius:99px;border:1.5px solid var(--border,#cfddd8);font-family:'Nunito',sans-serif;font-size:0.7rem;font-weight:800;color:var(--muted,#6b8c85);text-decoration:none;white-space:nowrap;transition:all 0.15s;flex-shrink:0;" onmouseover="this.style.borderColor='var(--accent,#2a7d6f)';this.style.color='var(--accent,#2a7d6f)';" onmouseout="this.style.borderColor='var(--border,#cfddd8)';this.style.color='var(--muted,#6b8c85)';">🔑 Sign in</a>
    <button class="tools-btn" id="snToolsBtn" aria-haspopup="true" aria-expanded="false" title="Mel's private tools">🛠️ My Tools ▾</button>
    <button class="nav-icon-btn" onclick="if(window.toggleTheme)toggleTheme(); else document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'':'dark';" title="Toggle theme" aria-label="Toggle theme">🌙</button>
    <button class="nav-hamburger" id="snHamburger" aria-label="Open menu" aria-expanded="false">
      <span></span><span></span><span></span>
    </button>
  </div>
</div>
<!-- Projects dropdown (desktop) -->
<div id="mel-projects-dropdown" class="sn-dropdown" role="menu" aria-label="My Projects">
  <div class="sn-section-label">🌟 My Projects</div>
  ${PROJECTS_LINKS.map(l => navLink(l, ' role="menuitem"')).join('')}
</div>
<!-- Tools dropdown (desktop) -->
<div id="mel-tools-dropdown" class="sn-dropdown" role="menu" aria-label="Mel's Tools">
  <div class="sn-section-label">🔐 Mel's Tools</div>
  ${TOOLS_LINKS.map(l => navLink(l, ' role="menuitem"')).join('')}
  <div id="sn-admin-section" style="display:none;">
    <div class="sn-divider"></div>
    <div class="sn-section-label">⚙️ Admin</div>
    ${ADMIN_LINKS.map(l => navLink(l, ' role="menuitem"')).join('')}
  </div>
</div>
<!-- Mobile drawer -->
<div id="mel-drawer" role="dialog" aria-label="Site navigation">
  <div class="dr-section-label">Pages</div>
  <div class="dr-grid">
    ${PUBLIC_LINKS.map(l => navLink(l)).join('')}
  </div>
  <div id="sn-drawer-projects">
    <div class="dr-section-label">🌟 My Projects</div>
    <div class="dr-grid">
      ${PROJECTS_LINKS.map(l => navLink(l)).join('')}
    </div>
  </div>
  <div id="sn-drawer-signin" style="display:none;">
    <div class="dr-grid" style="grid-template-columns:1fr;">
      <a href="login.html" style="background:var(--accent,#2a7d6f);color:#fff;border-radius:10px;padding:11px 14px;font-weight:800;justify-content:center;">🔑 Sign in</a>
    </div>
  </div>
  <div id="sn-drawer-tools" style="display:none;">
    <div class="dr-section-label">🔐 Mel's Tools</div>
    <div class="dr-grid">
      ${TOOLS_LINKS.map(l => navLink(l)).join('')}
    </div>
  </div>
  <div id="sn-drawer-admin" style="display:none;">
    <div class="dr-section-label">⚙️ Admin</div>
    <div class="dr-grid">
      ${ADMIN_LINKS.map(l => navLink(l)).join('')}
    </div>
  </div>
  <div class="sn-divider" style="margin:14px 0;"></div>
  <div style="padding:0 12px;">
    <button onclick="if(window.toggleTheme)toggleTheme();" style="width:100%;padding:10px;border-radius:10px;border:1.5px solid var(--border,#cfddd8);background:var(--surface2,#e8f0ed);font-family:'Nunito',sans-serif;font-size:0.78rem;font-weight:700;color:var(--muted,#6b8c85);cursor:pointer;">🌙 Toggle Theme</button>
  </div>
</div>
`;
  }

  // ── Inject into DOM ──────────────────────────────────────────────────
  function inject() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const nav = document.createElement('div');
    nav.id = 'mel-site-nav';
    nav.setAttribute('role', 'banner');
    nav.innerHTML = buildNav();

    document.body.insertBefore(nav, document.body.firstChild);
    _wireInteractions();
    _authCheck();
  }

  function _wireInteractions() {
    const projectsBtn = document.getElementById('snProjectsBtn');
    const projectsDd  = document.getElementById('mel-projects-dropdown');
    const toolsBtn    = document.getElementById('snToolsBtn');
    const toolsDd     = document.getElementById('mel-tools-dropdown');

    // Position dropdown under the button that opened it
    function positionDropdown(dd, btn) {
      if (!btn || !dd) return;
      const r = btn.getBoundingClientRect();
      dd.style.left = Math.min(r.left, window.innerWidth - 220) + 'px';
      dd.style.right = 'auto';
    }

    function closeAll() {
      projectsDd?.classList.remove('open');
      toolsDd?.classList.remove('open');
      projectsBtn?.setAttribute('aria-expanded', 'false');
      toolsBtn?.setAttribute('aria-expanded', 'false');
    }

    if (projectsBtn && projectsDd) {
      projectsBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        const willOpen = !projectsDd.classList.contains('open');
        closeAll();
        if (willOpen) {
          positionDropdown(projectsDd, projectsBtn);
          projectsDd.classList.add('open');
          projectsBtn.setAttribute('aria-expanded', 'true');
        }
      });
    }

    if (toolsBtn && toolsDd) {
      toolsBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        const willOpen = !toolsDd.classList.contains('open');
        closeAll();
        if (willOpen) {
          positionDropdown(toolsDd, toolsBtn);
          toolsDd.classList.add('open');
          toolsBtn.setAttribute('aria-expanded', 'true');
        }
      });
    }

    // Hamburger (mobile)
    const ham    = document.getElementById('snHamburger');
    const drawer = document.getElementById('mel-drawer');
    if (ham && drawer) {
      ham.addEventListener('click', function (e) {
        e.stopPropagation();
        const open = drawer.classList.toggle('open');
        ham.classList.toggle('open', open);
        ham.setAttribute('aria-expanded', open);
      });
    }

    // Close dropdowns on outside click
    document.addEventListener('click', closeAll);

    // Keyboard: close on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeAll();
        drawer?.classList.remove('open');
        ham?.classList.remove('open');
      }
    });
  }

  function _authCheck() {
    let attempts = 0;
    const interval = setInterval(function () {
      attempts++;
      if (window._guardAuthReady) {
        clearInterval(interval);
        _applyAuthUI(window._guardAuthUser || null);
        return;
      }
      if (window._melUser !== undefined) {
        clearInterval(interval);
        _applyAuthUI(window._melUser);
        return;
      }
      if (attempts > 40) clearInterval(interval);
    }, 250);
  }

  function _applyAuthUI(user) {
    const isAdmin    = user && (user.email === '123mja@gmail.com');
    const isSignedIn = !!user;

    // Sign-in link: visible to guests, hidden once logged in
    const signInLink    = document.getElementById('snSignInLink');
    const drawerSignIn  = document.getElementById('sn-drawer-signin');
    if (signInLink)   signInLink.style.display   = isSignedIn ? 'none' : 'inline-flex';
    if (drawerSignIn) drawerSignIn.style.display  = isSignedIn ? 'none' : '';

    const toolsBtn = document.getElementById('snToolsBtn');
    if (toolsBtn && isSignedIn) toolsBtn.classList.add('show');

    const adminSection = document.getElementById('sn-admin-section');
    if (adminSection && isAdmin) adminSection.style.display = '';

    const drawerTools = document.getElementById('sn-drawer-tools');
    if (drawerTools && isSignedIn) drawerTools.style.display = '';

    const drawerAdmin = document.getElementById('sn-drawer-admin');
    if (drawerAdmin && isAdmin) drawerAdmin.style.display = '';

    _filterNavByPermissions(user);
  }

  // Hide nav links for pages the current user cannot read (r flag off).
  // Runs after auth-guard.js has populated window._guardGroups/_guardPerms.
  function _filterNavByPermissions(user) {
    var groups = window._guardGroups;
    var perms  = window._guardPerms;
    if (!groups || !perms) return; // permissions not loaded yet — show everything

    // Determine which Firebase usergroup keys the current user belongs to
    var email = user ? (user.email || '').toLowerCase() : null;
    var userGroupKeys = email
      ? Object.entries(groups)
          .filter(function(e) {
            return (e[1].members || []).map(function(m){ return String(m).toLowerCase(); }).includes(email);
          })
          .map(function(e){ return e[0]; })
      : [];

    function canRead(pk) {
      // Public group grants access to everyone (signed-in or not)
      if (perms.public && perms.public[pk] && perms.public[pk].r === true) return true;
      if (!user) return false;
      // Check the user's own groups
      return userGroupKeys.some(function(gk) {
        return perms[gk] && perms[gk][pk] && perms[gk][pk].r === true;
      });
    }

    // Show/hide every nav link tagged with data-nav-page
    document.querySelectorAll('[data-nav-page]').forEach(function(el) {
      el.style.display = canRead(el.dataset.navPage) ? '' : 'none';
    });

    // If every project link is hidden, hide the "My Projects" button + drawer section too
    var anyProjVisible = PROJECTS_LINKS.some(function(l) { return canRead(pageKey(l.href)); });
    var projBtn        = document.getElementById('snProjectsBtn');
    var projDd         = document.getElementById('mel-projects-dropdown');
    var drawerProjects = document.getElementById('sn-drawer-projects');
    if (projBtn)        projBtn.style.display        = anyProjVisible ? '' : 'none';
    if (projDd)         projDd.style.display         = anyProjVisible ? '' : 'none';
    if (drawerProjects) drawerProjects.style.display  = anyProjVisible ? '' : 'none';
  }

  // ── Run ──────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
