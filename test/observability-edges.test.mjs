// QA edge cases for the Phase 2 observability layer (PR #18), written from the
// requirement, not the implementation. node:test, synthetic data, fake
// database and fake Stripe/OpenAI; no network, no PGlite.
//
//   node --test test/observability-edges.test.mjs
//
// Covers what the PGlite suite does not:
//   * webhook outcome -> analytics mapping, redelivery, and events that must
//     never produce a payment event (not_paid, already_paid, mismatches,
//     unknown sessions, foreign checkout sessions, forged signatures);
//   * login, signup, session and the document reader keep working, in time,
//     when the analytics store fails or hangs;
//   * analysis_failed is recorded for a reader error (doc: "Tested in: -");
//   * the wrapped API modules keep their Vercel config exports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createStripeWebhookHandler, config as webhookConfig } from '../api/stripe-webhook.js';
import { createAnalyzeHandler, setUploadTracker, config as analyzeConfig } from '../api/analyze.js';
import { createAccountHandler } from '../server/account-login.js';
import { createBillingHandler } from '../api/billing.js';
import { recordUpload } from '../server/upload-tracking.js';
import { signStripePayload } from '../server/stripe.js';

const ORIGIN = 'https://www.fynliq.test';
const SECRET = 'whsec_synthetic_edge_secret';
const ACCOUNT = '40000000-0000-4000-8000-000000000001';
const GUEST = '50000000-0000-4000-8000-000000000001';
const GUEST_TOKEN = 'a'.repeat(64);
const ACCOUNT_TOKEN = 'b'.repeat(64);
const env = {
  BETA_ORIGIN: ORIGIN, BETA_RATE_SECRET: 'synthetic-rate-secret-at-least-32-chars', STRIPE_WEBHOOK_SECRET: SECRET,
};

function response() {
  return { statusCode: 200, headers: {}, body: undefined, headersSent: false,
    setHeader(k, v) { this.headers[k] = v; }, getHeader(k) { return this.headers[k]; },
    status(n) { this.statusCode = n; return this; },
    send(v) { this.body = v; this.headersSent = true; return this; },
    json(v) { this.body = v; this.headersSent = true; return this; } };
}

/**
 * A fake Supabase client. `answers[name]` is the RPC's data (or a function of
 * the args). `analytics` decides what analytics_record does: 'ok', 'fail' or
 * 'hang'. Every analytics row sent is collected in `sent`.
 */
function fakeDb(answers = {}, analytics = 'ok') {
  const sent = [];
  const calls = [];
  const db = {
    sent, calls,
    rpc(name, args = {}) {
      calls.push(name);
      if (name === 'analytics_record') {
        sent.push(...args.p_events);
        if (analytics === 'hang') return new Promise(() => {});
        if (analytics === 'fail') return Promise.resolve({ data: null, error: { message: 'down' } });
        return Promise.resolve({ data: args.p_events.length, error: null });
      }
      const answer = answers[name];
      const data = typeof answer === 'function' ? answer(args) : answer ?? null;
      return Promise.resolve({ data, error: null });
    },
  };
  return db;
}

// ------------------------------------------------------------------ webhook

const sessionEvent = (type, extra = {}) => ({
  id: `evt_edge${randomUUID().replace(/-/g, '').slice(0, 12)}`, object: 'event', type, livemode: true,
  data: { object: { object: 'checkout.session', id: 'cs_live_edge000001', client_reference_id: ACCOUNT,
    metadata: { fynq_account_id: ACCOUNT, purpose: 'fynq_beta_unlock' }, payment_status: 'paid',
    amount_total: 100, currency: 'usd', ...extra } },
});

async function deliver(db, event, { secret = SECRET } = {}) {
  const payload = JSON.stringify(event);
  const res = response();
  const started = Date.now();
  await createStripeWebhookHandler({ env, clients: () => ({ db }) })(
    { method: 'POST', body: payload, headers: { 'stripe-signature': signStripePayload(payload, secret), 'user-agent': 'Stripe/1.0' } }, res);
  return { res, ms: Date.now() - started };
}

