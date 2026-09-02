// auth-guard.js — mel-the-winner
// Usage on each page (before </head>):
//   <style id="auth-loading-style">body{visibility:hidden;}</style>
//   <script>window.PAGE_KEY='index';</script>
//   <script type="module" src="auth-guard.js"></script>

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, get } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { CLIENT } from "./client.config.js";

// Sourced from client.config.js so a new client instance only has to edit
// CLIENT.firebase, not this file.
const FB_CONFIG = CLIENT.firebase;

// Hardcoded defaults — Firebase config overrides these.
// If a page key is missing from Firebase AND from this list, defaults to 'public'.
const DEFAULTS = {
  'index':                  'public',
  'piano':                  'public',
  'about':                  'public',
  'room-remodel':           'public',
  'daycare':                'public',
  'digital-film':           'public',
  'timeaway':               'public',
  'announce':               'public',
  'myday':                  'auth',
  'money-planner':          'auth',
  'plan2grow':              'auth',
  'teach':                  'auth',
  'coach-alignment':        'admin',
  'room-remodel-internal':  'admin',
  'admin-panel':            'admin',
  'money-planner-easy':     'public',
  'agenda-schedule':        'auth',
  // 2026-08-31 fix, per Marcelo ("demo is no longer working, it keeps
  // asking to login instead"): this page has its own guest/signed-out
  // flow built in (see the "Guest / signed-out: show welcome screen
  // first" branch and window._startDemo in my-daily-tools.html) -- an
  // anonymous visitor is meant to land here and choose Sign In or Try
  // Demo. Gating this page at 'auth' meant auth-guard.js redirected every
  // guest to /login.html before the page's own JS (containing that whole
  // flow) ever got a chance to run, so demo mode was only ever reachable
  // if a Firebase page-access/my-daily-tools override happened to say
  // 'public' -- if that override was ever cleared or never set, this
  // DEFAULTS value took over and silently broke it. Set to 'public' here
  // so it no longer depends on that override existing at all: the page's
  // own JS already correctly keeps real account data behind sign-in
  // (window._authUser), a guest just sees the welcome/demo choice instead.
  'my-daily-tools':         'public',
  'habits':                 'auth',
  // Added 2026-08-31: missing entirely before, which is what caused Calm
  // Corner to hard-404 (see accessDenied() below) for anyone once ANY
  // usergroup existed for this tenant and no group had an explicit 'r'
  // row for 'calm-corner' -- it fell through to the final `else {
  // accessDenied(); }` branch in the onAuthStateChanged handler further
  // down, same as any other page missing from this list would.
  'calm-corner':            'auth',
};

// Every page's visibility is governed by the R/W/X usergroup permission system
// (set up in admin-panel's "Feature permissions" section) — there's no separate
// public/login/admin-only page-access setting anymore, so there's only one
// place to manage who sees what. A signed-in user can view a page only if
// their usergroup has 'r' granted for that page key (or the 'public'
// pseudo-group has 'r' granted, for visitors who aren't signed in at all).
//
// admin-panel.html is the one deliberate exception: it always stays on the
// hardcoded admin check below (DEFAULTS['admin-panel'] = 'admin'), so a
// permissions mistake can never lock anyone out of the only tool that fixes
// permissions. If no usergroups have been configured at all yet, every other
// page also falls back to this same hardcoded behavior, so nothing breaks
// before the admin sets groups up for the first time.
const PAGE_KEY = window.PAGE_KEY || 'unknown';

function reveal() {
  const s = document.getElementById('auth-loading-style');
  if (s) s.remove();
  document.body.style.visibility = 'visible';
  document.body.style.opacity = '0';
  document.body.style.transition = 'opacity 0.18s ease';
  requestAnimationFrame(() => { document.body.style.opacity = '1'; });
  // Notify site-nav.js of auth state
  window._guardAuthReady = true;
  window._guardAuthUser = window._authUser || null;
  if (window._snApplyAuth) window._snApplyAuth(window._authUser || null);
}

function redirectToLogin() {
  const ret = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.replace('/login.html?return=' + ret);
}

