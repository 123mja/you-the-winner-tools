/**
 * Shared helpers for the Stripe <-> Firebase entitlement functions in this
 * folder (stripe-webhook.js, create-checkout-session.js).
 *
 * The PRICE_ID_TO_PACKS map below is adapted from the PRICE_ID_TO_TIER
 * pattern in GoTuned's internal/business/stripe-integration.js -- but
 * generalized from "one Stripe Price = one tier" to "one Stripe Price =
 * a set of packs", since this product sells a Base plan plus independent
 * add-on packs as multiple line items on ONE Stripe Subscription (see
 * SUBSCRIPTION-ARCHITECTURE.md point 1), not one tier per subscription
 * the way GoTuned's licensing model works. See PRICING-STRATEGY.md for
 * the actual packaging this maps to (Base / Wellness / Goals & Motivation
 * / Calendar / Complete).
 *
 * ── TEST / LIVE MODE (added 2026-08-21) ──
 * Marcelo asked for a way to hold BOTH a Test-mode and a Live-mode set of
 * Stripe credentials at once and flip between them from the site itself,
 * rather than this project only ever having one active Stripe account at a
 * time. Every Stripe-related env var this file (and stripe-webhook.js /
 * create-checkout-session.js) reads is now suffixed _TEST or _LIVE:
 *   STRIPE_SECRET_KEY_TEST / STRIPE_SECRET_KEY_LIVE
 *   STRIPE_WEBHOOK_SECRET_TEST / STRIPE_WEBHOOK_SECRET_LIVE
 *   STRIPE_PRICE_{BASE,WELLNESS,GOALS,CALENDAR,COMPLETE}_{MONTHLY,ANNUAL}_{TEST,LIVE}
 *     (10 Price IDs per mode, 20 total once both modes are fully configured)
 * "Which mode is active for new purchases" is NOT a Netlify env var -- it's
 * a single string at Firebase mel-the-winner/config/stripe-mode ('test' |
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
 * key hasn't been configured yet -- mirrors GoTuned's renewal-portal.js
 * pattern of lazily requiring stripe-integration.js so a missing env var
 * fails loudly and locally rather than crashing something unrelated.
 */
function getFirebaseAdmin() {
  if (_app) return _app;
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_KEY env var is not set. Generate a service ' +
      'account key for the mel-the-winner Firebase project (Project Settings ' +
      '-> Service Accounts -> Generate new private key) and paste the whole ' +
      'JSON file as this Netlify env var\'s value.'
    );
  }
  _app = admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
    databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://mel-the-winner-default-rtdb.firebaseio.com',
  });
  return _app;
}

// Reads mel-the-winner/config/stripe-mode -- 'live' only if explicitly set
// to that string, 'test' for every other value (unset, 'test', anything
// unexpected). Used by create-checkout-session.js to decide which
// STRIPE_SECRET_KEY_* / STRIPE_PRICE_*_* env vars to build a NEW checkout
// with. See the file header above for why stripe-webhook.js doesn't use
// this.
async function getStripeMode() {
  getFirebaseAdmin();
  const snap = await admin.database().ref('mel-the-winner/config/stripe-mode').once('value');
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

// STRIPE_PRICE_<PACK>_<MONTHLY|ANNUAL>_<TEST|LIVE> -> that Price ID, for
// create-checkout-session.js to build line_items for a specific pack +
// interval + mode.
function priceIdFor(pack, interval, mode) {
  const envKey = 'STRIPE_PRICE_' + pack.toUpperCase() + '_' +
    (interval === 'year' ? 'ANNUAL' : 'MONTHLY') + '_' + mode.toUpperCase();
  return process.env[envKey];
}

// One Stripe Price ID -> which pack(s) it grants when present on a
// subscription. A subscription's actual entitlement is the UNION of every
// line item's packs (see packsFromSubscription() below) -- so "Complete"
// can be modeled either as its own bundle Price granting all four packs
// in a single line item, or left unconfigured entirely and simply bought
// as four separate line items (Base + Wellness + Goals + Calendar); both
// produce an identical Firebase entitlement record.
//
// Built from BOTH _TEST and _LIVE env vars at once, merged into one flat
// map -- Stripe Price IDs are globally unique strings regardless of which
// mode created them, so there's no collision risk, and a subscription's
// line items always carry Price IDs from whichever single mode created
// that subscription. This means packsFromSubscription() below correctly
// resolves entitlement for a webhook event from EITHER mode without
// needing to know which mode is "currently active" at all.
const PACK_GRANTS = {
  BASE:      { base: true },
  WELLNESS:  { wellness: true },
  GOALS:     { goals: true },
  CALENDAR:  { calendar: true },
  COMPLETE:  { base: true, wellness: true, goals: true, calendar: true },
};
const PRICE_ID_TO_PACKS = {};
['TEST', 'LIVE'].forEach(function(mode) {
  Object.keys(PACK_GRANTS).forEach(function(pack) {
    ['MONTHLY', 'ANNUAL'].forEach(function(interval) {
      const envKey = 'STRIPE_PRICE_' + pack + '_' + interval + '_' + mode;
      const priceId = process.env[envKey];
      if (priceId) PRICE_ID_TO_PACKS[priceId] = PACK_GRANTS[pack];
    });
  });
});

function packsFromSubscription(subscription) {
  const packs = { base: false, wellness: false, goals: false, calendar: false };
  const items = (subscription.items && subscription.items.data) || [];
  items.forEach(function(item) {
    const priceId = item.price && item.price.id;
    const grant = PRICE_ID_TO_PACKS[priceId];
    if (!grant) return;
    Object.keys(grant).forEach(function(key) {
      if (grant[key]) packs[key] = true;
    });
  });
  return packs;
}

// Stripe subscription.status -> this project's simpler status field
// ('active' | 'past_due' | 'canceled' | 'comp'). 'comp' is never returned
// by this function -- it's only ever set by hand directly in Firebase, for
// Mel's own account and any other goodwill/reference accounts, per
// SUBSCRIPTION-ARCHITECTURE.md. stripe-webhook.js's writeEntitlement()
// checks for an existing 'comp' status before writing and skips the write
// entirely if found, so a comp account can never get silently downgraded
// by an unrelated Stripe event (e.g. someone else's webhook retry, or a
// stray subscription accidentally created against that email).
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
  priceIdFor,
  PRICE_ID_TO_PACKS,
  packsFromSubscription,
  mapStatus,
};
