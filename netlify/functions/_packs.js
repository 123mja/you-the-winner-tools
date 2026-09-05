/**
 * Shared helpers for the Stripe <-> Firebase entitlement functions in this
 * folder (stripe-webhook.js, create-checkout-session.js).
 *
 * ── PLAN MODEL (rebuilt 2026-09-05) ──
 * This used to be a "Base plan + independent add-on packs on one multi-item
 * Subscription" model (PRICE_ID_TO_PACKS, one Stripe Price per pack). That
 * model is retired. The authoritative pricing now lives in the marketing
 * site (You-The-Winner marketing/pricing.html), which sells flat PLAN
 * TIERS instead: Personal, Family, Professional Pro (Organization is a
 * custom/sales-assisted plan with no self-serve checkout, so it has no
 * Price ID here at all). Each plan is ONE Stripe Price per interval -- a
 * single-item Subscription, not a line-item bundle. Nothing in this app
 * currently gates features on the old pack booleans (grepped -- zero
 * matches outside these Stripe files and the now-retired subscribe.html
 * UI), so this is a clean cutover with no other file to update.
 *
 * ── TEST / LIVE MODE (added 2026-08-21, unchanged) ──
 * Marcelo asked for a way to hold BOTH a Test-mode and a Live-mode set of
 * Stripe credentials at once and flip between them from the site itself,
 * rather than this project only ever having one active Stripe account at a
 * time. Every Stripe-related env var this file (and stripe-webhook.js /
 * create-checkout-session.js) reads is now suffixed _TEST or _LIVE:
 *   STRIPE_SECRET_KEY_TEST / STRIPE_SECRET_KEY_LIVE
 *   STRIPE_WEBHOOK_SECRET_TEST / STRIPE_WEBHOOK_SECRET_LIVE
 *   STRIPE_PRICE_{PERSONAL,FAMILY,PRO}_{MONTHLY,ANNUAL}_{TEST,LIVE}
 *     (6 Price IDs per mode, 12 total once both modes are fully configured)
 * "Which mode is active for new purchases" is NOT a Netlify env var -- it's
 * a single string at Firebase tools-you-the-winner/config/stripe-mode ('test' |
 * 'live'), read fresh on every create-checkout-session.js call via
 * getStripeMode() below, and toggled from admin-settings.html's "Stripe
 * billing mode" section (Site tab) with zero redeploy needed. Defaults to
 * 'test' if unset, so a config path that never got written can't
 * accidentally start charging real cards.
 * stripe-webhook.js does NOT use getStripeMode() -- an incoming webhook
 * event could be from either mode's checkout regardless of what the toggle
 * currently says, so it tries verifying against both webhook secrets
 * instead (see that file).
 */

const admin = require('firebase-admin');

let _app = null;

/**
 * Lazily initializes the Firebase Admin app once per warm function
 * container (not once per invocation) and returns it. Throws with a clear
 * message rather than a cryptic Admin SDK error if the service account
 * key hasn't been configured yet.
 */
function getFirebaseAdmin() {
  if (_app) return _app;
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_KEY env var is not set. Generate a service ' +
      'account key for the you-the-winner-tools Firebase project (Project Settings ' +
      '-> Service Accounts -> Generate new private key) and paste the whole ' +
      'JSON file as this Netlify env var\'s value.'
    );
  }
  _app = admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
    databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://you-the-winner-tools-default-rtdb.firebaseio.com',
  });
  return _app;
}

// Reads tools-you-the-winner/config/stripe-mode -- 'live' only if explicitly set
// to that string, 'test' for every other value (unset, 'test', anything
// unexpected). Used by create-checkout-session.js to decide which
// STRIPE_SECRET_KEY_* / STRIPE_PRICE_*_* env vars to build a NEW checkout
// with. See the file header above for why stripe-webhook.js doesn't use
// this.
async function getStripeMode() {
  getFirebaseAdmin();
  const snap = await admin.database().ref('tools-you-the-winner/config/stripe-mode').once('value');
  return snap.val() === 'live' ? 'live' : 'test';
}