function accessDenied() {
  // 2026-08-31 fix: this was hardcoded to '/index.html?denied=1' -- correct
  // for the Engine fork, where index.html really is the public homepage,
  // but wrong here: this Tools deployment's actual public landing page is
  // daily-tools-landing.html, and index.html doesn't exist on this site at
  // all. Any page hitting this branch (e.g. Calm Corner's missing DEFAULTS
  // entry above, now fixed, or any future page in the same situation) was
  // getting Netlify's raw 404 instead of a real "access denied" screen.
  // CLIENT.publicHome lets each fork point this at its own real landing
  // page instead of hardcoding Engine's.
  window.location.replace((CLIENT.publicHome || '/index.html') + '?denied=1');
}

// Explicit opt-OUT list — accounts here are blocked from every private page,
// regardless of which permission path (usergroups or the legacy page-access
// flow) would otherwise grant them access. Everyone else, including a
// brand-new Google sign-in, is allowed onto 'auth' pages by default; this is
// the only mechanism for manually cutting someone off (e.g. a lapsed
// subscription) — managed from Admin Settings -> Access Denylist, no code
// edits needed. Stored as a lowercase-email array at
// CLIENT.dbRootPath + '/denylist'.
async function isDenylisted(db, user) {
  if (!user) return false;
  const snap = await get(ref(db, CLIENT.dbRootPath + '/denylist')).catch(() => null);
  const list = snap?.val();
  if (!Array.isArray(list)) return false;
  return list.map(e => String(e).toLowerCase()).includes((user.email || '').toLowerCase());
}

// Shows a full-screen PIN overlay over the page (used when page has PIN access enabled).
// correctCode: the PIN value read from Firebase config.
function showPinOverlay(correctCode) {
  reveal(); // make body visible so overlay shows
  const ov = document.createElement('div');
  ov.id = 'pin-guard-overlay';
  ov.style.cssText = [
    'position:fixed','inset:0','z-index:9999',
    'background:var(--bg,#f0f4f8)',
    'display:flex','flex-direction:column','align-items:center','justify-content:center','gap:16px',
    'font-family:"Nunito",sans-serif',
  ].join(';');
  ov.innerHTML = `
    <div style="font-size:1.6rem;font-weight:800;color:var(--text,#2d3748)">Daily Check-in</div>
    <div style="font-size:0.9rem;color:var(--muted,#718096)">Enter your PIN to continue</div>
    <input id="pin-guard-input" type="password" inputmode="numeric" maxlength="8"
      placeholder="PIN"
      style="font-size:1.4rem;padding:10px 16px;border:2px solid var(--border,#cbd5e0);
             border-radius:12px;text-align:center;width:150px;outline:none;
             font-family:'Nunito',sans-serif;background:var(--surface,#fff);color:var(--text,#2d3748);">
    <button id="pin-guard-btn"
      style="background:#4299e1;color:#fff;border:none;border-radius:12px;
             padding:10px 32px;font-size:1rem;font-weight:700;cursor:pointer;
             font-family:'Nunito',sans-serif;">
      Enter
    </button>
    <div id="pin-guard-err" style="color:#c53030;font-size:0.85rem;display:none;">
      Incorrect PIN — try again.
    </div>
  `;
  document.body.appendChild(ov);

  function tryPin() {
    const val = (document.getElementById('pin-guard-input')?.value || '').trim();
    if (val === String(correctCode)) {
      window._pinAccess = true;
      ov.remove();
      // Notify the page that PIN was accepted (for hiding restricted sections, etc.)
      window.dispatchEvent(new CustomEvent('pin-access-granted'));
    } else {
      const err = document.getElementById('pin-guard-err');
      if (err) err.style.display = 'block';
      const inp = document.getElementById('pin-guard-input');
      if (inp) { inp.value = ''; inp.focus(); }
    }
  }

  const btn = document.getElementById('pin-guard-btn');
  const inp = document.getElementById('pin-guard-input');
  if (btn) btn.addEventListener('click', tryPin);
  if (inp) {
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryPin(); });
    setTimeout(() => inp.focus(), 100);
  }
}

