// Unit tests for the FYNQ Beta Unlock server pieces that need no database.
// The full flow against real Postgres is in test/billing-integration.mjs.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formEncode, keyMode, signStripePayload, verifyStripeEvent } from './stripe.js';
import {
  analysisAccess, grandfatherCutoff, paywallEnabled, stripeConfig, testAccountIds,
  DEFAULT_GRANDFATHER_CUTOFF, UnlockRequired,
} from './billing.js';
import { hash } from './beta.js';
import { createAnalyzeHandler } from '../api/analyze.js';

const response = () => ({ statusCode: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, send(v) { this.body = v; return this; }, json(v) { this.body = v; return this; } });
const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'a'.repeat(64);
/** A fake database that knows one session and answers billing_access as told. */
function fakeDb(access) {
  const calls = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push(name);
      if (name === 'account_session') return { data: args.p_hash === hash(TOKEN) ? { user_id: ACCOUNT, email: 'new@example.test' } : null, error: null };
      if (name === 'billing_access') return { data: { account: true, ...access }, error: null };
      return { data: null, error: null };
    },
  };
}
const documents = [{ name: 'award.png', pages: ['Federal Pell Grant Fall 2026 $3,698'] }];
const request = (cookie = '') => ({ method: 'POST', headers: { cookie }, socket: { remoteAddress: `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }, body: { consent: true, documents } });

afterEach(() => { vi.unstubAllGlobals(); });

describe('Stripe webhook signatures', () => {
  const secret = 'whsec_unit_test';
  const payload = JSON.stringify({ id: 'evt_unit123456', type: 'checkout.session.completed' });

  it('accepts a correctly signed, fresh payload', () => {
    expect(verifyStripeEvent(payload, signStripePayload(payload, secret), secret).id).toBe('evt_unit123456');
  });

  it('refuses a wrong secret, a changed body, an old timestamp and a missing header', () => {
    expect(() => verifyStripeEvent(payload, signStripePayload(payload, 'whsec_other'), secret)).toThrow();
    expect(() => verifyStripeEvent(payload.replace('completed', 'expired'), signStripePayload(payload, secret), secret)).toThrow();
    expect(() => verifyStripeEvent(payload, signStripePayload(payload, secret, Math.floor(Date.now() / 1000) - 600), secret)).toThrow();
    expect(() => verifyStripeEvent(payload, undefined, secret)).toThrow();
    expect(() => verifyStripeEvent(payload, signStripePayload(payload, secret), undefined)).toThrow();
  });
});

describe('Stripe request encoding and keys', () => {
  it('form-encodes nested Checkout parameters the way Stripe expects', () => {
    const body = decodeURIComponent(formEncode({ mode: 'payment', line_items: [{ price: 'price_1', quantity: 1 }], metadata: { a: 'b' }, skip: undefined }));
    expect(body).toBe('mode=payment&line_items[0][price]=price_1&line_items[0][quantity]=1&metadata[a]=b');
  });

  it('knows test keys from live keys, and refuses live keys unless explicitly allowed', () => {
    expect(keyMode('sk_test_abc')).toBe('test');
    expect(keyMode('rk_live_abc')).toBe('live');
    expect(keyMode('pk_test_abc')).toBeNull();
    const env = { STRIPE_SECRET_KEY: 'sk_live_abc', STRIPE_PRICE_ID: 'price_1', BETA_ORIGIN: 'https://www.fynliq.com' };
    expect(() => stripeConfig(env)).toThrow();
    expect(stripeConfig({ ...env, STRIPE_ALLOW_LIVE_MODE: 'true' }).livemode).toBe(true);
    expect(stripeConfig({ ...env, STRIPE_SECRET_KEY: 'sk_test_abc' }).livemode).toBe(false);
  });
});

describe('paywall configuration', () => {
  it('is off unless PAYWALL_ENABLED is exactly "true"', () => {
    for (const value of [undefined, '', 'false', 'TRUE', '1', 'yes']) expect(paywallEnabled({ PAYWALL_ENABLED: value })).toBe(false);
    expect(paywallEnabled({ PAYWALL_ENABLED: 'true' })).toBe(true);
  });

  it('defaults to the verified cutoff, keeps microseconds, and fails closed on a malformed one', () => {
    expect(DEFAULT_GRANDFATHER_CUTOFF).toBe('2026-09-30T18:53:52.654622Z');
    expect(grandfatherCutoff({})).toBe('2026-09-30T18:53:52.654622Z');
    expect(() => grandfatherCutoff({ FYNQ_BETA_GRANDFATHER_CUTOFF: '2026-09-30 18:53' })).toThrow();
  });

  it('reads admin/test accounts from both lists and ignores anything that is not an id', () => {
    const ids = testAccountIds({ FYNQ_BILLING_TEST_ACCOUNT_IDS: ` ${ACCOUNT.toUpperCase()}, not-an-id`, BETA_ADMIN_USER_IDS: '22222222-2222-4222-8222-222222222222' });
    expect([...ids].sort()).toEqual([ACCOUNT, '22222222-2222-4222-8222-222222222222']);
  });
});

describe('premium analysis gate', () => {
  it('with the paywall off, touches no database and lets everyone through', async () => {
    const clients = vi.fn();
    expect((await analysisAccess(request(), {}, { clients })).access).toBe('open');
    expect(clients).not.toHaveBeenCalled();
  });

  it('with the paywall on, locks a new unpaid account and lets grandfathered, paid and test accounts through', async () => {
    const env = { PAYWALL_ENABLED: 'true' };
    const cookie = `__Host-fynliq_account=${TOKEN}`;
    await expect(analysisAccess(request(cookie), env, { clients: () => ({ db: fakeDb({ grandfathered: false, premium: false }) }) })).rejects.toThrow(UnlockRequired);
    expect((await analysisAccess(request(cookie), env, { clients: () => ({ db: fakeDb({ grandfathered: true, premium: false }) }) })).access).toBe('grandfathered');
    expect((await analysisAccess(request(cookie), env, { clients: () => ({ db: fakeDb({ grandfathered: false, premium: true }) }) })).access).toBe('premium');
    expect((await analysisAccess(request(cookie), { ...env, FYNQ_BILLING_TEST_ACCOUNT_IDS: ACCOUNT }, { clients: () => ({ db: fakeDb({ grandfathered: false, premium: false }) }) })).access).toBe('test_account');
    await expect(analysisAccess(request(), env, { clients: () => ({ db: fakeDb({}) }) })).rejects.toThrow('Please log in');
  });

  it('reads for a locked account but answers with a preview only, keeping the full read on the server', async () => {
    const facts = [{ field: 'grantOffer', label: 'Federal Pell Grant', value: '$3,698', page: 1, document: 1, kind: 'award-letter', period: 'Fall 2026', estimated: false, quote: 'Federal Pell Grant Fall 2026 $3,698' }];
    const openai = vi.fn(async () => ({ ok: true, json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ supported: true, conflicts: [], facts }) }] }] }) }));
    vi.stubGlobal('fetch', openai);
    const db = fakeDb({ grandfathered: false, premium: false });
    const rpc = db.rpc;
    db.rpc = async (name, args) => (name === 'aid_analysis_save' ? { data: '33333333-3333-4333-8333-333333333333', error: null } : rpc(name, args));
    const handler = createAnalyzeHandler({
      env: { PAYWALL_ENABLED: 'true', OPENAI_API_KEY: 'x', OPENAI_MODEL: 'x' },
      clients: () => ({ db }),
      fetchImpl: openai,
    });
    const res = response();
    await handler(request(`__Host-fynliq_account=${TOKEN}`), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.locked).toBe(true);
    expect(res.body.analysisId).toBe('33333333-3333-4333-8333-333333333333');
    expect(res.body.preview.glance.freeMoney).toBe(3698);
    const text = JSON.stringify(res.body);
    for (const leak of ['Pell', 'quote', 'summaryFacts', 'summaryToken', 'Fall 2026']) expect(text).not.toContain(leak);
  });
});
