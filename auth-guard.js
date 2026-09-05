// auth-guard.js — mel-the-winner
// Usage on each page (before </head>):
//   <style id="auth-loading-style">body{visibility:hidden;}</style>
//   <script>window.PAGE_KEY='index';</script>
//   <script type="module" src="auth-guard.js"></script>

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, get, set } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
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
  // Added 2026-09-04, per Marcelo's "digital picture frame" idea — a
  // read-only, auto-rotating full-screen view (kiosk.html) meant for a
  // spare tablet/phone left running somewhere shared. Same access level as
  // My Day / Money: any signed-in account can open it, gated to their own
  // data (there is no separate admin/caregiver-only concept for this page).
  'kiosk':                   'auth',
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

// ── FREE TRIAL GATE (added 2026-09-04, per Marcelo) ──────────────────────
// Every account gets a free trial from its first-ever sign-in before it
// needs a real Stripe subscription (users/{uid}/subscription/status ===
// 'active' | 'comp' | 'past_due' — see netlify/functions/_packs.js's
// mapStatus() and SUBSCRIPTION-ARCHITECTURE.md) to keep using any
// 'auth'-gated page.
//
// Deliberately does NOT sign the person out or touch the Denylist — a
// trial-expired visitor stays signed in and is redirected to
// subscribe.html?trial=expired instead, which offers Subscribe, Export My
// Data, and Delete My Account & Data. The goal is "please subscribe," not
// "you're banned" — nobody should end up feeling like their data was taken
// hostage; see that page's own comments for the export/delete flow.
//
// Grandfathering: an account is only ever timed if its very first sign-in
// happens AFTER this feature shipped. That's detected without a separate
// migration step: tools-you-the-winner/user-index/{uid} (written by
// my-daily-tools.html on every real sign-in, long before this feature
// existed) already exists for every pre-existing account, so the first
// time THIS code sees such an account with no trial record yet, it marks
// it trial.exempt = true once instead of starting a clock. Only a uid with
// no user-index entry AND no trial record is treated as brand new.
//
// Configurable policy (added 2026-09-04, same day, per Marcelo — "make it
// configurable, we may decide to change for one reason or another"):
// trial length, the grace period before an unsubscribed account becomes
// eligible for deletion, whether email reminders are on, and the re-trial
// cooldown after a deletion all live in Firebase at
// tools-you-the-winner/config/trial, editable from Settings > Admin >
// "Trial & Data Retention" in my-daily-tools.html — no code deploy needed
// to change them. TRIAL_DEFAULTS below are ONLY the fallback used if that
// config node is missing or unreadable; they are not the source of truth.
// NOTE: graceDays/emailRemindersEnabled are read and shown to the user
// (subscribe.html's banner) but the actual scheduled deletion sweep and
// email sending are a separate, not-yet-built server-side job — see the
// you-the-winner-tools skill for that design writeup.
const TRIAL_DEFAULTS = {
  trialDays: 14,
  graceDays: 90,
  cooldownDays: 365,
  emailRemindersEnabled: false,
};

async function loadTrialConfig(db) {
  try {
    const snap = await get(ref(db, 'tools-you-the-winner/config/trial'));
    const cfg = snap.val() || {};
    return {
      trialDays: typeof cfg.trialDays === 'number' ? cfg.trialDays : TRIAL_DEFAULTS.trialDays,
      graceDays: typeof cfg.graceDays === 'number' ? cfg.graceDays : TRIAL_DEFAULTS.graceDays,
      cooldownDays: typeof cfg.cooldownDays === 'number' ? cfg.cooldownDays : TRIAL_DEFAULTS.cooldownDays,
      emailRemindersEnabled: cfg.emailRemindersEnabled === true,
    };
  } catch (e) {
    return TRIAL_DEFAULTS; // fail open toward defaults, same asymmetry as isTrialExpired() below
  }
}