// ── MULTI-TENANT DATA ROOT (Rule 6a in OPERATOR-NOTES.md — Tier 1 groundwork) ──
// Historically every page hardcoded 'mel-the-winner/...' as the literal data
// path, meaning every signed-in account shared ONE pool of data — fine when
// this deployment was built for one person (Mel), but not once other real
// accounts start using the same deployment's generic tools. This resolves,
// per signed-in user, which data root their reads/writes should use:
//   - CLIENT.primaryAdminEmail (the account this instance was built around,
//     e.g. Mel) keeps using the original, unscoped CLIENT.dbRootPath exactly
//     as before — zero behavior change for that account.
//   - Every other authenticated account gets its own isolated subtree at
//     'users/' + uid — REUSING the per-user root my-daily-tools.html's Plans/
//     Wishlist/Money-Planner/Family-Plan-Sharing features already established
//     (see UP in my-daily-tools.html), NOT a new path. The Firebase rule for
//     users/$uid already exists and already covers any child key placed under
//     it, so no new Firebase Console step is needed for features that adopt
//     window._tenantRoot.
// This is inert until a page's own script actually reads window._tenantRoot
// instead of hardcoding CLIENT.dbRootPath — converting each feature over is
// separate, incremental work (see OPERATOR-NOTES.md Rule 6a).
function computeTenantRoot(user) {
  if (!user) return CLIENT.dbRootPath;
  const email = (user.email || '').toLowerCase();
  if (email === CLIENT.primaryAdminEmail) return CLIENT.dbRootPath;
  return 'users/' + user.uid;
}
// Safe default before auth resolves, so anything that reads this early still
// gets a valid (shared/legacy) path rather than undefined.
window._tenantRoot = CLIENT.dbRootPath;

// Wire up a page's logout button (id="logout-btn"), if present.
function setupLogout(auth) {
  const btn = document.getElementById('logout-btn');
  if (!btn) return;
  btn.style.display = 'inline-block';
  btn.addEventListener('click', async () => {
    try { await signOut(auth); } catch (e) {}
    window.location.replace('/login.html');
  });
}

// Returns the R/W/X permission object for the given page key, for either the
// signed-in user's group(s) or, if not signed in, the 'public' pseudo-group.
// Returns null if no usergroups have been configured at all yet (caller should
// fall back to ordinary page-access behavior in that case).
async function getFeaturePermission(db, pageKey, user) {
  const [groupsSnap, permsSnap] = await Promise.all([
    get(ref(db, CLIENT.dbRootPath + '/usergroups')),
    get(ref(db, CLIENT.dbRootPath + '/permissions')),
  ]);
  const groups = groupsSnap.val() || {};
  if (Object.keys(groups).length === 0) return null; // not configured yet
  const perms = permsSnap.val() || {};

  // Expose full data so site-nav.js can filter menu links by permission
  window._guardGroups = groups;
  window._guardPerms  = perms;
  const pub = perms.public?.[pageKey] || { r: false, w: false, x: false };

  if (!user) {
    return pub;
  }
  const myEmail = (user.email || '').toLowerCase();
  const myGroupKeys = Object.entries(groups)
    .filter(([, g]) => (g.members || []).map(m => String(m).toLowerCase()).includes(myEmail))
    .map(([k]) => k);
  // Anything open to the public is also open to a signed-in user, even if their
  // own group(s) don't separately grant it — being logged in should never grant
  // *less* access than an anonymous visitor (this also prevents an accessDenied
  // -> index.html?denied=1 -> accessDenied redirect loop for any logged-in user
  // whose groups don't happen to list every publicly-readable page).
  const r = pub.r === true || myGroupKeys.some(gk => perms[gk]?.[pageKey]?.r === true);
  const w = pub.w === true || myGroupKeys.some(gk => perms[gk]?.[pageKey]?.w === true);
  const x = pub.x === true || myGroupKeys.some(gk => perms[gk]?.[pageKey]?.x === true);
  return { r, w, x };
}