// process.env.STRIPE_SECRET_KEY_TEST or _LIVE, with a clear error (not a
// cryptic Stripe SDK error) if the mode currently selected doesn't have its
// key configured yet.
function getStripeSecretKey(mode) {
  const envKey = 'STRIPE_SECRET_KEY_' + mode.toUpperCase();
  const key = process.env[envKey];
  if (!key) {
    throw new Error(
      envKey + ' is not set. Set it as a Netlify env var (Stripe Dashboard, ' +
      'toggled to ' + mode + ' mode, -> Developers -> API keys -> Secret key), ' +
      'or switch Stripe billing mode away from "' + mode + '" in admin-settings.html.'
    );
  }
  return key;
}

// Both webhook signing secrets at once, so stripe-webhook.js can try
// verifying an incoming event against whichever one actually matches --
// see that file's header comment for why it can't just pick one based on
// the current admin-settings.html toggle.
function getWebhookSecrets() {
  return {
    test: process.env.STRIPE_WEBHOOK_SECRET_TEST || null,
    live: process.env.STRIPE_WEBHOOK_SECRET_LIVE || null,
  };
}

// The three self-serve plan tiers. Organization is deliberately excluded --
// the marketing site has no self-serve checkout button for it (custom /
// sales-assisted only), so create-checkout-session.js should reject it.
const SELF_SERVE_PLANS = ['personal', 'family', 'pro'];

// STRIPE_PRICE_<PLAN>_<MONTHLY|ANNUAL>_<TEST|LIVE> -> that Price ID, for
// create-checkout-session.js to build the single line_item for a specific
// plan + interval + mode.
function priceIdFor(plan, interval, mode) {
  const envKey = 'STRIPE_PRICE_' + plan.toUpperCase() + '_' +
    (interval === 'year' ? 'ANNUAL' : 'MONTHLY') + '_' + mode.toUpperCase();
  return process.env[envKey];
}

// One Stripe Price ID -> which plan tier it represents. Built from BOTH
// _TEST and _LIVE env vars at once, merged into one flat map -- Stripe
// Price IDs are globally unique strings regardless of which mode created
// them, so there's no collision risk, and a subscription's line item
// always carries a Price ID from whichever single mode created that
// subscription. This means planFromSubscription() below correctly
// resolves the plan for a webhook event from EITHER mode without needing
// to know which mode is "currently active" at all.
const PRICE_ID_TO_PLAN = {};
['TEST', 'LIVE'].forEach(function(mode) {
  SELF_SERVE_PLANS.forEach(function(plan) {
    ['MONTHLY', 'ANNUAL'].forEach(function(interval) {
      const envKey = 'STRIPE_PRICE_' + plan.toUpperCase() + '_' + interval + '_' + mode;
      const priceId = process.env[envKey];
      if (priceId) PRICE_ID_TO_PLAN[priceId] = plan;
    });
  });
});

// A plan tier is a single Price on a single-item Subscription (unlike the
// old Base+packs model, there's no union of line items to compute) -- just
// read the first line item's Price ID and look it up. Returns null if the
// subscription's Price isn't one of the three self-serve plans (e.g. a
// Subscription created by hand in the Dashboard, or a stale/removed Price).
function planFromSubscription(subscription) {
  const items = (subscription.items && subscription.items.data) || [];
  const priceId = items[0] && items[0].price && items[0].price.id;
  return PRICE_ID_TO_PLAN[priceId] || null;
}

// Stripe subscription.status -> this project's simpler status field
// ('active' | 'past_due' | 'canceled' | 'comp'). 'comp' is never returned
// by this function -- it's only ever set by hand directly in Firebase, for
// Marcelo's own account and any other goodwill/reference accounts.
// stripe-webhook.js's writeEntitlement() checks for an existing 'comp'
// status before writing and skips the write entirely if found, so a comp
// account can never get silently downgraded by an unrelated Stripe event.
function mapStatus(stripeStatus) {
  if (stripeStatus === 'active' || stripeStatus === 'trialing') return 'active';
  if (stripeStatus === 'past_due' || stripeStatus === 'unpaid') return 'past_due';
  return 'canceled'; // canceled, incomplete, incomplete_expired, paused
}

module.exports = {
  getFirebaseAdmin,
  getStripeMode,
  getStripeSecretKey,
  getWebhookSecrets,
  SELF_SERVE_PLANS,
  priceIdFor,
  PRICE_ID_TO_PLAN,
  planFromSubscription,
  mapStatus,
};