test('webhook: entitlement_activated records payment_completed + unlock_verified, keyed by the checkout session, live mode', async () => {
  const db = fakeDb({ billing_stripe_event: { duplicate: false, outcome: 'entitlement_activated' } });
  const { res } = await deliver(db, sessionEvent('checkout.session.completed'));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(db.sent.map((e) => e.event_name).sort(), ['payment_completed', 'unlock_verified']);
  for (const e of db.sent) {
    assert.equal(e.dedupe_key, 'cs_live_edge000001');
    assert.equal(e.user_id, ACCOUNT);
    assert.equal(e.livemode, true);
    assert.equal(e.side, 'server');
    assert.equal(e.metadata.stripe_outcome, 'entitlement_activated');
  }
});

test('webhook: a redelivered event (duplicate) records nothing at all', async () => {
  const db = fakeDb({ billing_stripe_event: { duplicate: true, outcome: 'entitlement_activated' } });
  const { res } = await deliver(db, sessionEvent('checkout.session.completed'));
  assert.equal(res.statusCode, 200);
  assert.equal(db.sent.length, 0);
});

test('webhook: a second paid session for an entitled account is payment_completed with duplicate=true, no unlock_verified', async () => {
  const db = fakeDb({ billing_stripe_event: { duplicate: false, outcome: 'already_entitled' } });
  await deliver(db, sessionEvent('checkout.session.completed'));
  assert.deepEqual(db.sent.map((e) => e.event_name), ['payment_completed']);
  assert.equal(db.sent[0].metadata.duplicate, true);
});

test('webhook: outcomes that are not a payment never produce a payment event', async () => {
  for (const outcome of ['not_paid', 'already_paid', 'amount_mismatch', 'mode_mismatch', 'ownership_mismatch', 'unknown_session', 'ignored']) {
    const db = fakeDb({ billing_stripe_event: { duplicate: false, outcome } });
    const { res } = await deliver(db, sessionEvent('checkout.session.completed'));
    assert.equal(res.statusCode, 200, outcome);
    assert.equal(db.sent.length, 0, `${outcome} must record no analytics event`);
  }
});

test('webhook: someone else\'s Checkout Session (no FYNQ purpose) records nothing even if the RPC says activated', async () => {
  const db = fakeDb({ billing_stripe_event: { duplicate: false, outcome: 'entitlement_activated' } });
  await deliver(db, sessionEvent('checkout.session.completed', { metadata: { fynq_account_id: ACCOUNT, purpose: 'other' } }));
  assert.equal(db.sent.length, 0);
});

test('webhook: a forged signature is 400 and never reaches the database or analytics', async () => {
  const db = fakeDb({ billing_stripe_event: { duplicate: false, outcome: 'entitlement_activated' } });
  const { res } = await deliver(db, sessionEvent('checkout.session.completed'), { secret: 'whsec_wrong' });
  assert.equal(res.statusCode, 400);
  assert.equal(db.calls.length, 0);
});

test('webhook: failed and expired sessions map to payment_failed / checkout_expired, once per session', async () => {
  for (const [type, outcome, name] of [
    ['checkout.session.async_payment_failed', 'payment_failed', 'payment_failed'],
    ['checkout.session.expired', 'expired', 'checkout_expired'],
  ]) {
    const db = fakeDb({ billing_stripe_event: { duplicate: false, outcome } });
    await deliver(db, sessionEvent(type, { payment_status: 'unpaid' }));
    assert.deepEqual(db.sent.map((e) => [e.event_name, e.dedupe_key]), [[name, 'cs_live_edge000001']]);
  }
});