try {
  const existing = getApps().find(a => a.name === 'guard');
  const app = existing || initializeApp(FB_CONFIG, 'guard');
  const auth = getAuth(app);
  const db   = getDatabase(app);

  if (PAGE_KEY !== 'admin-panel') {
    // Feature-permission decides visibility for every page except admin-panel:
    // check R access via usergroups first; only fall back to the hardcoded
    // default if no groups are configured yet.
    const unsubPerm = onAuthStateChanged(auth, async (user) => {
      unsubPerm();

      // PIN gate — runs FIRST, before any permission logic.
      if (!user && window.PAGE_PIN_KEY) {
        const pinPath = CLIENT.dbRootPath + '/config/' + window.PAGE_PIN_KEY;
        const pinSnap = await get(ref(db, pinPath)).catch(() => null);
        const pinCfg  = pinSnap?.val() || {};
        if (pinCfg.public === true) {
          // Fully public — no login, no PIN needed
          window._pinAccess = true;
          reveal();
          return;
        }
        if (pinCfg.enabled && pinCfg.code) {
          showPinOverlay(pinCfg.code);
          return;
        }
      }

      // Denylist — blocks a specific signed-in account from every gated page,
      // ahead of either permission system below.
      if (await isDenylisted(db, user)) {
        await signOut(auth);
        accessDenied();
        return;
      }

      const perm = await getFeaturePermission(db, PAGE_KEY, user).catch(() => undefined);
      if (perm === null) {
        // Not configured yet — behave exactly like a normal page-access page.
        runPageAccessFlow(db, auth);
        return;
      }
      if (perm === undefined) {
        // Firebase read error — fail open rather than locking the page.
        if (user) { window._authUser = user; window._tenantRoot = computeTenantRoot(user); }
        setupLogout(auth);
        reveal();
        return;
      }
      if (perm.r) {
        if (user) { window._authUser = user; window._tenantRoot = computeTenantRoot(user); setupLogout(auth); }
        reveal();
      } else if (!user) {
        redirectToLogin();
      } else if (PAGE_KEY in DEFAULTS) {
        // Signed in but no explicit permissions row yet for this page.
        // Fall back to the DEFAULTS behaviour so pages like habits.html
        // are not blocked just because no one has configured their row yet.
        runPageAccessFlow(db, auth);
      } else {
        accessDenied();
      }
    });
  } else {
    await runPageAccessFlow(db, auth);
  }
} catch(e) {
  // If anything goes wrong in the guard, reveal the page so it's never stuck hidden
  console.warn('[auth-guard] error, revealing anyway:', e);
  reveal();
}

// Original public/auth/admin access flow. Used permanently for admin-panel.html,
// and as the fallback for every other page before any usergroups have been set up.
async function runPageAccessFlow(db, auth) {
 try {
  // Read page access config from Firebase; fall back to hardcoded defaults
  const snap   = await get(ref(db, CLIENT.dbRootPath + '/page-access/' + PAGE_KEY));
  const access = snap.val() || DEFAULTS[PAGE_KEY] || 'public';

  if (access === 'public') {
    reveal();
  } else {
    // Need authentication — onAuthStateChanged fires immediately with cached state
    const unsub = onAuthStateChanged(auth, async (user) => {
      unsub(); // only need initial state

      if (!user) {
        redirectToLogin();
        return;
      }

      // Denylist — blocks a specific signed-in account from every gated page.
      // Everyone else is allowed by default (open sign-in).
      if (await isDenylisted(db, user)) {
        await signOut(auth);
        accessDenied();
        return;
      }

      if (access === 'admin') {
        const email = (user.email || '').toLowerCase();
        const roleSnap = await get(ref(db, CLIENT.dbRootPath + '/user-roles/' + user.uid));
        // CLIENT.primaryAdminEmail always has admin access
        if (email === CLIENT.primaryAdminEmail || roleSnap.val() === 'admin') {
          window._authUser = user;
          window._tenantRoot = computeTenantRoot(user);
          window._authRole = 'admin';
          setupLogout(auth);
          reveal();
        } else {
          accessDenied();
        }
      } else {
        // 'auth' — any logged-in, non-denylisted user can access
        window._authUser = user;
        window._tenantRoot = computeTenantRoot(user);
        setupLogout(auth);
        reveal();
      }
    });
  }
 } catch(e) {
   console.warn('[auth-guard] error, revealing anyway:', e);
   reveal();
 }
}
