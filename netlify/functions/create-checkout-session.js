/**
 * Creates a Stripe Checkout Session for a plan-tier purchase -- Netlify
 * serverless Function.
 *
 * ── REBUILT 2026-09-05 around the marketing site's plan model ──
 * Marcelo decided the new marketing site (You-The-Winner marketing/
 * pricing.html) is the pricing model that prevails going forward, not the
 * old Base + independent add-on packs model this function used to build
 * (see ./_packs.js's header comment). That marketing site sells flat plan
 * tiers -- Personal, Family, Professional Pro -- each a single Stripe
 * Price per interval, plus a free Professional Supporter role (no Stripe
 * purchase at all -- it rides on this app's existing family/caregiver
 * sharing/invite mechanism) and a custom, sales-assisted Organization tier
 * with no self-serve checkout button. So this function now builds a single
 * `line_items` entry for whichever of the three self-serve plans was
 * requested, instead of a variable-length Base+packs array.
 *
 * The marketing site's Payment Links (buy.stripe.com/test_...) could not
 * attribute a purchase back to a signed-in Firebase account -- Payment
 * Links have no built-in way to carry a signed-in user's id unless the
 * caller appends client_reference_id, which the static links didn't do.
 * This function is the fix: pricing.html's buttons now hand off to
 * subscribe.html (this app's own domain, where the user is signed in),
 * which calls this function with the chosen plan + interval and gets back
 * a real Stripe-hosted Checkout url that already has client_reference_id
 * and subscription_data.metadata.firebaseUid set (see below) -- so
 * stripe-webhook.js can always attribute the resulting subscription back
 * to the right account, the same way it already did for the old model.
 *
 * ── TEST / LIVE MODE (added 2026-08-21, unchanged) ──
 * Every checkout this function creates uses whichever mode is currently
 * selected at Firebase tools-you-the-winner/config/stripe-mode ('test' |
 * 'live', defaults to 'test'), toggled from admin-settings.html's "Stripe
 * billing mode" section with no redeploy needed -- see ./_packs.js's
 * header comment for the full env var layout (STRIPE_SECRET_KEY_TEST/
 * _LIVE, STRIPE_PRICE_*_TEST/_LIVE).
 *
 * POST body: { uid, email, interval: 'month'|'year', plan: 'personal'|'family'|'pro' }
 *   uid/email come from the signed-in Firebase user -- this project's auth
 *   is Google-only (see login.html), so by the time someone reaches this
 *   function they already have a Firebase uid to attach the purchase to.
 *   'org' (Organization) is deliberately rejected -- that tier is
 *   custom/sales-assisted only, matching the marketing site having no
 *   self-serve button for it.
 *
 * Response: { url, mode } -- redirect the browser to `url` (Stripe-hosted
 *   Checkout); `mode` ('test'|'live') is included so a caller can show
 *   "you're testing" UI if useful, not required for the redirect to work.
 *
 * NOT LIVE YET for either mode until its STRIPE_SECRET_KEY_* and
 * STRIPE_PRICE_{PERSONAL,FAMILY,PRO}_*_* env vars are set for that mode.
 * This function returns a 500 explaining exactly what's missing for
 * whichever mode is currently selected, rather than a generic Stripe SDK
 * error.
 */

const admin = require('firebase-admin');
const { getFirebaseAdmin, getStripeMode, getStripeSecretKey, SELF_SERVE_PLANS, priceIdFor } = require('./_packs');

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
  const plan = String(body.plan || '').toLowerCase();
  const billingInterval = body.interval === 'year' ? 'year' : 'month';

  if (!uid || !email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'uid and email are required' }) };
  }
  if (SELF_SERVE_PLANS.indexOf(plan) === -1) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: 'plan must be one of: ' + SELF_SERVE_PLANS.join(', ') + '. ' +
               'Organization has no self-serve checkout -- it is a custom, ' +
               'sales-assisted plan (see pricing.html).'
      }),
    };
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

  const priceId = priceIdFor(plan, billingInterval, mode);
  if (!priceId) {
    const envKey = 'STRIPE_PRICE_' + plan.toUpperCase() + '_' +
      (billingInterval === 'year' ? 'ANNUAL' : 'MONTHLY') + '_' + mode.toUpperCase();
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Price ID is not configured for ' + mode + ' mode (' + envKey + '). ' +
               'Either the Stripe Price for ' + mode + ' mode hasn\'t been created yet, ' +
               'the Netlify env var hasn\'t been set, or admin-settings.html\'s Stripe ' +
               'billing mode toggle needs to be switched to the mode that IS configured.'
      }),
    };
  }
  const lineItems = [{ price: priceId, quantity: 1 }];

  try {
    const stripe = require('stripe')(getStripeSecretKey(mode));

    // Reuse an existing Stripe customer if this uid already has one on
    // file (e.g. re-subscribing after a cancellation, or switching plan
    // tiers), so their billing history stays on one Stripe Customer
    // instead of fragmenting across several. Only reused within the SAME
    // mode -- a Test-mode customer id is meaningless to a Live-mode
    // Stripe account and vice versa, so this is scoped per mode to avoid
    // a cross-mode "no such customer" error.
    getFirebaseAdmin();
    const existingSnap = await admin.database().ref('users/' + uid + '/subscription/stripeCustomerId_' + mode).once('value');
    const existingCustomerId = existingSnap.exists() ? existingSnap.val() : null;

    const siteUrl = process.env.SITE_URL || 'https://tools.you-the-winner.com';
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
      subscription_data: { metadata: { firebaseUid: uid, plan: plan } },
      success_url: siteUrl + '/my-daily-tools.html?checkout=success',
      cancel_url: siteUrl + '/subscribe.html?checkout=canceled&plan=' + plan + '&interval=' + billingInterval,
    });

    return { statusCode: 200, body: JSON.stringify({ url: session.url, mode: mode }) };
  } catch (err) {
    console.error('create-checkout-session error (' + mode + ' mode):', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
