/**
 * Creates a Stripe Checkout Session for a Base + optional add-on pack
 * purchase -- Netlify serverless Function, meant to be called from
 * subscribe.html once that page is wired to a real payment flow
 * (SUBSCRIPTION-ARCHITECTURE.md step 4; not done yet -- subscribe.html
 * today is still the design-only preview described in its own header
 * comment, with a fake `setTimeout` "Redirecting..." step instead of a
 * real handoff to Stripe).
 *
 * Adapted from GoTuned's checkout handling in
 * internal/business/stripe-integration.js, generalized the same way
 * stripe-webhook.js is: GoTuned's currently-live flow is a single
 * flexible-amount Payment Link (no per-tier Price, no line items) --
 * handleCheckoutSessionCompleted() in that file even grants a hardcoded
 * PAYMENT_LINK_DEFAULT_TIER because there's no Price to read a tier from.
 * A real per-Price Subscription flow exists in that same file too
 * (customer.subscription.created/updated), but isn't what GoTuned's own
 * checkout actually creates yet. This product needs real multi-item
 * Subscriptions from day one -- Base plus independently-toggled packs on
 * ONE subscription, per SUBSCRIPTION-ARCHITECTURE.md point 1 -- so this
 * builds a proper `line_items` array up front instead of a single flexible
 * Payment Link.
 *
 * ── TEST / LIVE MODE (added 2026-08-21) ──
 * Every checkout this function creates uses whichever mode is currently
 * selected at Firebase mel-the-winner/config/stripe-mode ('test' | 'live',
 * defaults to 'test'), toggled from admin-settings.html's "Stripe billing
 * mode" section with no redeploy needed -- see ./_packs.js's header
 * comment for the full env var layout (STRIPE_SECRET_KEY_TEST/_LIVE,
 * STRIPE_PRICE_*_TEST/_LIVE). This lets Marcelo hold both a Test and a
 * Live Stripe account's credentials at once and flip which one new
 * purchases go through without touching code or env vars per switch.
 *
 * POST body: { uid, email, interval: 'month'|'year', packs: { wellness, goals, calendar } }
 *   uid/email come from the signed-in Firebase user -- this project's auth
 *   is Google-only (see login.html), so by the time someone reaches this
 *   function they already have a Firebase uid to attach the purchase to.
 *   Base is always included; `packs` selects which add-ons ride along as
 *   additional line items on the same subscription.
 *
 * Response: { url, mode } -- redirect the browser to `url` (Stripe-hosted
 *   Checkout); `mode` ('test'|'live') is included so a caller can show
 *   "you're testing" UI if useful, not required for the redirect to work.
 *
 * NOT LIVE YET for either mode until its STRIPE_SECRET_KEY_* and
 * STRIPE_PRICE_BASE_*_* env vars are set -- see stripe-webhook.js's header
 * comment for the full list and SUBSCRIPTION-ARCHITECTURE.md for
 * sequencing. This function returns a 500 explaining exactly what's
 * missing for whichever mode is currently selected, rather than a generic
 * Stripe SDK error.
 */

const admin = require('firebase-admin');
const { getFirebaseAdmin, getStripeMode, getStripeSecretKey, priceIdFor } = require('./_packs');

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const uid = body.uid;
  const email = body.email;
  const packs = body.packs || {};
  const billingInterval = body.interval === 'year' ? 'year' : 'month';

  if (!uid || !email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'uid and email are required' }) };
  }

  let mode;
  try {
    mode = await getStripeMode();
  } catch (err) {
    // getStripeMode() needs Firebase Admin to read the toggle -- if that
    // itself isn't configured yet, fail with that clearer error instead of
    // a generic one below.
    console.error('create-checkout-session: could not read Stripe mode:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }

  // Auto-upgrade to the Complete bundle Price when all three add-on packs
  // are requested, instead of Base + 3 separate line items. Added
  // 2026-08-21 after noticing the real Stripe prices make these VERY
  // different purchases, not just an equivalent split of the same total --
  // e.g. monthly, Base+Wellness+Goals+Calendar as 4 separate line items
  // sums to $40.43, while the Complete bundle Price is $12.99 for the
  // identical entitlement (packsFromSubscription() in ./_packs.js already
  // grants all four packs from either shape, so this is purely a "don't
  // silently overcharge someone by ~3x for buying everything" fix, not an
  // entitlement change).
  const wantsComplete = !!(packs.wellness && packs.goals && packs.calendar);
  const completePriceId = wantsComplete ? priceIdFor('complete', billingInterval, mode) : null;

  let lineItems;
  if (completePriceId) {
    lineItems = [{ price: completePriceId, quantity: 1 }];
  } else {
    const basePriceId = priceIdFor('base', billingInterval, mode);
    if (!basePriceId) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'Base plan Price ID is not configured for ' + mode + ' mode ' +
                 '(STRIPE_PRICE_BASE_' + (billingInterval === 'year' ? 'ANNUAL' : 'MONTHLY') + '_' + mode.toUpperCase() + '). ' +
                 'Either the Stripe Products/Prices for ' + mode + ' mode haven\'t been created yet, ' +
                 'the Netlify env var hasn\'t been set, or admin-settings.html\'s Stripe billing mode ' +
                 'toggle needs to be switched to the mode that IS configured.'
        }),
      };
    }
    lineItems = [{ price: basePriceId, quantity: 1 }];
    ['wellness', 'goals', 'calendar'].forEach(function(pack) {
      if (!packs[pack]) return;
      const priceId = priceIdFor(pack, billingInterval, mode);
      if (priceId) {
        lineItems.push({ price: priceId, quantity: 1 });
      } else {
        console.warn('Requested pack "' + pack + '" has no configured ' + mode + '-mode Price ID for interval', billingInterval, '-- omitted from checkout.');
      }
    });
  }

  try {
    const stripe = require('stripe')(getStripeSecretKey(mode));

    // Reuse an existing Stripe customer if this uid already has one on
    // file (e.g. re-subscribing after a cancellation), so their billing
    // history stays on one Stripe Customer instead of fragmenting across
    // several -- GoTuned doesn't need this step since its experimental
    // Payment Link flow derives a fresh customerId per purchase rather
    // than tracking one Firebase-style account across purchases. Only
    // reused within the SAME mode -- a Test-mode customer id is
    // meaningless to a Live-mode Stripe account and vice versa, so this
    // is scoped per mode to avoid a cross-mode "no such customer" error.
    getFirebaseAdmin();
    const existingSnap = await admin.database().ref('users/' + uid + '/subscription/stripeCustomerId_' + mode).once('value');
    const existingCustomerId = existingSnap.exists() ? existingSnap.val() : null;

    const siteUrl = process.env.SITE_URL || 'https://engine.you-the-winner.com';
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: lineItems,
      client_reference_id: uid,
      customer: existingCustomerId || undefined,
      customer_email: existingCustomerId ? undefined : email,
      // Carried onto the Subscription Stripe creates from this session, so
      // stripe-webhook.js's writeEntitlement() can attribute every later
      // event for it back to this Firebase uid with no separate lookup
      // table -- see that file's header comment.
      subscription_data: { metadata: { firebaseUid: uid } },
      success_url: siteUrl + '/my-daily-tools.html?checkout=success',
      cancel_url: siteUrl + '/subscribe.html?checkout=canceled',
    });

    return { statusCode: 200, body: JSON.stringify({ url: session.url, mode: mode }) };
  } catch (err) {
    console.error('create-checkout-session error (' + mode + ' mode):', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
