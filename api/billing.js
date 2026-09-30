// FYNQ Beta Unlock for the logged-in account.
//
//   GET                                 -> { paywallEnabled, access, price }
//   POST { action: 'checkout' }         -> { url } for Stripe Checkout, or
//                                          { unlocked: true } if no payment is needed
//   POST { action: 'track', event }     -> records a content-free funnel step
//   POST { action: 'pending-save', consent, documents }
//                                       -> { pendingId, expiresAt } (redacted aid lines, encrypted, <=30 min)
//   POST { action: 'pending-discard', pendingId }
//
// The account always comes from the httpOnly session cookie; an account id in
// the request body is never read. With PAYWALL_ENABLED unset or false every
// account is 'open' and nothing touches Stripe or the billing tables.
import { clients, sameOrigin, body, rate, fail, BetaError } from '../server/beta.js';
import {
  paywallEnabled, currentAccount, resolveAccess, createCheckout, track, CLIENT_EVENTS,
  UNLOCK_PRICE, savePending, deletePending,
} from '../server/billing.js';
import { documentsProblem } from '../server/documents.js';
import { redactDocuments } from '../server/redact.js';
import { containsHighRiskPII, PRIVACY_MESSAGE } from '../server/privacy.js';

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
      const status = await resolveAccess(db, account, env);
      const locked = status.access === 'locked';

      if (req.method === 'GET') {
        // sameTabCheckout: whether the encrypted pending store is configured,
        // so a phone can go to Stripe in the same tab without losing its read.
        const sameTabCheckout = typeof env.FYNQ_PENDING_ANALYSIS_KEY === 'string' && env.FYNQ_PENDING_ANALYSIS_KEY.length >= 32;
        return res.json({ paywallEnabled: true, access: status.access, price: UNLOCK_PRICE, sameTabCheckout });
      }

      await rate(db, req, 'billing', 30, env);
      const input = body(req, 120000);
      const action = input?.action;

      if (action === 'track') {
        if (!CLIENT_EVENTS.includes(input.event)) throw new BetaError(400, 'Unknown event.');
        // Only eligible, still-locked post-cutoff accounts are in this funnel.
        if (locked) await track(db, account, input.event, env, status.testAccount);
        return res.json({ ok: true });
      }

      if (action === 'checkout') {
        if (!locked) return res.json({ access: status.access, unlocked: true });
        await track(db, account, 'unlock_clicked', env, status.testAccount);
        const checkout = await createCheckout(db, account, env, { fetchImpl: dependencies.fetchImpl || fetch });
        return res.json({ url: checkout.url });
      }

      if (action === 'pending-save') {
        if (!locked) return res.json({ access: status.access, unlocked: true });
        if (input.consent !== true) throw new BetaError(400, 'Please agree to AI processing to continue.');
        // Original files are refused outright, exactly as /api/analyze does.
        if (input.files !== undefined) throw new BetaError(400, 'Please refresh the page and choose your documents again.');
        const problem = documentsProblem(input.documents, { requireNames: false });
        if (problem) throw new BetaError(problem[0], problem[1]);
        // Redact again here and keep only what the server's own redaction
        // keeps; never store a page that still looks like it holds an SSN,
        // account number or login.
        const redacted = redactDocuments(input.documents.map((d) => ({ pages: d.pages })));
        if (redacted.every((d) => d.keptLines === 0)) throw new BetaError(422, 'Fynliq could not find Pell Grant, scholarship, loan, SAI or balance figures in these files. Try a clearer screenshot of your aid summary.');
        const pages = redacted.map((d) => d.pages);
        if (containsHighRiskPII(pages.flat().join('\n'))) throw new BetaError(400, PRIVACY_MESSAGE);
        return res.json(await savePending(db, account, pages, env));
      }

      if (action === 'pending-discard') {
        await deletePending(db, account, input.pendingId);
        return res.json({ ok: true });
      }

      throw new BetaError(400, 'Unknown request.');
    } catch (error) {
      if (!(error instanceof BetaError)) console.error('Billing error:', error?.name ?? 'Error');
      return fail(res, error);
    }
  };
}

export default createBillingHandler();
