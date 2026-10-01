// FYNQ Beta Unlock: end-to-end billing tests against a real Postgres running
// every migration, with a fake Stripe and a fake OpenAI. Synthetic data only;
// no network calls.
//
//   npm run test:billing                      # uses PGlite (devDependency)
//   BILLING_TEST_PSQL_DB=fynq_test npm run test:billing
//                                             # uses a local Postgres via psql
//                                             # (PGHOST/PGUSER from the environment)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { createBillingHandler } from '../api/billing.js';
import { createStripeWebhookHandler } from '../api/stripe-webhook.js';
import { createAnalyzeHandler, setUploadTracker } from '../api/analyze.js';
import { createAdminHandler } from '../api/beta-admin.js';
import { createAskHandler } from '../api/ask.js';
import { createAuthHandler } from '../api/beta-auth.js';
import { recordUpload } from '../server/upload-tracking.js';
import { signStripePayload, verifyStripeEvent } from '../server/stripe.js';
import { DEFAULT_GRANDFATHER_CUTOFF } from '../server/billing.js';

// ------------------------------------------------------------ database

const migrations = (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter((f) => f.endsWith('.sql')).sort();

function literal(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `'{${value.map((v) => `"${String(v).replace(/["\\]/g, '\\$&')}"`).join(',')}}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}
const inline = (sql, params = []) => sql.replace(/\$(\d+)/g, (_, n) => literal(params[Number(n) - 1]));

async function openDatabase() {
  if (process.env.BILLING_TEST_PSQL_DB) {
    const name = process.env.BILLING_TEST_PSQL_DB;
    const psql = (sql, database = name) => execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', database, '-c', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    psql(`drop database if exists ${name}`, 'postgres');
    psql(`create database ${name}`, 'postgres');
    try { psql('create role anon; create role authenticated; create role service_role bypassrls;', 'postgres'); } catch { /* roles are cluster-wide */ }
    return {
      kind: 'psql',
      exec: async (sql) => { psql(sql); },
      query: async (sql, params) => JSON.parse(psql(`select coalesce(json_agg(t), '[]')::text from (${inline(sql, params)}) t`) || '[]'),
      value: async (sql, params) => JSON.parse(psql(`select row_to_json(t)::text from (${inline(sql, params)}) t`)).value,
      close: async () => {},
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite();
  await pg.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  return {
    kind: 'pglite',
    exec: async (sql) => { await pg.exec(sql); },
    query: async (sql, params) => JSON.parse(JSON.stringify((await pg.query(inline(sql, params))).rows)),
    value: async (sql, params) => JSON.parse(JSON.stringify((await pg.query(inline(sql, params))).rows[0] ?? { value: null })).value,
    close: () => pg.close(),
  };
}

const pg = await openDatabase();
for (const file of migrations) await pg.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
await pg.exec('grant usage on schema public to anon, authenticated, service_role');

let rpcCalls = 0;
const db = {
  async rpc(name, args = {}) {
    rpcCalls++;
    const entries = Object.entries(args);
    try {
      const value = await pg.value(`select public.${name}(${entries.map(([k], i) => `${k} => $${i + 1}`).join(', ')}) as value`, entries.map(([, v]) => v));
      return { data: value === '' ? null : value, error: null };
    } catch { return { data: null, error: true }; }
  },
};
const noDatabase = () => { throw new Error('The paywall-off path must not touch the database.'); };

// ------------------------------------------------------------- fixtures

const ORIGIN = 'https://www.fynliq.test';
const WEBHOOK_SECRET = 'whsec_synthetic_test_secret';
const ids = {
  before: '10000000-0000-4000-8000-000000000001',
  exact: '10000000-0000-4000-8000-000000000002',
  after: '10000000-0000-4000-8000-000000000003',
  buyer: '10000000-0000-4000-8000-000000000004',
  other: '10000000-0000-4000-8000-000000000005',
  tester: '10000000-0000-4000-8000-000000000006',
  decliner: '10000000-0000-4000-8000-000000000007',
  canceller: '10000000-0000-4000-8000-000000000008',
};
const env = {
  PAYWALL_ENABLED: 'true', BETA_ENABLED: 'true', BETA_ORIGIN: ORIGIN, BETA_RATE_SECRET: 'synthetic-rate-secret-at-least-32-chars',
  STRIPE_SECRET_KEY: 'sk_test_synthetic123', STRIPE_PRICE_ID: 'price_synthetic123', STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  FYNQ_BETA_GRANDFATHER_CUTOFF: DEFAULT_GRANDFATHER_CUTOFF, FYNQ_BILLING_TEST_ACCOUNT_IDS: ids.tester,
  OPENAI_API_KEY: 'synthetic', OPENAI_MODEL: 'synthetic', BETA_MAX_QUESTIONS_PER_DAY: '10000', OPENAI_MAX_OUTPUT_TOKENS: '1200',
};
const cookies = {};
const created = {
  before: '2026-09-29T12:00:00Z',
  exact: DEFAULT_GRANDFATHER_CUTOFF,
  after: '2026-09-30T18:53:52.654623Z', // one microsecond after the cutoff
  buyer: '2026-10-01T09:00:00Z', other: '2026-10-01T09:05:00Z', tester: '2026-10-01T09:10:00Z',
  decliner: '2026-10-02T09:00:00Z', canceller: '2026-10-02T10:00:00Z',
};
for (const [key, id] of Object.entries(ids)) {
  await pg.exec(`insert into public.accounts(user_id, email, created_at) values ('${id}', '${key}@example.test', '${created[key]}')`);
  const token = randomBytes(32).toString('hex');
  await db.rpc('account_start_session', { p_user: id, p_email: `${key}@example.test`, p_hash: createHash('sha256').update(token).digest('hex'), p_guest: null });
  cookies[key] = `__Host-fynliq_account=${token}`;
}

// Fake Stripe: records every request so the tests can inspect exactly what left FYNQ.
const stripeRequests = [];
let sessionCounter = 0;
const stripeFetch = async (url, init) => {
  const params = new URLSearchParams(init.body);
  stripeRequests.push({ url, headers: init.headers, body: init.body, params });
  const id = `cs_test_synthetic${String(++sessionCounter).padStart(4, '0')}`;
  return { ok: true, status: 200, json: async () => ({ id, object: 'checkout.session', url: `https://checkout.stripe.com/c/pay/${id}`, livemode: false }) };
};

// Fake OpenAI for the document reader.
let openaiCalls = 0;
const MARKER = 'SYNTHETICMARKER';
const facts = [
  { field: 'grantOffer', label: 'Federal Pell Grant', value: '$3,698', page: 1, document: 1, kind: 'award-letter', period: 'Fall 2026', estimated: false, quote: 'Federal Pell Grant Fall 2026 $3,698' },
];
const openaiFetch = async (_url, init) => {
  openaiCalls++;
  assert.ok(!init.body.includes('Jordan'), 'names never reach the model');
  return { ok: true, json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ supported: true, conflicts: [], facts }) }] }] }) };
};
const documents = [{ name: `Jordan_Testcase_award_${MARKER}.png`, pages: [`Aid Offer for Jordan Testcase\nSSN 123-45-6789\nFederal Pell Grant Fall 2026 $3,698\nScholarship ${MARKER} Fall 2026 $500.00`] }];

