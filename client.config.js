/**
 * client.config.js — YOU-THE-WINNER ENGINE
 * ============================================================================
 * THIS IS THE FILE YOU EDIT WHEN CLONING THE ENGINE FOR A NEW CLIENT.
 *
 * Every value below is currently Mel's data (she is instance #1, the
 * reference implementation deployed at mel.you-the-winner.com).
 *
 * WIRED IN (edit here, changes take effect everywhere):
 *   - Firebase config: every page's initializeApp() call now reads
 *     CLIENT.firebase (was duplicated inline in 18 files).
 *   - Admin email checks: auth-guard.js, about.html, index.html,
 *     admin-settings.html, login.html, my-daily-tools.html, and
 *     site-nav.js now read CLIENT.adminEmails / CLIENT.primaryAdminEmail.
 *   - Google Analytics ID: every page now injects gtag using
 *     CLIENT.analyticsId (was duplicated inline in 19 files).
 *   - Canonical URLs: run `node sync-canonical-domain.js` after changing
 *     CLIENT.domain to rewrite every page's <link rel="canonical"> tag
 *     (kept as a one-time sync script, not live JS, so search crawlers
 *     always see the correct URL in the raw HTML — see that file's header
 *     comment for why).
 *
 * NOT YET WIRED (still hardcoded per-page, future work):
 *   - Language list/default and the dbRootPath value are collected here
 *     but most pages still hardcode 'mel-the-winner/...' as the literal
 *     Firebase data-path prefix rather than reading CLIENT.dbRootPath
 *     (only auth-guard.js was fully converted). Converting every data
 *     path across ~20 pages is a larger, higher-risk pass than the
 *     config/credentials work done so far.
 *   - CLIENT.features exists as a reference catalog of every page/route
 *     but isn't yet consulted anywhere to actually hide/show a page —
 *     auth-guard.js's DEFAULTS map is still the source of truth for
 *     access levels.
 *
 * To clone for a new client:
 *   1. Fork the winner-engine repo.
 *   2. Create a new Firebase project, paste its credentials into
 *      CLIENT.firebase below.
 *   3. Set CLIENT.name, CLIENT.fullName, CLIENT.domain, CLIENT.adminEmails,
 *      CLIENT.primaryAdminEmail.
 *   4. Set up a new Google Analytics property, paste the measurement ID
 *      into CLIENT.analyticsId.
 *   5. Run `node sync-canonical-domain.js` to update every canonical tag.
 *   6. Turn features on/off in CLIENT.features to match what this client
 *      actually needs (reference only for now — see note above).
 *   7. Point Netlify at the new [name].you-the-winner.com subdomain.
 *
 * Do NOT edit Mel's live values below to test a new client — copy this file
 * into the new client's fork first. Mel's instance must stay untouched.
 * ============================================================================
 */