test('webhook: analytics failing or hanging still answers 200 promptly (Stripe must not retry because of analytics)', async () => {
  for (const mode of ['fail', 'hang']) {
    const db = fakeDb({ billing_stripe_event: { duplicate: false, outcome: 'entitlement_activated' } }, mode);
    const { res, ms } = await deliver(db, sessionEvent('checkout.session.completed'));
    assert.equal(res.statusCode, 200, mode);
    assert.ok(ms < 2500, `${mode}: answered in ${ms} ms`);
  }
});

test('on Vercel (request context with waitUntil) a hanging analytics store adds no wait at all; the work is handed to waitUntil', async () => {
  const key = Symbol.for('@vercel/request-context');
  const handed = [];
  const previous = globalThis[key];
  globalThis[key] = { get: () => ({ waitUntil: (p) => { handed.push(p); } }) };
  try {
    const db = fakeDb({ billing_stripe_event: { duplicate: false, outcome: 'entitlement_activated' } }, 'hang');
    const { res, ms } = await deliver(db, sessionEvent('checkout.session.completed'));
    assert.equal(res.statusCode, 200);
    assert.ok(ms < 300, `answered in ${ms} ms`);
    assert.ok(handed.length >= 1, 'analytics work handed to waitUntil');
  } finally {
    if (previous === undefined) delete globalThis[key]; else globalThis[key] = previous;
  }
});

test('the wrapped API modules keep their Vercel config exports (raw body for the webhook, 60 s for the reader)', () => {
  assert.equal(webhookConfig.api.bodyParser, false);
  assert.equal(analyzeConfig.maxDuration, 60);
});

// ------------------------------------------------- accounts, analytics down

const accountAnswers = {
  beta_rate: true,
  beta_session: ({ p_hash }) => (p_hash === createHash('sha256').update(GUEST_TOKEN).digest('hex') ? { user_id: GUEST, kind: 'guest' } : null),
  account_session: ({ p_hash }) => (p_hash === createHash('sha256').update(ACCOUNT_TOKEN).digest('hex')
    ? { user_id: ACCOUNT, email: 'edge@example.test', created_at: '2026-10-01T00:00:00Z', expires_at: '2027-10-01T00:00:00Z' } : null),
  account_start_session: { user_id: ACCOUNT, email: 'edge@example.test', created_at: '2026-10-01T00:00:00Z', expires_at: '2027-10-01T00:00:00Z' },
  account_signed_up: null,
  account_link_guest: null,
};
const cookies = `__Host-fynliq_beta=${GUEST_TOKEN}; __Host-fynliq_account=${ACCOUNT_TOKEN}`;

async function account(action, db, { method = 'POST', body, password = 'correct-horse-battery' } = {}) {
  const auth = { auth: { signInWithPassword: async ({ email, password: p }) => (p === password
    ? { data: { user: { id: ACCOUNT, email } }, error: null } : { data: null, error: { message: 'bad' } }) } };
  db.auth = { admin: { createUser: async ({ email }) => ({ data: { user: { id: ACCOUNT, email } }, error: null }) } };
  const res = response();
  const started = Date.now();
  await createAccountHandler(action, { env, clients: () => ({ db, auth }) })({
    method, body: body ? JSON.stringify(body) : undefined, socket: { remoteAddress: '198.51.100.7' },
    headers: { 'content-type': 'application/json', origin: ORIGIN, cookie: cookies, 'user-agent': 'Mozilla/5.0 (iPhone) Mobile' },
  }, res);
  return { res, ms: Date.now() - started };
}