const deps = (overrides = {}) => ({ env, clients: () => ({ db }), fetchImpl: stripeFetch, ...overrides });
const billing = (overrides) => createBillingHandler(deps(overrides));
const analyze = (overrides) => createAnalyzeHandler(deps({ fetchImpl: openaiFetch, ...overrides }));
const webhook = (overrides) => createStripeWebhookHandler(deps(overrides));

let ip = 0;
function response() {
  return { statusCode: 200, headers: {}, body: undefined, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, send(v) { this.body = v; return this; }, json(v) { this.body = v; return this; } };
}
async function call(handler, { method = 'POST', body, cookie = '', headers = {} } = {}) {
  const res = response();
  await handler({ method, body, headers: { 'content-type': 'application/json', origin: ORIGIN, cookie, ...headers }, socket: { remoteAddress: `192.0.2.${(++ip % 250) + 1}` } }, res);
  return res;
}
const status = async (who, overrides) => (await call(billing(overrides), { method: 'GET', cookie: cookies[who] })).body;
const read = (who, extra = {}, overrides) => call(analyze(overrides), { body: { consent: true, documents, ...extra }, cookie: cookies[who] });
const clearRates = () => pg.exec('delete from public.beta_rate_windows');

let eventCounter = 0;
function stripeEvent(type, session, extra = {}) {
  return { id: `evt_synthetic${String(++eventCounter).padStart(5, '0')}`, object: 'event', type, livemode: false, data: { object: { object: 'checkout.session', ...session } }, ...extra };
}
function sessionFor(account, id, overrides = {}) {
  return { id, mode: 'payment', client_reference_id: account, metadata: { fynq_account_id: account, purpose: 'fynq_beta_unlock' }, payment_status: 'paid', status: 'complete', amount_total: 100, currency: 'usd', payment_intent: `pi_synthetic${id.slice(-6)}xx`, customer: 'cus_synthetic01', ...overrides };
}
async function deliver(event, { secret = WEBHOOK_SECRET, stream = false, raw } = {}) {
  const payload = raw ?? JSON.stringify(event);
  const res = response();
  const req = stream ? Object.assign(Readable.from([Buffer.from(payload)]), { method: 'POST', headers: { 'stripe-signature': signStripePayload(payload, secret) } })
    : { method: 'POST', body: payload, headers: { 'stripe-signature': signStripePayload(payload, secret) } };
  await webhook()(req, res);
  return res;
}
async function startCheckout(who) {
  await clearRates();
  const res = await call(billing(), { body: { action: 'checkout' }, cookie: cookies[who] });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body;
}
const sessionIdFromUrl = (url) => url.split('/').pop();
const entitlement = async (id) => (await pg.query('select * from public.billing_entitlements where account_id = $1', [id]))[0] ?? null;

