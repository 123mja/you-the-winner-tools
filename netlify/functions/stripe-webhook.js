/**
 * Stripe webhook handler -- Netlify serverless Function.
 *
 * Verifies the Stripe signature, then branches on event.type. This
 * project has no server of its own -- it's a static Netlify site -- so
 * this runs as a Netlify Function, and "entitlement" is a Firebase
 * Realtime Database write, not a signed license file.
 *
 * ── PLAN MODEL (rebuilt 2026-09-05) ──
 * This used to grant a union of independent add-on "packs" from a
 * multi-item Subscription (packsFromSubscription() in ./_packs.js). The
 * marketing site's pricing now sells flat plan tiers instead -- Personal,
 * Family, Professional Pro, each a single-item Subscription -- so
 * entitlement here is just "which one Price is on this subscription"
 * (planFromSubscription(), in ./_packs.js), written as a `plan` string
 * field instead of a `packs` object.
 *
 * ── TEST / LIVE MODE (added 2026-08-21, unchanged) ──
 * This project can hold a Test-mode AND a Live-mode Stripe account's
 * credentials at the same time (see ./_packs.js's header comment) --
 * admin-settings.html's "Stripe billing mode" toggle picks which one
 * create-checkout-session.js uses to create NEW checkouts. This file
 * (the webhook receiver) does NOT read that toggle: a real Stripe account
 * only ever sends a webhook two ways -- register ONE endpoint URL in each
 * of the Stripe Dashboard's Test mode and Live mode (both can point at
 * this exact same deployed function URL), each with its own signing
 * secret. An incoming request could be either one, unpredictably, so this
 * file tries verifying against BOTH STRIPE_WEBHOOK_SECRET_TEST and
 * STRIPE_WEBHOOK_SECRET_LIVE and accepts whichever one actually matches
 * (see verifyStripeEvent() below). Whichever mode's checkout created the
 * subscription is implicit in which Price ID shows up on it -- since
 * PRICE_ID_TO_PLAN in ./_packs.js merges both modes' Price IDs into one
 * map, planFromSubscription() resolves correctly either way with no
 * extra bookkeeping needed.
 *
 * NOT FULLY LIVE YET. Requires, all as Netlify environment variables:
 *   STRIPE_SECRET_KEY_TEST and/or STRIPE_SECRET_KEY_LIVE
 *   STRIPE_WEBHOOK_SECRET_TEST and/or STRIPE_WEBHOOK_SECRET_LIVE
 *   FIREBASE_SERVICE_ACCOUNT_KEY, FIREBASE_DATABASE_URL (see ./_packs.js)
 *   The STRIPE_PRICE_{PERSONAL,FAMILY,PRO}_{MONTHLY,ANNUAL}_{TEST,LIVE}
 *     variables listed in ./_packs.js, once real Prices exist in the
 *     Stripe Dashboard for that mode.
 *
 * Also requires, per mode you want live: registering this function's URL
 * (https://<your-netlify-domain>/.netlify/functions/stripe-webhook) as a
 * webhook endpoint in that mode of the Stripe Dashboard (Test mode and
 * Live mode each have their OWN webhook endpoint list -- registering in
 * one does nothing for the other), subscribed to at least:
 *   checkout.session.completed, customer.subscription.created,
 *   customer.subscription.updated, customer.subscription.deleted,
 *   invoice.payment_failed
 * then copying that endpoint's signing secret into STRIPE_WEBHOOK_SECRET_TEST
 * or STRIPE_WEBHOOK_SECRET_LIVE to match.
 */

const admin = require('firebase-admin');
const { getFirebaseAdmin, getWebhookSecrets, planFromSubscription, mapStatus } = require('./_packs');

/**
 * A Stripe client instance is only needed here for its .webhooks helper,
 * which performs pure HMAC signature verification -- it makes no API
 * calls, so which API key the client was constructed with doesn't matter.
 * Falls back through whichever secret key is configured (Live preferred
 * only because that's more likely to be the "real" one once both exist)
 * purely so this file can run before both modes are fully set up.
 */
function getStripeClient() {
  const anyKey = process.env.STRIPE_SECRET_KEY_LIVE || process.env.STRIPE_SECRET_KEY_TEST;
  if (!anyKey) {
    throw new Error('Neither STRIPE_SECRET_KEY_LIVE nor STRIPE_SECRET_KEY_TEST is set -- see this file\'s header comment.');
  }
  return require('stripe')(anyKey);
}

/**
 * Tries constructEvent() against every configured webhook secret (Live
 * first, then Test) and returns the first one that verifies -- see the
 * file header comment for why this can't just pick one secret up front.
 */