test('login, failed login, signup and session all succeed promptly with analytics failing or hanging', async () => {
  for (const mode of ['fail', 'hang']) {
    const login = await account('login', fakeDb(accountAnswers, mode), { body: { email: 'edge@example.test', password: 'correct-horse-battery' } });
    assert.equal(login.res.statusCode, 200, `login (${mode})`);
    assert.ok(String(login.res.headers['Set-Cookie']).startsWith('__Host-fynliq_account='), `login cookie (${mode})`);
    assert.ok(login.ms < 2500, `login (${mode}) took ${login.ms} ms`);

    const bad = await account('login', fakeDb(accountAnswers, mode), { body: { email: 'edge@example.test', password: 'wrong-password-123' } });
    assert.equal(bad.res.statusCode, 401, `bad login (${mode})`);
    assert.ok(bad.ms < 2500, `bad login (${mode}) took ${bad.ms} ms`);

    const signup = await account('signup', fakeDb(accountAnswers, mode), { body: { email: 'new@example.test', password: 'correct-horse-battery' } });
    assert.equal(signup.res.statusCode, 200, `signup (${mode})`);
    assert.ok(signup.ms < 2500, `signup (${mode}) took ${signup.ms} ms`);

    const session = await account('session', fakeDb(accountAnswers, mode), { method: 'GET' });
    assert.equal(session.res.statusCode, 200, `session (${mode})`);
    assert.ok(session.ms < 2500, `session (${mode}) took ${session.ms} ms`);
  }
});

test('login_failed carries no email and no account id; login_completed joins guest and account', async () => {
  const bad = fakeDb(accountAnswers);
  await account('login', bad, { body: { email: 'edge@example.test', password: 'wrong-password-123' } });
  assert.deepEqual(bad.sent.map((e) => [e.event_name, e.user_id, e.anonymous_session_id]), [['login_failed', null, GUEST]]);
  assert.ok(!JSON.stringify(bad.sent).includes('edge@example.test'));
  const good = fakeDb(accountAnswers);
  await account('login', good, { body: { email: 'edge@example.test', password: 'correct-horse-battery' } });
  assert.deepEqual(good.sent.map((e) => [e.event_name, e.user_id, e.anonymous_session_id]), [['login_completed', ACCOUNT, GUEST]]);
});

