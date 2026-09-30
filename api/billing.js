// FYNQ Beta Unlock for the logged-in account.
//
//   GET                              -> { paywallEnabled, access, price }
//   POST { action: 'checkout' }      -> { url } for Stripe Checkout, or
//                                       { unlocked: true } if no payment is needed
//   POST { action: 'track', event }  -> records a content-free funnel step
//
// The unlock comes first in My Aid, before any document is chosen, so nothing
// about a student's aid ever has to wait on (or travel through) a payment.
// The account always comes from the httpOnly session cookie; an account id in
// the request body is never read. With PAYWALL_ENABLED unset or false every
// account is 'open' and nothing touches Stripe or the billing tables.
import { clients, sameOrigin, body, rate, fail, BetaError } from '../server/beta.js';
import {
  paywallEnabled, currentAccount, resolveAccess, createCheckout, track, CLIENT_EVENTS, UNLOCK_PRICE, inPilot,
} from '../server/billing.js';

export const config = { maxDuration: 30 };

export function createBillingHandler(dependencies = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const env = dependencies.env || process.env;
      if (req.method !== 'GET' && req.method !== 'POST') throw new BetaError(405, 'Use GET or POST.');

      if (!paywallEnabled(env)) {
        if (req.method === 'GET') return res.json({ paywallEnabled: false, access: 'open', price: UNLOCK_PRICE });
        return res.json({ paywallEnabled: false, access: 'open', unlocked: true });
      }

      const { db } = (dependencies.clients || clients)(env);
      if (req.method === 'POST') sameOrigin(req, env);
      const account = await currentAccount(req, db);
      // Pilot mode: accounts not on PAYWALL_PILOT_EMAILS see no paywall at all.
      if (!inPilot(account, env)) {
        if (req.method === 'GET') return res.json({ paywallEnabled: false, access: 'open', price: UNLOCK_PRICE });
        return res.json({ paywallEnabled: false, access: 'open', unlocked: true, ok: true });
      }
      const status = await resolveAccess(db, account, env);
      const locked = status.access === 'locked';

      if (req.method === 'GET') return res.json({ paywallEnabled: true, access: status.access, price: UNLOCK_PRICE });

      await rate(db, req, 'billing', 30, env);
      const input = body(req, 4000);

      if (input?.action === 'track') {
        if (!CLIENT_EVENTS.includes(input.event)) throw new BetaError(400, 'Unknown event.');
        // Only post-cutoff accounts are in this funnel: still locked, or paid
        // (whose first document check comes after the unlock).
        if (locked || status.access === 'premium') await track(db, account, input.event, env, status.testAccount);
        return res.json({ ok: true });
      }

      if (input?.action === 'checkout') {
        if (!locked) return res.json({ access: status.access, unlocked: true });
        await track(db, account, 'unlock_clicked', env, status.testAccount);
        const checkout = await createCheckout(db, account, env, { fetchImpl: dependencies.fetchImpl || fetch });
        return res.json({ url: checkout.url });
      }

      throw new BetaError(400, 'Unknown request.');
    } catch (error) {
      if (!(error instanceof BetaError)) console.error('Billing error:', error?.name ?? 'Error');
      return fail(res, error);
    }
  };
}

export default createBillingHandler();