let passed = 0;
async function test(name, run) { await run(); passed++; console.log(`PASS ${name}`); }

try {
  await test('1. account created before the cutoff is grandfathered', async () => {
    assert.equal((await status('before')).access, 'grandfathered');
  });

  await test('2. account created exactly at the cutoff (to the microsecond) is grandfathered', async () => {
    assert.equal((await status('exact')).access, 'grandfathered');
  });

  await test('3. account created one microsecond after the cutoff requires payment', async () => {
    const s = await status('after');
    assert.equal(s.access, 'locked');
    assert.deepEqual(s.price, { amount: 100, currency: 'usd', label: '$1.00 — One-Time Beta Unlock' });
    assert.equal((await status('buyer')).access, 'locked');
  });

  await test('4. PAYWALL_ENABLED=false (or unset) bypasses every payment gate without touching billing', async () => {
    for (const flag of [undefined, 'false', 'TRUE', '1']) {
      const off = { ...env, PAYWALL_ENABLED: flag };
      const before = openaiCalls;
      const res = await call(analyze({ env: off, clients: noDatabase }), { body: { consent: true, documents } }); // no cookie at all
      assert.equal(res.statusCode, 200, `flag ${flag}`);
      assert.equal(openaiCalls, before + 1);
      const s = await call(billing({ env: off, clients: noDatabase }), { method: 'GET' });
      assert.deepEqual([s.statusCode, s.body.paywallEnabled, s.body.access], [200, false, 'open']);
      const c = await call(billing({ env: off, clients: noDatabase }), { body: { action: 'checkout' } });
      assert.equal(c.body.unlocked, true);
    }
    assert.equal(stripeRequests.length, 0);
  });

  await test('5. grandfathered account analyzes without paying and without any Stripe call', async () => {
    const before = openaiCalls;
    const res = await read('before');
    assert.equal(res.statusCode, 200);
    assert.equal(openaiCalls, before + 1);
    assert.equal(stripeRequests.length, 0);
  });

  await test('6. new unpaid account cannot call premium analysis directly (402, model never called)', async () => {
    const before = openaiCalls;
    for (const extra of [{}, { paid: true, checkoutSessionId: 'cs_test_forged0001' }, { documents: undefined }]) {
      const res = await read('after', extra);
      assert.equal(res.statusCode, 402);
      assert.deepEqual(res.body, { code: 'beta_unlock_required', message: 'Unlock My Aid to continue.' });
    }
    const anonymous = await call(analyze(), { body: { consent: true, documents } });
    assert.equal(anonymous.statusCode, 401);
    assert.equal(openaiCalls, before);
  });

  let buyerSession;
  await test('8. successful $1 Stripe Checkout activates the entitlement via verified webhook', async () => {
    const started = await startCheckout('buyer');
    assert.match(started.url, /^https:\/\/checkout\.stripe\.com\//);
    buyerSession = sessionIdFromUrl(started.url);
    const sent = stripeRequests.at(-1);
    assert.equal(sent.url, 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(sent.headers.Authorization, 'Bearer sk_test_synthetic123');
    assert.ok(sent.headers['Idempotency-Key'].startsWith(`fynq-beta-unlock:${ids.buyer}:`));
    assert.equal(sent.params.get('mode'), 'payment');
    assert.equal(sent.params.get('line_items[0][price]'), 'price_synthetic123');
    assert.equal(sent.params.get('line_items[0][quantity]'), '1');
    assert.equal(sent.params.get('client_reference_id'), ids.buyer);
    assert.equal(sent.params.get('metadata[fynq_account_id]'), ids.buyer);
    assert.equal(sent.params.get('metadata[purpose]'), 'fynq_beta_unlock');
    assert.equal(sent.params.get('success_url'), `${ORIGIN}/beta/checkout?result=success`);
    assert.equal(sent.params.get('cancel_url'), `${ORIGIN}/beta/checkout?result=cancelled`);
    assert.ok(Number(sent.params.get('expires_at')) - Date.now() / 1000 >= 30 * 60);
    assert.equal((await status('buyer')).access, 'locked', 'creating a checkout unlocks nothing');

    // A second click reuses the open session instead of opening another charge.
    const again = await startCheckout('buyer');
    assert.equal(again.url, started.url);
    assert.equal(stripeRequests.length, 1);

    const res = await deliver(stripeEvent('checkout.session.completed', sessionFor(ids.buyer, buyerSession)), { stream: true });
    assert.equal(res.statusCode, 200);
    assert.equal((await status('buyer')).access, 'premium');
    const e = await entitlement(ids.buyer);
    assert.deepEqual([e.status, e.amount, e.currency, e.livemode, e.checkout_session_id, e.is_test_account], ['active', 100, 'usd', false, buyerSession, false]);
    const row = (await pg.query('select * from public.billing_checkouts where checkout_session_id = $1', [buyerSession]))[0];
    assert.deepEqual([row.status, row.amount_total, row.payment_intent_id !== null, row.paid_at !== null], ['paid', 100, true, true]);
  });

  await test('7. new paid account can analyze, and the post-payment funnel is recorded', async () => {
    const before = openaiCalls;
    const res = await read('buyer');
    assert.equal(res.statusCode, 200);
    assert.equal(openaiCalls, before + 1);
    const events = (await pg.query("select event_type from public.monetization_events where account_id = $1 order by created_at", [ids.buyer])).map((r) => r.event_type);
    for (const e of ['unlock_clicked', 'checkout_created', 'checkout_completed', 'payment_confirmed', 'entitlement_activated', 'analysis_started', 'analysis_completed']) assert.ok(events.includes(e), e);
  });

  await test('9. cancelled Checkout unlocks nothing', async () => {
    const started = await startCheckout('canceller');
    const id = sessionIdFromUrl(started.url);
    // Returning to the cancel URL is just a page; the server only ever sees this:
    assert.equal((await status('canceller')).access, 'locked');
    assert.equal((await deliver(stripeEvent('checkout.session.expired', sessionFor(ids.canceller, id, { payment_status: 'unpaid', status: 'expired' })))).statusCode, 200);
    assert.equal((await pg.query('select status from public.billing_checkouts where checkout_session_id = $1', [id]))[0].status, 'expired');
    assert.equal(await entitlement(ids.canceller), null);
    assert.equal((await read('canceller')).statusCode, 402);
  });

  await test('10. declined or failed payment unlocks nothing', async () => {
    const started = await startCheckout('decliner');
    const id = sessionIdFromUrl(started.url);
    await deliver(stripeEvent('checkout.session.completed', sessionFor(ids.decliner, id, { payment_status: 'unpaid' })));
    assert.equal((await pg.query('select status from public.billing_checkouts where checkout_session_id = $1', [id]))[0].status, 'completed_unpaid');
    await deliver(stripeEvent('checkout.session.async_payment_failed', sessionFor(ids.decliner, id, { payment_status: 'unpaid' })));
    assert.equal((await pg.query('select status from public.billing_checkouts where checkout_session_id = $1', [id]))[0].status, 'failed');
    // A "paid" event with the wrong amount is not a $1 unlock either.
    await deliver(stripeEvent('checkout.session.async_payment_succeeded', sessionFor(ids.decliner, id, { amount_total: 1 })));
    assert.equal(await entitlement(ids.decliner), null);
    assert.equal((await status('decliner')).access, 'locked');
  });

  await test('11. duplicate webhook delivery is processed exactly once', async () => {
    const started = await startCheckout('other');
    const id = sessionIdFromUrl(started.url);
    const event = stripeEvent('checkout.session.completed', sessionFor(ids.other, id));
    const first = await deliver(event);
    const second = await deliver(event);
    assert.deepEqual([first.body.duplicate, second.body.duplicate], [false, true]);
    // A different event for the same paid session also changes nothing.
    await deliver(stripeEvent('checkout.session.async_payment_succeeded', sessionFor(ids.other, id)));
    const count = async (type) => (await pg.query('select count(*)::int n from public.monetization_events where account_id = $1 and event_type = $2', [ids.other, type]))[0].n;
    assert.equal(await count('payment_confirmed'), 1);
    assert.equal(await count('entitlement_activated'), 1);
    assert.equal((await pg.query('select count(*)::int n from public.billing_entitlements where account_id = $1', [ids.other]))[0].n, 1);
  });

  await test('12. a forged success URL, forged client claims or forged signatures unlock nothing', async () => {
    // The success page is client-side and never grants anything: the server only answers from the database.
    assert.equal((await status('after')).access, 'locked');
    await clearRates();
    const forged = await call(billing(), { body: { action: 'checkout', paid: true, session_id: buyerSession, account_id: ids.buyer }, cookie: cookies.after });
    assert.ok(forged.body.url && !forged.body.unlocked, 'body claims are ignored');
    assert.equal(stripeRequests.at(-1).params.get('client_reference_id'), ids.after, 'account comes from the cookie, not the body');
    assert.equal((await read('after', { paid: true, sessionId: buyerSession })).statusCode, 402);
    const afterSession = sessionIdFromUrl(forged.body.url);
    const event = stripeEvent('checkout.session.completed', sessionFor(ids.after, afterSession));
    assert.equal((await deliver(event, { secret: 'whsec_attacker_guess' })).statusCode, 400);
    const unsigned = response();
    await webhook()({ method: 'POST', body: JSON.stringify(event), headers: {} }, unsigned);
    assert.equal(unsigned.statusCode, 400);
    const stale = JSON.stringify(event);
    const old = response();
    await webhook()({ method: 'POST', body: stale, headers: { 'stripe-signature': signStripePayload(stale, WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 3600) } }, old);
    assert.equal(old.statusCode, 400, 'replayed old signatures are refused');
    const tampered = response();
    await webhook()({ method: 'POST', body: stale.replace('"usd"', '"eur"'), headers: { 'stripe-signature': signStripePayload(stale, WEBHOOK_SECRET) } }, tampered);
    assert.equal(tampered.statusCode, 400, 'a body changed after signing is refused');
    const parsed = response();
    await webhook()({ method: 'POST', body: event, headers: { 'stripe-signature': signStripePayload(stale, WEBHOOK_SECRET) } }, parsed);
    assert.equal(parsed.statusCode, 400, 'a pre-parsed body cannot be verified and fails closed');
    assert.equal(await entitlement(ids.after), null);
    assert.equal((await status('after')).access, 'locked');
  });

  await test('13. a Stripe session belonging to another account cannot unlock this account', async () => {
    const afterSession = (await pg.query("select checkout_session_id from public.billing_checkouts where account_id = $1 and status = 'open'", [ids.after]))[0].checkout_session_id;
    // Correctly signed, but claims the session of 'after' belongs to 'canceller'.
    const stolen = await deliver(stripeEvent('checkout.session.completed', sessionFor(ids.canceller, afterSession)));
    assert.equal(stolen.statusCode, 200);
    const mixed = await deliver(stripeEvent('checkout.session.completed', sessionFor(ids.after, afterSession, { client_reference_id: ids.canceller })));
    assert.equal(mixed.statusCode, 200);
    const unknown = await deliver(stripeEvent('checkout.session.completed', sessionFor(ids.canceller, 'cs_test_notcreatedbyfynq01')));
    assert.equal(unknown.statusCode, 200);
    const outcomes = (await pg.query("select outcome from public.billing_stripe_events order by received_at desc limit 3")).map((r) => r.outcome).sort();
    assert.deepEqual(outcomes, ['ownership_mismatch', 'ownership_mismatch', 'unknown_session']);
    assert.equal(await entitlement(ids.canceller), null);
    assert.equal(await entitlement(ids.after), null);
    // Someone else's paid session id in a request body is ignored too.
    assert.equal((await read('canceller', { checkoutSessionId: buyerSession })).statusCode, 402);
  });

  await test('14. a returning paid user never pays twice', async () => {
    const before = stripeRequests.length;
    await clearRates();
    const res = await call(billing(), { body: { action: 'checkout' }, cookie: cookies.buyer });
    assert.deepEqual(res.body, { access: 'premium', unlocked: true });
    assert.equal(stripeRequests.length, before);
    // Even if a second payment somehow completes, it is flagged for refund review, not a second entitlement.
    await pg.exec(`insert into public.billing_checkouts(checkout_session_id, account_id, livemode, expires_at) values ('cs_test_secondpayment01', '${ids.buyer}', false, now() + interval '30 minutes')`);
    await deliver(stripeEvent('checkout.session.completed', sessionFor(ids.buyer, 'cs_test_secondpayment01')));
    const row = (await pg.query("select duplicate_payment from public.billing_checkouts where checkout_session_id = 'cs_test_secondpayment01'"))[0];
    assert.equal(row.duplicate_payment, true);
    assert.equal((await entitlement(ids.buyer)).checkout_session_id, buyerSession);
    assert.equal((await read('buyer')).statusCode, 200);
  });

  await test('15. an existing (grandfathered) user never sees the paywall', async () => {
    const before = stripeRequests.length;
    await clearRates();
    for (const who of ['before', 'exact']) {
      assert.deepEqual((await call(billing(), { body: { action: 'checkout' }, cookie: cookies[who] })).body, { access: 'grandfathered', unlocked: true });
      await call(billing(), { body: { action: 'track', event: 'paywall_viewed' }, cookie: cookies[who] });
      assert.equal((await read(who)).statusCode, 200);
    }
    assert.equal(stripeRequests.length, before);
    assert.equal((await pg.query('select count(*)::int n from public.monetization_events where account_id = any($1::uuid[])', [[ids.before, ids.exact]]))[0].n, 0, 'grandfathered accounts are not in the paywall funnel');
  });

  await test('16. raw aid files and aid content are never sent to Stripe', async () => {
    assert.ok(stripeRequests.length > 0);
    for (const r of stripeRequests) {
      const decoded = decodeURIComponent(r.body);
      for (const needle of [MARKER, 'Pell', 'Jordan', '3,698', '123-45-6789', '.png', 'pages', 'documents']) assert.ok(!decoded.includes(needle), needle);
      const keys = [...r.params.keys()].sort();
      assert.deepEqual(keys, ['cancel_url', 'client_reference_id', 'customer_email', 'expires_at', 'line_items[0][price]', 'line_items[0][quantity]', 'metadata[fynq_account_id]', 'metadata[purpose]', 'mode', 'payment_intent_data[description]', 'payment_intent_data[metadata][fynq_account_id]', 'payment_intent_data[metadata][purpose]', 'submit_type', 'success_url']);
    }
    // A checkout request carrying documents or files does not forward them.
    await clearRates();
    const before = stripeRequests.length;
    await call(billing(), { body: { action: 'checkout', documents, files: [{ data: 'JVBERi0=' }] }, cookie: cookies.decliner });
    assert.equal(stripeRequests.length, before + 1);
    assert.ok(!decodeURIComponent(stripeRequests.at(-1).body).includes(MARKER));
    assert.ok(!decodeURIComponent(stripeRequests.at(-1).body).includes('JVBERi0'));
  });

  await test('17. raw aid files are never persisted; no aid content is stored anywhere in billing', async () => {
    await clearRates();
    // The unlock happens before any document is chosen, so there is no store for documents at all.
    assert.equal((await call(billing(), { body: { action: 'pending-save', consent: true, documents }, cookie: cookies.decliner })).statusCode, 400);
    const tables = (await pg.query("select tablename from pg_tables where schemaname = 'public' and tablename like 'billing%' order by 1")).map((r) => r.tablename);
    assert.deepEqual(tables, ['billing_checkouts', 'billing_entitlements', 'billing_stripe_events']);
    // Pay, then analyze: the reader still refuses file bytes, and nothing readable is kept.
    const started = await startCheckout('decliner');
    await deliver(stripeEvent('checkout.session.completed', sessionFor(ids.decliner, sessionIdFromUrl(started.url))));
    assert.equal((await read('decliner', { files: [{ name: 'a.pdf', data: 'JVBERi0=' }] })).statusCode, 400);
    assert.equal((await read('decliner')).statusCode, 200);
    for (const table of [...tables, 'monetization_events', 'upload_events']) {
      const dump = JSON.stringify(await pg.query(`select * from public.${table}`));
      for (const needle of [MARKER, 'Pell', 'Jordan', 'Testcase', '123-45-6789', '3,698', '.png', 'JVBERi0']) assert.ok(!dump.includes(needle), `${needle} in ${table}`);
    }
  });

  await test('18. admin/test accounts bypass payment and are excluded from revenue and conversion', async () => {
    await clearRates();
    assert.equal((await status('tester')).access, 'test_account');
    assert.deepEqual((await call(billing(), { body: { action: 'checkout' }, cookie: cookies.tester })).body, { access: 'test_account', unlocked: true });
    assert.equal((await read('tester')).statusCode, 200);
    // A test account that paid anyway (e.g. while trying Checkout) never counts.
    await pg.exec(`insert into public.billing_checkouts(checkout_session_id, account_id, livemode, expires_at) values ('cs_test_testerpayment01', '${ids.tester}', false, now() + interval '30 minutes')`);
    await deliver(stripeEvent('checkout.session.completed', sessionFor(ids.tester, 'cs_test_testerpayment01')));
    assert.equal((await entitlement(ids.tester)).is_test_account, true);

    const metrics = (await db.rpc('billing_metrics', { p_cutoff: DEFAULT_GRANDFATHER_CUTOFF, p_test: [ids.tester] })).data;
    assert.equal(metrics.grandfathered_accounts, 2);
    assert.equal(metrics.live.paid_accounts, 0, 'Stripe test-mode payments are never production revenue');
    assert.equal(metrics.live.gross_revenue_cents, 0);
    const t = metrics.test_mode;
    assert.equal(t.paid_accounts, 3, 'buyer, other and decliner; not the tester');
    assert.equal(t.payments, 4, 'includes the flagged duplicate');
    assert.equal(t.duplicate_payments, 1);
    assert.equal(t.gross_revenue_cents, 400);
    assert.equal(t.checkout_to_paid_rate, Number((3 / t.checkout_starts).toFixed(4)));
    // Removing the flag in the database does not sneak it back in while the account is still configured as a test account.
    await pg.exec(`update public.billing_entitlements set is_test_account = false where account_id = '${ids.tester}'`);
    await pg.exec(`update public.billing_checkouts set is_test_account = false where account_id = '${ids.tester}'`);
    const again = (await db.rpc('billing_metrics', { p_cutoff: DEFAULT_GRANDFATHER_CUTOFF, p_test: [ids.tester] })).data;
    assert.equal(again.test_mode.paid_accounts, 3);
    assert.equal(again.test_mode.gross_revenue_cents, 400);
  });

  await test('19. existing upload telemetry still records every read, unchanged', async () => {
    setUploadTracker((req, data) => recordUpload(req, data, { env, clients: () => ({ db }) }));
    try {
      const before = (await db.rpc('upload_metrics')).data.total_uploads;
      assert.equal((await read('buyer')).statusCode, 200);
      const m = (await db.rpc('upload_metrics')).data;
      assert.equal(m.total_uploads, before + 1);
      assert.equal(m.recent[0].email, 'buyer@example.test');
      assert.equal(m.recent[0].outcome, 'read');
      const b = (await db.rpc('billing_metrics', { p_cutoff: DEFAULT_GRANDFATHER_CUTOFF, p_test: [ids.tester] })).data;
      assert.equal(b.test_mode.paid_user_upload_batches, 1);
      assert.equal(b.test_mode.paid_user_files, 1);
      assert.equal(b.test_mode.paid_user_uploaders, 1);
    } finally { setUploadTracker(recordUpload); }
  });

  await test('20. Ask Fynliq is covered by the $1 unlock, and admin metrics include the billing block', async () => {
    const login = createAuthHandler({ env, clients: () => ({ db, auth: {} }) });
    const guest = await call(login, { body: { action: 'guest' } });
    const guestCookie = guest.headers['Set-Cookie'].split(';')[0];
    const ask = createAskHandler({ env, clients: () => ({ db, auth: {} }), answer: async () => ({ status: 200, body: { paragraphs: ['ok'], basis: 'general', grounding: [], missing: null, relatedIds: [] } }) });
    await clearRates();
    const lockedAsk = await call(ask, { body: { question: 'What is a Pell Grant?' }, cookie: `${guestCookie}; ${cookies.after}` });
    assert.equal(lockedAsk.statusCode, 402);
    assert.equal(lockedAsk.body.code, 'beta_unlock_required');
    await clearRates();
    assert.equal((await call(ask, { body: { question: 'What is a Pell Grant?' }, cookie: `${guestCookie}; ${cookies.buyer}` })).statusCode, 200);

    await pg.exec("insert into public.beta_invites(email, user_id) values ('admin@example.test', '30000000-0000-4000-8000-000000000001')");
    const token = randomBytes(32).toString('hex');
    await pg.exec(`insert into public.beta_sessions(token_hash, user_id, kind, expires_at) values ('${createHash('sha256').update(token).digest('hex')}', '30000000-0000-4000-8000-000000000001', 'admin', now() + interval '1 hour')`);
    const admin = createAdminHandler({ env: { ...env, BETA_ADMIN_USER_IDS: '30000000-0000-4000-8000-000000000001' }, clients: () => ({ db }) });
    const res = await call(admin, { method: 'GET', cookie: `__Host-fynliq_admin=${token}` });
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.uploads && res.body.accounts && res.body.billing);
    assert.equal(res.body.billing.paywall_enabled, true);
    assert.equal(res.body.billing.stripe_livemode, false);
    for (const key of ['paywall_views', 'checkout_starts', 'paid_accounts', 'paywall_to_checkout_rate', 'checkout_to_paid_rate', 'paywall_to_paid_rate', 'gross_revenue_cents', 'paid_user_upload_batches', 'paid_user_completed_questions']) assert.ok(key in res.body.billing.live, key);
  });

  await test('funnel: client-reported steps are recorded only for post-cutoff accounts, and only known steps', async () => {
    await clearRates();
    for (const event of ['my_aid_entered', 'preflight_completed', 'paywall_viewed']) {
      assert.equal((await call(billing(), { body: { action: 'track', event }, cookie: cookies.after })).statusCode, 200);
    }
    assert.equal((await call(billing(), { body: { action: 'track', event: 'payment_confirmed' }, cookie: cookies.after })).statusCode, 400);
    // A paid post-cutoff account's first document check comes after the unlock, so it counts too.
    await call(billing(), { body: { action: 'track', event: 'preflight_completed' }, cookie: cookies.buyer });
    const rows = await pg.query('select account_id, event_type from public.monetization_events where event_type in ($1, $2, $3)', ['my_aid_entered', 'preflight_completed', 'paywall_viewed']);
    assert.equal(rows.length, 4);
    assert.equal(rows.filter((r) => r.account_id === ids.after).length, 3);
    assert.ok(rows.every((r) => r.account_id === ids.after || r.account_id === ids.buyer));
    const m = (await db.rpc('billing_metrics', { p_cutoff: DEFAULT_GRANDFATHER_CUTOFF, p_test: [ids.tester] })).data.test_mode;
    assert.deepEqual([m.my_aid_entered_accounts, m.preflight_completed_accounts, m.paywall_views, m.paywall_viewers], [1, 2, 1, 1]);
  });

  await test('pilot: PAYWALL_PILOT_EMAILS gates only the listed accounts; everyone else is untouched', async () => {
    const pilotEnv = { ...env, PAYWALL_PILOT_EMAILS: ' After@Example.test ' };
    const pb = (o) => billing({ env: pilotEnv, ...o });
    const pa = (o) => analyze({ env: pilotEnv, ...o });
    assert.equal((await call(pb(), { method: 'GET', cookie: cookies.after })).body.access, 'locked');
    for (const who of ['canceller', 'decliner', 'before']) {
      const s = (await call(pb(), { method: 'GET', cookie: cookies[who] })).body;
      assert.deepEqual([s.paywallEnabled, s.access], [false, 'open'], who);
    }
    assert.equal((await call(pa(), { body: { consent: true, documents }, cookie: cookies.after })).statusCode, 402);
    const before = openaiCalls;
    assert.equal((await call(pa(), { body: { consent: true, documents }, cookie: cookies.canceller })).statusCode, 200, 'unpaid post-cutoff account outside the pilot is not gated');
    assert.equal((await call(pa(), { body: { consent: true, documents } })).statusCode, 200, 'not signed in: unchanged');
    assert.equal((await call(pa({ clients: noDatabase }), { body: { consent: true, documents }, cookie: cookies.canceller })).statusCode, 200, 'database trouble never blocks non-pilot users');
    assert.equal(openaiCalls, before + 3);
    await clearRates();
    const c = await call(pb(), { body: { action: 'checkout' }, cookie: cookies.canceller });
    assert.equal(c.body.unlocked, true);
  });

  await test('safety: live Stripe keys are refused unless explicitly allowed; cross-origin requests are refused', async () => {
    await clearRates();
    const live = await call(billing({ env: { ...env, STRIPE_SECRET_KEY: 'sk_live_synthetic123' } }), { body: { action: 'checkout' }, cookie: cookies.canceller });
    assert.equal(live.statusCode, 503);
    const cross = await call(billing(), { body: { action: 'checkout' }, cookie: cookies.canceller, headers: { origin: 'https://evil.example' } });
    assert.equal(cross.statusCode, 403);
    const badCutoff = await call(billing({ env: { ...env, FYNQ_BETA_GRANDFATHER_CUTOFF: 'yesterday' } }), { method: 'GET', cookie: cookies.before });
    assert.equal(badCutoff.statusCode, 503, 'a malformed cutoff fails closed instead of guessing');
    assert.equal((await call(billing(), { method: 'GET' })).statusCode, 401);
  });

  await test('safety: browsers cannot read or write billing tables or call billing functions', async () => {
    for (const role of ['anon', 'authenticated']) {
      for (const sql of [
        'select * from public.billing_entitlements', 'select * from public.billing_checkouts',
        'select * from public.monetization_events', 'select * from public.billing_stripe_events',
        `insert into public.billing_entitlements(account_id, checkout_session_id, amount, currency, livemode, paid_at) values ('${ids.after}', 'cs_test_x', 0, 'usd', false, now())`,
        `select public.billing_access('${ids.after}', now())`, `select public.billing_metrics(now(), '{}')`,
        "select public.billing_stripe_event('evt_x1234567', 'checkout.session.completed', false, 'cs_test_x', null, null, 'paid', 100, 'usd', null, null, 100, 'usd', false)",
      ]) {
        await assert.rejects(pg.exec(`set role ${role}; ${sql}; reset role;`), `${role}: ${sql}`);
        await pg.exec('reset role');
      }
    }
  });

  await test('webhook signature helper matches Stripe\'s documented scheme', async () => {
    const payload = '{"id":"evt_doc123456","type":"x"}';
    const header = signStripePayload(payload, WEBHOOK_SECRET, 1700000000);
    assert.equal(verifyStripeEvent(payload, header, WEBHOOK_SECRET, { now: 1700000000 * 1000 }).id, 'evt_doc123456');
    assert.throws(() => verifyStripeEvent(payload, header, WEBHOOK_SECRET, { now: 1700000400 * 1000 }));
  });

  console.log(`RESULT ${passed} passed (${pg.kind}); synthetic data only; no network calls; ${rpcCalls} database calls.`);
} finally {
  await pg.close();
}