const CLIENT = {

  // ---------------------------------------------------------------------
  // IDENTITY
  // ---------------------------------------------------------------------
  name: 'tools',
  fullName: 'Engine Tools',

  // Subdomain this instance is deployed to (used to build canonical URLs
  // via sync-canonical-domain.js). As of 2026-07-20, this deployment is
  // serving as the engine's own foundation/reference site at
  // engine.you-the-winner.com — mel.you-the-winner.com is being retired
  // for now (kept working at the edge-function level, just not the
  // canonical/primary domain) until a real separate clone exists for Mel.
  // See netlify/edge-functions/root-redirect.js for the domain routing.
  domain: 'tools.you-the-winner.com',

  // ---------------------------------------------------------------------
  // ADMIN ACCESS
  // ---------------------------------------------------------------------
  // Accounts allowed onto 'auth' (private) pages and, subject to the
  // admin-role check, 'admin' pages. Currently hardcoded as ALLOWED_EMAILS
  // in auth-guard.js (lines 14-17), and referenced again in the
  // "123mja@gmail.com always has admin access" special case at line 290.
  adminEmails: [
    '123mja@gmail.com',
  ],

  // The single email that is always treated as admin regardless of the
  // usergroups/user-roles system in Firebase (auth-guard.js line 290).
  // Kept separate from adminEmails above because today it's a distinct
  // special case in the code, not just "first item in the list."
  primaryAdminEmail: '123mja@gmail.com',

  // ---------------------------------------------------------------------
  // LANGUAGE
  // ---------------------------------------------------------------------
  languages: ['en', 'pt'],
  defaultLanguage: 'en',
  // localStorage key used by lang-sub.js and every page's own currentLang
  // logic (index.html, myday.html, etc.) to persist the chosen language.
  languageStorageKey: 'tools-lang',

  // ---------------------------------------------------------------------
  // ANALYTICS
  // ---------------------------------------------------------------------
  // Google Analytics (GA4) measurement ID. Currently pasted into every
  // page's gtag snippet and into each Firebase config's measurementId field.
  analyticsId: 'G-H194MMMZBS',

  // ---------------------------------------------------------------------
  // Google Analytics (GA4) measurement ID for the Engine/Tools product
  // funnel (index.html, daily-tools-landing.html, login.html,
  // my-daily-tools.html, etc.) — kept separate from analyticsId above,
  // which tracks Mel's personal-brand pages only. Added 2026-08-02.
  toolsAnalyticsId: 'G-8BN5R0X88P',

  // ---------------------------------------------------------------------
  // FIREBASE
  // ---------------------------------------------------------------------
  // Currently duplicated verbatim (with inconsistent formatting/quoting,
  // and inconsistent inclusion of measurementId) across: auth-guard.js,
  // about.html, admin-settings.html, calm-corner.html, emergency-binder.html,
  // habits.html, index.html, login.html, migrate-to-users.html,
  // money-planner.html, my-daily-tools.html, myday.html, piano.html,
  // quizzes.html, room-remodel.html, room-remodel-internal.html,
  // seed-habits.html, theme.js.
  

firebase: {
  apiKey: "AIzaSyCwavlafv72J1v8XoBrKHGZywpiekZ4lAU",
  authDomain: "you-the-winner-tools.firebaseapp.com",
  databaseURL: "https://you-the-winner-tools-default-rtdb.firebaseio.com",
  projectId: "you-the-winner-tools",
  storageBucket: "you-the-winner-tools.firebasestorage.app",
  messagingSenderId: "656008729189",
  appId: "1:656008729189:web:5eafd04ba4396dc4b36c8c",
  measurementId: "G-2D4D0QE15J"
  },

  // The Firebase Realtime Database root path this client's data lives
  // under. Every data path in the app is prefixed with this (e.g.
  // 'mel-the-winner/myday', 'mel-the-winner/usergroups'). Currently
  // hardcoded as the literal string 'mel-the-winner/...' throughout every
  // page's Firebase read/write calls, not derived from firebase.projectId
  // even though today they happen to match.
  dbRootPath: 'tools-you-the-winner',

  // ---------------------------------------------------------------------
  // FEATURE FLAGS (one per page/route)
  // ---------------------------------------------------------------------
  // Mirrors auth-guard.js's DEFAULTS map (which pages exist and their
  // default access level) plus every other PAGE_KEY found across the
  // site's HTML files. All are 'on' for Mel since every page below is
  // actually built and deployed for her instance. A new client would
  // turn off whatever doesn't apply to them (e.g. no piano lessons page)
  // rather than have the page 404 or need to be deleted from the repo.
  //
  // accessLevel mirrors auth-guard.js's DEFAULTS values today:
  //   'public' = anyone, 'auth' = allowlisted signed-in users only,
  //   'admin'  = admin role required.
  features: {
    // Public-facing business/marketing pages
    index:                 { enabled: true, accessLevel: 'public' },
    about:                 { enabled: true, accessLevel: 'public' },
    resume:                { enabled: true, accessLevel: 'public' },
    piano:                 { enabled: true, accessLevel: 'public' },
    teach:                 { enabled: true, accessLevel: 'auth' },
    roomRemodel:           { enabled: true, accessLevel: 'public' },
    roomRemodelInternal:   { enabled: true, accessLevel: 'admin' },
    daycare:               { enabled: true, accessLevel: 'public' },
    digitalFilm:           { enabled: true, accessLevel: 'public' },
    shop:                  { enabled: true, accessLevel: 'public' },
    contact:               { enabled: true, accessLevel: 'public' },
    winnerStory:           { enabled: true, accessLevel: 'public' },
    quizzes:               { enabled: true, accessLevel: 'public' },
    announce:              { enabled: true, accessLevel: 'public' },

    // Personal / daily-support tools (Mel-facing)
    myday:                 { enabled: true, accessLevel: 'auth' },
    plan2grow:             { enabled: true, accessLevel: 'auth' },
    moneyPlanner:          { enabled: true, accessLevel: 'auth' },
    moneyPlannerEasy:      { enabled: true, accessLevel: 'public' },
    myDailyTools:          { enabled: true, accessLevel: 'auth' },
    agendaSchedule:        { enabled: true, accessLevel: 'auth' },
    habits:                { enabled: true, accessLevel: 'auth' },
    calmCorner:            { enabled: true, accessLevel: 'public' },
    emergencyBinder:       { enabled: true, accessLevel: 'public' },
    timeMoney:             { enabled: true, accessLevel: 'public' },
    timeaway:              { enabled: true, accessLevel: 'public' },

    // Support tools (population-agnostic — works for IDD users and seniors)
    quickAlert:            { enabled: true, accessLevel: 'public' },

    // Coaching / internal / admin
    coachAlignment:        { enabled: true, accessLevel: 'admin' },
    melCoachBriefing:      { enabled: true, accessLevel: 'public' }, // no PAGE_KEY / auth-guard found on this page as of this audit
    adminPanel:            { enabled: true, accessLevel: 'admin' },
    adminSettings:         { enabled: true, accessLevel: 'admin' },
    login:                 { enabled: true, accessLevel: 'public' },
  },
};

// Node/CommonJS + browser-global compatibility, so this file can eventually
// be <script type="module">-included by every HTML page (Step 3+) as well
// as imported by build tooling if needed.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CLIENT;
}
if (typeof window !== 'undefined') {
  window.CLIENT = CLIENT;
}

// ES module export — lets auth-guard.js (and any other type="module" script)
// do `import { CLIENT } from './client.config.js'`.
export { CLIENT };
