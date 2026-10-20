// Stripe webhook: the ONLY path that activates a paid FYNQ Beta Unlock.
//
// The browser's success URL proves nothing and changes nothing. An
// entitlement is written only when:
//   1. the Stripe-Signature header verifies against the RAW body with
//      STRIPE_WEBHOOK_SECRET (and is under five minutes old),
//   2. the event id has not been processed before,
//   3. the Checkout Session is one FYNQ created, for the same account named
//      in its metadata and client_reference_id,
//   4. payment_status is 'paid' and the amount is exactly $1.00 USD.
// Checks 2-4 run inside one Postgres transaction (billing_stripe_event).
//
// Subscribe the endpoint to: checkout.session.completed,
// checkout.session.async_payment_succeeded, checkout.session.async_payment_failed,
// checkout.session.expired.
import { observe } from '../server/observability.js';
import { clients, rpc, BetaError } from '../server/beta.js';
import { verifyStripeEvent, StripeSignatureError } from '../server/stripe.js';
import { testAccountIds, UNLOCK_PRICE, PURPOSE } from '../server/billing.js';
import { track as trackEvents } from '../server/analytics.js';

// Signature verification needs the exact bytes Stripe sent.
export const config = { api: { bodyParser: false }, maxDuration: 30 };

const MAX_BODY = 512 * 1024;

/** The unparsed request body. Fails closed if only a parsed object is available. */
export async function rawBody(req) {
  // Read the stream first and only then look at req.body: on Vercel the
  // body helper is a lazy getter, and touching it can parse the payload.
  if (typeof req.on === 'function' && req.readable !== false) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw new StripeSignatureError('Payload too large.');
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    if (size) return Buffer.concat(chunks);
  }
  if (Buffer.isBuffer(req.body) || typeof req.body === 'string') return req.body;
  throw new StripeSignatureError('Raw body unavailable.');
}

export function createStripeWebhookHandler(dependencies = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).send('Use POST.'); }
    const env = dependencies.env || process.env;

    let event;
    try {
      event = verifyStripeEvent(await rawBody(req), req.headers['stripe-signature'], env.STRIPE_WEBHOOK_SECRET, { now: dependencies.now?.() ?? Date.now() });
    } catch (error) {
      if (error instanceof StripeSignatureError) {
        console.warn('Stripe webhook rejected:', error.message);
        return res.status(400).send('Invalid signature.');
      }
      return res.status(400).send('Invalid request.');
    }

    if (!/^evt_[A-Za-z0-9_]{6,200}$/.test(event.id)) return res.status(400).send('Invalid event.');
    const session = event.data?.object ?? {};
    const isSession = session.object === 'checkout.session' && typeof session.id === 'string';
    const metadata = session.metadata && typeof session.metadata === 'object' ? session.metadata : {};
    const account = typeof metadata.fynq_account_id === 'string' ? metadata.fynq_account_id.toLowerCase() : null;
    const ours = isSession && metadata.purpose === PURPOSE;

    try {
      const { db } = (dependencies.clients || clients)(env);
      const result = await rpc(db, 'billing_stripe_event', {
        p_event_id: event.id,
        p_type: ours ? event.type : `unhandled:${String(event.type).slice(0, 80)}`,
        p_livemode: event.livemode === true,
        p_session: ours ? session.id : null,
        p_account: ours ? account : null,
        p_client_reference: ours && typeof session.client_reference_id === 'string' ? session.client_reference_id.toLowerCase() : null,
        p_payment_status: ours && typeof session.payment_status === 'string' ? session.payment_status : null,
        p_amount: ours && Number.isInteger(session.amount_total) ? session.amount_total : null,
        p_currency: ours && typeof session.currency === 'string' ? session.currency.toLowerCase() : null,
        p_payment_intent: ours && typeof session.payment_intent === 'string' ? session.payment_intent : null,
        p_customer: ours && typeof session.customer === 'string' ? session.customer : null,
        p_expected_amount: UNLOCK_PRICE.amount,
        p_expected_currency: UNLOCK_PRICE.currency,
        p_test: account ? testAccountIds(env).has(account) : false,
      });
      // Ids and outcome codes only.
      console.log('Stripe webhook:', JSON.stringify({ type: event.type, outcome: result?.outcome ?? null }));
      // Canonical analytics, derived ONLY from the outcome of the verified,
      // transactional billing_stripe_event call above. One event per Checkout
      // Session (dedupe key); a duplicate delivery records nothing new.
      const names = !ours || !account || result?.duplicate ? [] : ({
        entitlement_activated: ['payment_completed', 'unlock_verified'],
        already_entitled: [{ name: 'payment_completed', metadata: { duplicate: true } }],
        payment_failed: ['payment_failed'],
        expired: ['checkout_expired'],
      })[result?.outcome] ?? [];
      if (names.length) {
        await trackEvents(req, names.map((n) => ({ ...(typeof n === 'string' ? { name: n } : n), key: session.id })),
          { identity: { userId: account, guestId: null }, livemode: event.livemode === true,
            metadata: { stripe_outcome: result.outcome } }, { env, db });
      }
      return res.status(200).json({ received: true, duplicate: result?.duplicate === true });
    } catch (error) {
      // 5xx makes Stripe retry; the transaction rolled back, including the
      // event id, so the retry is processed normally.
      console.error('Stripe webhook failed:', error instanceof BetaError ? 'database' : (error?.name ?? 'Error'));
      return res.status(500).send('Webhook processing failed.');
    }
  };
}

export default observe('/api/stripe-webhook', createStripeWebhookHandler());