// SHA-256 hex hash of a lowercased email — used ONLY as an anti-abuse key
// in the re-trial cooldown ledger (tools-you-the-winner/trial-cooldown/
// {hash}), never the plaintext email. Without this, "Delete my account &
// data" on subscribe.html (which really does remove everything, including
// the Auth account) would let anyone reset their own trial clock forever
// by deleting and signing up again. The ledger entry is deliberately just
// {expiresAt} keyed by a hash — nothing that reads as "their data" once
// they've asked for it gone. subscribe.html's _deleteMyAccountNow() writes
// this same ledger entry at delete time.
async function hashEmailForCooldown(email) {
  const bytes = new TextEncoder().encode((email || '').toLowerCase().trim());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function isTrialExpired(db, user) {
  if (!user) return false;
  const myEmail = (user.email || '').toLowerCase();
  const adminEmails = (CLIENT.adminEmails || []).map(e => (e || '').toLowerCase());
  if (adminEmails.includes(myEmail)) return false; // admin account(s) never gated

  const uid = user.uid;
  const cfg = await loadTrialConfig(db);
  const trialMs = cfg.trialDays * 24 * 60 * 60 * 1000;

  let subStatus, trial, hasUserIndex;
  try {
    const [subSnap, trialSnap, indexSnap] = await Promise.all([
      get(ref(db, 'users/' + uid + '/subscription/status')),
      get(ref(db, 'users/' + uid + '/daily-tools/trial')),
      get(ref(db, 'tools-you-the-winner/user-index/' + uid)),
    ]);
    subStatus = subSnap.val();
    trial = trialSnap.val() || {};
    hasUserIndex = indexSnap.exists();
  } catch (e) {
    // Fail OPEN, not closed — a Firebase read error should never lock a
    // real (possibly paying) account out of their own app. Contrast with
    // isDenylisted() above, which fails closed, because that check
    // protects against a different, higher-stakes failure mode (a banned
    // account slipping through) than this one does.
    return false;
  }

  if (subStatus === 'active' || subStatus === 'comp' || subStatus === 'past_due') return false; // has (or recently had) a real subscription
  if (trial.exempt === true) return false;

  if (trial.firstSignInAt) {
    return (Date.now() - trial.firstSignInAt) >= trialMs;
  }

  // No trial record yet for this uid — first time this code has ever seen
  // them. Decide grandfather vs. brand-new, then never re-decide it again.
  if (hasUserIndex) {
    set(ref(db, 'users/' + uid + '/daily-tools/trial/exempt'), true).catch(() => {});
    return false;
  }

  // Brand new account (no user-index, no trial record). Before starting a
  // fresh trial, check the re-trial cooldown ledger — an email that
  // deleted its account recently doesn't get another full trial window.
  try {
    const hash = await hashEmailForCooldown(myEmail);
    const cooldownSnap = await get(ref(db, 'tools-you-the-winner/trial-cooldown/' + hash));
    const cooldown = cooldownSnap.val();
    if (cooldown && typeof cooldown.expiresAt === 'number' && Date.now() < cooldown.expiresAt) {
      // Start this account already at the end of its trial rather than at
      // day 0, so it goes straight to subscribe.html instead of getting a
      // brand-new free window.
      set(ref(db, 'users/' + uid + '/daily-tools/trial/firstSignInAt'), Date.now() - trialMs - 1).catch(() => {});
      return true;
    }
  } catch (e) {
    // Fail open here too — an unreadable cooldown ledger should never
    // block a genuinely new signup from getting their trial.
  }

  set(ref(db, 'users/' + uid + '/daily-tools/trial/firstSignInAt'), Date.now()).catch(() => {});
  return false; // day 0 of a brand-new trial — definitely not expired yet
}

function redirectToSubscribe() {
  window.location.replace('/subscribe.html?trial=expired');
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

      // Free trial gate — ahead of either permission system below, same as
      // the Denylist check above, so it applies no matter which access-
      // control path (legacy DEFAULTS or the newer R/W/X permissions
      // system) currently governs this page. Only ever evaluated for a
      // signed-in user; an anonymous/demo visitor has no trial to expire.
      // See isTrialExpired()'s own header comment above for the full
      // design (grandfathering, admin exemption, subscription exemption,
      // and why this redirects instead of signing out / denylisting).
      if (user && await isTrialExpired(db, user)) {
        redirectToSubscribe();
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
        // 2026-09-04 fix, per Marcelo ("demo no longer works, it keeps
        // asking the user to login"): this branch used to redirect every
        // anonymous visitor straight to login, full stop -- it never
        // consulted DEFAULTS at all. That's exactly what silently re-broke
        // my-daily-tools's guest/demo flow (window._startDemo) again after
        // the 2026-08-31 fix that set DEFAULTS['my-daily-tools'] = 'public':
        // that fix only helps once execution reaches runPageAccessFlow()
        // (the "not configured yet" branch above, or the signed-in
        // PAGE_KEY-in-DEFAULTS branch below) -- but the moment ANY
        // usergroup exists for this tenant (see admin-settings.html's
        // ALL_PAGES / Feature Permissions grid), getFeaturePermission()
        // takes over for every anonymous request, and 'my-daily-tools' was
        // sitting at "Not configured" there (no explicit 'r' row for the
        // 'public' pseudo-group), so perm.r came back false and this
        // branch fired before DEFAULTS was ever looked at. A page whose
        // hardcoded DEFAULTS really is 'public' must stay reachable by an
        // anonymous visitor regardless of whether the newer permissions
        // system has an explicit row for it yet -- mirrors the "public
        // also grants a signed-in user access, never less than anonymous"
        // reasoning in getFeaturePermission() above, extended to cover
        // anonymous visitors against the legacy DEFAULTS map too.
        if (DEFAULTS[PAGE_KEY] === 'public') {
          reveal();
        } else {
          redirectToLogin();
        }
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