test('checkout: analytics failing or hanging never blocks the Stripe redirect; checkout_started is keyed by the session', async () => {
  const billingEnv = { ...env, PAYWALL_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test_synthetic123', STRIPE_PRICE_ID: 'price_synthetic123' };
  const stripeFetch = async () => ({ ok: true, status: 200, json: async () => ({ id: 'cs_test_edge000001', object: 'checkout.session',
    url: 'https://checkout.stripe.com/c/pay/cs_test_edge000001', livemode: false }) });
  for (const mode of ['ok', 'fail', 'hang']) {
    const db = fakeDb({ ...accountAnswers, billing_access: { account: true, grandfathered: false, premium: false },
      billing_open_checkout: null, billing_track: null, billing_checkout_created: null, attribution_for_account: null }, mode);
    const res = response();
    const started = Date.now();
    await createBillingHandler({ env: billingEnv, clients: () => ({ db }), fetchImpl: stripeFetch })({
      method: 'POST', body: JSON.stringify({ action: 'checkout' }), socket: { remoteAddress: '198.51.100.30' },
      headers: { 'content-type': 'application/json', origin: ORIGIN, cookie: cookies },
    }, res);
    const ms = Date.now() - started;
    assert.equal(res.statusCode, 200, `${mode}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.url, 'https://checkout.stripe.com/c/pay/cs_test_edge000001');
    assert.ok(ms < 2500, `${mode}: took ${ms} ms`);
    if (mode === 'ok') {
      assert.deepEqual(db.sent.map((e) => [e.event_name, e.dedupe_key, e.user_id, e.livemode]),
        [['checkout_started', 'cs_test_edge000001', ACCOUNT, false]]);
      assert.ok(!JSON.stringify(db.sent).includes('edge@example.test'), 'no email in analytics');
    }
  }
});

// ------------------------------------------------------- document reader

const facts = [{ field: 'grantOffer', label: 'Federal Pell Grant', value: '$3,698', page: 1, document: 1, kind: 'award-letter',
  period: 'Fall 2026', estimated: false, quote: 'Federal Pell Grant Fall 2026 $3,698' }];
const documents = [{ name: 'Jordan_Edgecase_award.png', pages: ['Aid Offer for Jordan Edgecase\nFederal Pell Grant Fall 2026 $3,698'] }];
const readerOk = async () => ({ ok: true, json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text',
  text: JSON.stringify({ supported: true, conflicts: [], facts }) }] }] }) });
const readerDown = async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => 'upstream' });

async function analyze(db, fetchImpl, ip) {
  const readerEnv = { ...env, OPENAI_API_KEY: 'synthetic', OPENAI_MODEL: 'synthetic' };
  setUploadTracker((req, data) => recordUpload(req, data, { env: readerEnv, clients: () => ({ db }) }));
  const res = response();
  const started = Date.now();
  try {
    await createAnalyzeHandler({ env: readerEnv, clients: () => ({ db }), fetchImpl })({
      method: 'POST', body: { consent: true, documents }, socket: { remoteAddress: ip },
      headers: { 'content-type': 'application/json', origin: ORIGIN, cookie: cookies, 'user-agent': 'Mozilla/5.0 (iPhone) Mobile', 'x-forwarded-for': ip },
    }, res);
  } finally { setUploadTracker(recordUpload); }
  return { res, ms: Date.now() - started };
}

test('document reader: still answers 200 promptly with analytics failing or hanging', async () => {
  for (const [i, mode] of ['fail', 'hang'].entries()) {
    const { res, ms } = await analyze(fakeDb(accountAnswers, mode), readerOk, `203.0.113.${10 + i}`);
    assert.equal(res.statusCode, 200, `${mode}: ${JSON.stringify(res.body)}`);
    assert.ok(ms < 4000, `${mode}: took ${ms} ms`);
  }
});

test('document reader: one upload_completed, analysis_started, analysis_completed; content never in analytics', async () => {
  const db = fakeDb(accountAnswers);
  const { res } = await analyze(db, readerOk, '203.0.113.20');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(db.sent.map((e) => e.event_name).sort(), ['analysis_completed', 'analysis_started', 'upload_completed']);
  const text = JSON.stringify(db.sent);
  for (const needle of ['Jordan', 'Edgecase', '3,698', 'Pell']) assert.ok(!text.includes(needle), `${needle} reached analytics`);
});

test('document reader: a document with no aid lines records server upload_failed (reason no_aid_lines), never analysis_completed', async () => {
  const db = fakeDb(accountAnswers);
  const readerEnv = { ...env, OPENAI_API_KEY: 'synthetic', OPENAI_MODEL: 'synthetic' };
  setUploadTracker((req, data) => recordUpload(req, data, { env: readerEnv, clients: () => ({ db }) }));
  const res = response();
  try {
    await createAnalyzeHandler({ env: readerEnv, clients: () => ({ db }), fetchImpl: readerOk })({
      method: 'POST', body: { consent: true, documents: [{ name: 'x.png', pages: ['Hello world'] }] }, socket: { remoteAddress: '203.0.113.40' },
      headers: { 'content-type': 'application/json', origin: ORIGIN, cookie: cookies, 'x-forwarded-for': '203.0.113.40' },
    }, res);
  } finally { setUploadTracker(recordUpload); }
  assert.equal(res.statusCode, 422);
  const failed = db.sent.filter((e) => e.event_name === 'upload_failed');
  assert.equal(failed.length, 1);
  assert.equal(failed[0].side, 'server');
  assert.equal(failed[0].metadata.reason, 'no_aid_lines');
  assert.ok(!db.sent.some((e) => e.event_name === 'analysis_completed'));
});

test('document reader: a provider error records analysis_failed (with ai_ms) and no analysis_completed', async () => {
  const db = fakeDb(accountAnswers);
  const { res } = await analyze(db, readerDown, '203.0.113.30');
  assert.equal(res.statusCode, 502);
  const names = db.sent.map((e) => e.event_name);
  assert.ok(names.includes('analysis_failed'), names.join(','));
  assert.ok(!names.includes('analysis_completed'));
  const failed = db.sent.find((e) => e.event_name === 'analysis_failed');
  assert.ok(Number.isInteger(failed.metadata.ai_ms));
});