function verifyStripeEvent(stripe, rawBody, sig) {
  const secrets = getWebhookSecrets();
  const candidates = [secrets.live, secrets.test].filter(Boolean);
  if (!candidates.length) {
    throw new Error('Neither STRIPE_WEBHOOK_SECRET_LIVE nor STRIPE_WEBHOOK_SECRET_TEST is set.');
  }
  let lastErr;
  for (let i = 0; i < candidates.length; i++) {
    try {
      return stripe.webhooks.constructEvent(rawBody, sig, candidates[i]);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/**
 * Writes (or updates) users/{uid}/subscription from a Stripe Subscription
 * object. uid comes from subscription.metadata.firebaseUid, which
 * create-checkout-session.js sets via subscription_data.metadata at
 * checkout time -- Stripe carries that metadata onto the Subscription it
 * creates, so every later event for this subscription already has it, with
 * no separate Stripe-customer-id -> Firebase-uid lookup table needed.
 */
async function writeEntitlement(subscription) {
  const uid = subscription.metadata && subscription.metadata.firebaseUid;
  if (!uid) {
    console.warn(
      'Subscription', subscription.id,
      'has no metadata.firebaseUid -- cannot attribute it to a Firebase ' +
      'account, skipping. This should never happen for a subscription ' +
      'created via create-checkout-session.js; only expected if someone ' +
      'creates a Subscription directly in the Stripe Dashboard.'
    );
    return;
  }

  getFirebaseAdmin();
  const db = admin.database();
  const subRef = db.ref('users/' + uid + '/subscription');

  // Never let a billing webhook downgrade a hand-set 'comp' (permanent
  // free) account -- see the status-field comment in ./_packs.js.
  const currentStatusSnap = await subRef.child('status').once('value');
  if (currentStatusSnap.val() === 'comp') {
    console.log('uid', uid, 'is a comp account -- skipping webhook-driven entitlement write.');
    return;
  }

  // subscription.livemode tells us which Stripe account (Test or Live)
  // this event came from. The primary stripeCustomerId/stripeSubscriptionId
  // fields stay unscoped (whichever mode most recently wrote them is "the"
  // current entitlement, which is what any future entitlement-check code
  // should read) -- the extra stripeCustomerId_test/_live fields exist
  // purely so create-checkout-session.js's "reuse an existing customer"
  // lookup never tries to reuse a Test-mode customer id against the Live
  // Stripe account (or vice versa), which Stripe would reject outright.
  const modeKey = subscription.livemode ? 'live' : 'test';
  const update = {
    status: mapStatus(subscription.status),
    stripeCustomerId: subscription.customer,
    stripeSubscriptionId: subscription.id,
    plan: planFromSubscription(subscription),
    currentPeriodEnd: subscription.current_period_end ? subscription.current_period_end * 1000 : null,
    updatedAt: admin.database.ServerValue.TIMESTAMP,
  };
  update['stripeCustomerId_' + modeKey] = subscription.customer;
  await subRef.update(update);
  console.log('Wrote entitlement for uid', uid, '- status:', mapStatus(subscription.status), '- plan:', update.plan, '- mode:', modeKey);
}

async function handleEvent(event) {
  console.log('Stripe event:', event.type, '(livemode:', event.livemode + ')');
  switch (event.type) {
    case 'checkout.session.completed': {
      // customer.subscription.created (below) does the actual entitlement
      // write, using the same subscription_data.metadata this session set
      // at creation time -- this case is just a log line / a place to hook
      // a welcome email later if wanted.
      const session = event.data.object;
      console.log('Checkout completed for uid', session.client_reference_id, '- session', session.id);
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      await writeEntitlement(event.data.object);
      break;
    }
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const uid = subscription.metadata && subscription.metadata.firebaseUid;
      if (!uid) {
        console.warn('subscription.deleted with no metadata.firebaseUid, skipping');
        break;
      }
      getFirebaseAdmin();
      const subRef = admin.database().ref('users/' + uid + '/subscription');
      const currentStatusSnap = await subRef.child('status').once('value');
      if (currentStatusSnap.val() === 'comp') {
        console.log('uid', uid, 'is a comp account -- skipping cancellation write.');
        break;
      }
      await subRef.update({
        status: 'canceled',
        updatedAt: admin.database.ServerValue.TIMESTAMP,
      });
      console.log('Marked uid', uid, 'canceled');
      break;
    }
    case 'invoice.payment_failed': {
      // Stripe also fires customer.subscription.updated with status
      // 'past_due' around the same time, which writeEntitlement() above
      // already handles -- this case just adds a clearer log line for this
      // specific event, matching Stripe's own recommended webhook event
      // list rather than relying on subscription.updated alone.
      const invoice = event.data.object;
      console.log('Payment failed for Stripe customer', invoice.customer);
      break;
    }
    default:
      console.log('Unhandled event type:', event.type);
  }
}

exports.handler = async function(event) {
  const stripe = getStripeClient();
  const sig = event.headers && (event.headers['stripe-signature'] || event.headers['Stripe-Signature']);
  const rawBody = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body;

  let stripeEvent;
  try {
    stripeEvent = verifyStripeEvent(stripe, rawBody, sig);
  } catch (err) {
    console.error('Webhook signature verification failed against both configured secrets:', err.message);
    return { statusCode: 400, body: 'Webhook Error: ' + err.message };
  }

  try {
    await handleEvent(stripeEvent);
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    console.error('Error handling webhook event:', err);
    // Still 200 -- Stripe retries on non-2xx, and re-processing an
    // already-handled event is safe here (every Firebase write above is an
    // idempotent .update(), not a .push()), but a bug in this code should
    // get fixed, not retried into the ground by Stripe hammering the
    // endpoint every few minutes for hours.
    return { statusCode: 200, body: JSON.stringify({ received: true, error: err.message }) };
  }
};
