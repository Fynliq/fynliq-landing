// Phase 2 observability, end to end against a real Postgres running every
// migration (PGlite), with fake Supabase Auth and fake Stripe. Synthetic data
// only; no network calls.
//
//   node test/observability-integration.mjs
//
// Covers: event de-duplication, the site working when analytics is down,
// payment and failed-payment events from the verified webhook only,
// anonymous -> logged-in identity joining, the browser event endpoint's
// limits, the API request log, and the read-only safety of the ops_* layer.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createAuthHandler } from '../api/beta-auth.js';
import { createActivityHandler } from '../api/activity.js';
import { createBillingHandler } from '../api/billing.js';
import { createStripeWebhookHandler } from '../api/stripe-webhook.js';
import { createAdminHandler } from '../api/beta-admin.js';
import { createAccountHandler } from '../server/account-login.js';
import { buildEvent, recordEvents, track } from '../server/analytics.js';
import { observe } from '../server/observability.js';
import { signStripePayload } from '../server/stripe.js';
import { DEFAULT_GRANDFATHER_CUTOFF } from '../server/billing.js';

// ------------------------------------------------------------ database

const migrations = (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter((f) => f.endsWith('.sql')).sort();
function literal(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  return `'${String(value).replace(/'/g, "''")}'`;
}
const { PGlite } = await import('@electric-sql/pglite');
const pg = new PGlite();
await pg.exec('create role anon; create role authenticated; create role service_role bypassrls;');
for (const file of migrations) await pg.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
await pg.exec('grant usage on schema public to anon, authenticated, service_role');
const rows = async (sql) => JSON.parse(JSON.stringify((await pg.query(sql)).rows));
const one = async (sql) => (await rows(sql))[0] ?? null;

let readOnlyCalls = 0;
const db = {
  // A GET rpc (rpcRead) runs inside a READ ONLY transaction, as PostgREST does.
  async rpc(name, args = {}, options = {}) {
    const call = `select public.${name}(${Object.entries(args).map(([k, v]) => `${k} => ${literal(v)}`).join(', ')}) as value`;
    try {
      if (options.get) {
        readOnlyCalls++;
        await pg.exec('begin transaction read only');
        try {
          const r = await pg.query(call);
          await pg.exec('commit');
          return { data: JSON.parse(JSON.stringify(r.rows[0]?.value ?? null)), error: null };
        } catch (e) { await pg.exec('rollback'); throw e; }
      }
      const r = await pg.query(call);
      return { data: JSON.parse(JSON.stringify(r.rows[0]?.value ?? null)), error: null };
    } catch (error) { return { data: null, error: { message: String(error?.message || error) } }; }
  },
  auth: { admin: { createUser: async ({ email }) => ({ data: { user: { id: randomUUID(), email } }, error: null }) } },
};
const auth = { auth: { signInWithPassword: async ({ email, password }) => {
  const row = await one(`select user_id from public.accounts where email = ${literal(email)}`);
  return password === 'correct-horse-battery' && row ? { data: { user: { id: row.user_id, email } }, error: null } : { data: null, error: { message: 'bad' } };
} } };

// ------------------------------------------------------------- fixtures

const ORIGIN = 'https://www.fynliq.test';
const WEBHOOK_SECRET = 'whsec_synthetic_test_secret';
const TESTER = '20000000-0000-4000-8000-0000000000ff';
const env = {
  BETA_ENABLED: 'true', BETA_ORIGIN: ORIGIN, BETA_RATE_SECRET: 'synthetic-rate-secret-at-least-32-chars',
  PAYWALL_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test_synthetic123', STRIPE_PRICE_ID: 'price_synthetic123',
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, FYNQ_BETA_GRANDFATHER_CUTOFF: DEFAULT_GRANDFATHER_CUTOFF,
  FYNQ_BILLING_TEST_ACCOUNT_IDS: TESTER,
  OPS_READ_TOKEN_SHA256: createHash('sha256').update('ops_read_token_synthetic_0123456789abcdef').digest('hex'),
};
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_36.0';
let ip = 0;
function response() {
  return { statusCode: 200, headers: {}, body: undefined, headersSent: false,
    setHeader(k, v) { this.headers[k] = v; }, getHeader(k) { return this.headers[k]; },
    status(n) { this.statusCode = n; return this; }, send(v) { this.body = v; this.headersSent = true; return this; }, json(v) { this.body = v; this.headersSent = true; return this; } };
}
async function call(handler, { method = 'POST', body, cookie = '', headers = {}, url = '/api/x' } = {}) {
  const res = response();
  await handler({ method, url, body, headers: { 'content-type': 'application/json', origin: ORIGIN, 'user-agent': IPHONE, cookie, ...headers },
    socket: { remoteAddress: `198.51.100.${(++ip % 250) + 1}` } }, res);
  return res;
}
/** "name=value" from a Set-Cookie header, if it sets that cookie. */
function cookieOf(res, name) {
  const pair = /^([^=;\s]+=[^;]*)/.exec(String(res.headers['Set-Cookie'] || ''))?.[1] ?? null;
  return pair && pair.startsWith(`${name}=`) ? pair : null;
}
const deps = (extra = {}) => ({ env, clients: () => ({ db, auth }), ...extra });
const events = (name) => rows(`select * from public.analytics_events where event_name = '${name}' order by occurred_at`);
const clearRates = () => pg.exec('delete from public.beta_rate_windows');

let passed = 0;
async function test(name, run) { await run(); passed++; console.log(`PASS ${name}`); }

try {
  // ------------------------------------------------------------ identity
  let guestCookie, guestId, accountCookie, accountId;

  await test('first visit: a guest session records one landing_view with attribution, device and browser', async () => {
    const res = await call(createAuthHandler(deps()), { body: { action: 'guest', touch: { utm: { source: 'tiktok', medium: 'social', campaign: 'oct', content: 'video_07' }, landing: '/', clickIds: { ttclid: true } } } });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    guestCookie = cookieOf(res, '__Host-fynliq_beta');
    guestId = res.body.user.id;
    const [landing] = await events('landing_view');
    assert.equal(landing.anonymous_session_id, guestId);
    assert.equal(landing.user_id, null);
    assert.equal(landing.channel, 'tiktok');
    assert.equal(landing.campaign, 'oct');
    assert.equal(landing.content, 'video_07');
    assert.equal(landing.device_type, 'mobile');
    assert.equal(landing.browser, 'tiktok');
    assert.equal((await events('return_session')).length, 0, 'a first visit is not a return');
  });

  await test('duplicates: the same browser landing again the same day is still one landing_view', async () => {
    for (let i = 0; i < 3; i++) await call(createAuthHandler(deps()), { body: { action: 'guest', touch: { landing: '/' } }, cookie: guestCookie });
    assert.equal((await events('landing_view')).length, 1);
  });

  await test('duplicates: a retried event_id is stored once', async () => {
    const id = randomUUID();
    const ev = buildEvent('upload_started', { guestId, eventId: id, side: 'client' });
    assert.equal(await recordEvents(db, [ev]), 1);
    assert.equal(await recordEvents(db, [ev]), 0);
    assert.equal((await rows(`select 1 from public.analytics_events where event_id = '${id}'`)).length, 1);
  });

  await test('anonymous -> signed up: signup_completed joins the guest browser to the account', async () => {
    await clearRates();
    const res = await call(createAccountHandler('signup', deps()), { body: { email: 'student@example.test', password: 'correct-horse-battery' }, cookie: guestCookie });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    accountCookie = cookieOf(res, '__Host-fynliq_account');
    accountId = (await one(`select user_id from public.accounts where email = 'student@example.test'`)).user_id;
    const [signup] = await events('signup_completed');
    assert.equal(signup.user_id, accountId);
    assert.equal(signup.anonymous_session_id, guestId);
    assert.equal(signup.channel, 'tiktok', 'attribution follows the person');
    const text = JSON.stringify(await rows('select * from public.analytics_events'));
    assert.ok(!text.includes('student@example.test'), 'no email in analytics');
    // The funnel counts the guest visitor and the new account as ONE person.
    const funnel = (await db.rpc('ops_funnel', { p_since: '2000-01-01T00:00:00Z', p_until: '2100-01-01T00:00:00Z', p_segment: 'none', p_test: '' }, { get: true })).data;
    assert.equal(funnel.rows[0].visitors, 1);
    assert.equal(funnel.rows[0].signups, 1);
  });

  await test('duplicates: signup_completed can only happen once per account', async () => {
    assert.equal(await recordEvents(db, [buildEvent('signup_completed', { userId: accountId })]), 0);
    assert.equal((await events('signup_completed')).length, 1);
  });

  await test('login: a failed log-in is counted without any email or account id; a good one is login_completed', async () => {
    await clearRates();
    const bad = await call(createAccountHandler('login', deps()), { body: { email: 'student@example.test', password: 'wrong-password-123' }, cookie: guestCookie });
    assert.equal(bad.statusCode, 401);
    const [failed] = await events('login_failed');
    assert.equal(failed.user_id, null);
    assert.equal(failed.metadata.reason, 'credentials');
    assert.ok(!JSON.stringify(failed).includes('student@'));
    const good = await call(createAccountHandler('login', deps()), { body: { email: 'student@example.test', password: 'correct-horse-battery' }, cookie: guestCookie });
    assert.equal(good.statusCode, 200);
    assert.equal((await events('login_completed'))[0].user_id, accountId);
  });

  await test('return_session: only for a person seen on an EARLIER day, once per day', async () => {
    await call(createAccountHandler('session', deps()), { method: 'GET', cookie: `${accountCookie}; ${guestCookie}` });
    assert.equal((await events('return_session')).length, 0, 'same-day visit is not a return');
    await pg.exec(`update public.analytics_events set occurred_at = now() - interval '2 days' where event_name = 'landing_view'`);
    await call(createAccountHandler('session', deps()), { method: 'GET', cookie: `${accountCookie}; ${guestCookie}` });
    await call(createAccountHandler('session', deps()), { method: 'GET', cookie: `${accountCookie}; ${guestCookie}` });
    assert.equal((await events('return_session')).length, 1);
  });

  // ------------------------------------------------------- browser events
  await test('browser events: allow-listed names only, identity from cookies, metadata scrubbed', async () => {
    await clearRates();
    const forged = '30000000-0000-4000-8000-000000000001';
    const res = await call(createActivityHandler(deps()), { cookie: `${accountCookie}; ${guestCookie}`, body: { events: [
      { id: randomUUID(), name: 'my_aid_viewed' },
      { id: randomUUID(), name: 'results_viewed', metadata: { view: 'preview', email: 'x@y.z', text: 'Pell $3,698' } },
      { id: randomUUID(), name: 'payment_completed' },
      { id: randomUUID(), name: 'signup_completed' },
      { id: randomUUID(), name: 'upload_started', user_id: forged, userId: forged },
    ] } });
    assert.equal(res.statusCode, 200);
    assert.equal((await events('payment_completed')).length, 0, 'the browser can never report a payment');
    assert.equal((await events('signup_completed')).length, 1, 'the browser can never report a sign-up');
    const [viewed] = await events('results_viewed');
    assert.deepEqual(viewed.metadata, { view: 'preview' });
    assert.equal(viewed.user_id, accountId);
    assert.equal((await rows(`select 1 from public.analytics_events where user_id = '${forged}'`)).length, 0, 'body identity is ignored');
    const all = JSON.stringify(await rows('select * from public.analytics_events'));
    for (const needle of ['x@y.z', 'Pell', '3,698']) assert.ok(!all.includes(needle), `${needle} reached analytics`);
  });

  await test('browser events: cross-origin and oversized requests are refused, and the endpoint is rate limited', async () => {
    const cross = await call(createActivityHandler(deps()), { headers: { origin: 'https://evil.example' }, body: { events: [{ id: randomUUID(), name: 'my_aid_viewed' }] } });
    assert.equal(cross.statusCode, 403);
    const big = await call(createActivityHandler(deps()), { body: { events: [{ id: randomUUID(), name: 'client_error', metadata: { pad: 'x'.repeat(5000) } }] } });
    assert.equal(big.statusCode, 413);
    await clearRates();
    let limited = 0;
    for (let i = 0; i < 125; i++) {
      // VERCEL=1 makes the limiter key on x-vercel-forwarded-for, as in production.
      const r = await call(createActivityHandler(deps({ env: { ...env, VERCEL: '1' } })), { headers: { 'x-vercel-forwarded-for': '203.0.113.9' }, body: { events: [] } });
      if (r.statusCode === 429) limited++;
    }
    assert.ok(limited >= 1, 'rate limit applies');
  });

  // ------------------------------------------------------ payment events
  const deliver = async (event) => {
    const payload = JSON.stringify(event);
    const res = response();
    await createStripeWebhookHandler(deps())({ method: 'POST', body: payload, headers: { 'stripe-signature': signStripePayload(payload, WEBHOOK_SECRET) } }, res);
    return res;
  };
  let evtN = 0;
  const stripeEvent = (type, session) => ({ id: `evt_obs${String(++evtN).padStart(6, '0')}`, object: 'event', type, livemode: false,
    data: { object: { object: 'checkout.session', mode: 'payment', client_reference_id: session.account, metadata: { fynq_account_id: session.account, purpose: 'fynq_beta_unlock' },
      payment_status: 'paid', status: 'complete', amount_total: 100, currency: 'usd', payment_intent: `pi_obs${evtN}xxxxxx`, customer: 'cus_obs00001', ...session, account: undefined } } });
  let sessionN = 0;
  const stripeFetch = async () => { const id = `cs_test_obs${String(++sessionN).padStart(6, '0')}`; return { ok: true, status: 200, json: async () => ({ id, object: 'checkout.session', url: `https://checkout.stripe.com/c/pay/${id}`, livemode: false }) }; };
  let checkoutId;

  await test('checkout_started: once per Stripe session; a reused session is not a second start', async () => {
    await clearRates();
    const first = await call(createBillingHandler(deps({ fetchImpl: stripeFetch })), { body: { action: 'checkout' }, cookie: accountCookie });
    assert.equal(first.statusCode, 200, JSON.stringify(first.body));
    checkoutId = first.body.url.split('/').pop();
    await call(createBillingHandler(deps({ fetchImpl: stripeFetch })), { body: { action: 'checkout' }, cookie: accountCookie });
    const started = await events('checkout_started');
    assert.equal(started.length, 1);
    assert.equal(started[0].livemode, false);
    assert.equal(started[0].user_id, accountId);
  });

  await test('payment success: only the verified webhook records payment_completed + unlock_verified, once', async () => {
    const event = stripeEvent('checkout.session.completed', { id: checkoutId, account: accountId });
    assert.equal((await deliver(event)).statusCode, 200);
    assert.equal((await deliver(event)).statusCode, 200, 'duplicate delivery is fine');
    assert.equal((await events('payment_completed')).length, 1);
    assert.equal((await events('unlock_verified')).length, 1);
    const forged = response();
    await createStripeWebhookHandler(deps())({ method: 'POST', body: JSON.stringify(event), headers: { 'stripe-signature': signStripePayload(JSON.stringify(event), 'whsec_wrong') } }, forged);
    assert.equal(forged.statusCode, 400);
    assert.equal((await events('payment_completed')).length, 1, 'a forged webhook records nothing');
  });

  await test('payment failure and expiry are recorded from the webhook, and the account stays locked', async () => {
    await clearRates();
    const other = randomUUID();
    await pg.exec(`insert into public.accounts(user_id, email, created_at) values ('${other}', 'other@example.test', now())`);
    const token = randomBytes(32).toString('hex');
    await db.rpc('account_start_session', { p_user: other, p_email: 'other@example.test', p_hash: createHash('sha256').update(token).digest('hex'), p_guest: null });
    const cookie = `__Host-fynliq_account=${token}`;
    const start = await call(createBillingHandler(deps({ fetchImpl: stripeFetch })), { body: { action: 'checkout' }, cookie });
    const id = start.body.url.split('/').pop();
    await deliver(stripeEvent('checkout.session.async_payment_failed', { id, account: other, payment_status: 'unpaid' }));
    assert.equal((await events('payment_failed')).filter((e) => e.user_id === other).length, 1);
    const status = await call(createBillingHandler(deps()), { method: 'GET', cookie });
    assert.equal(status.body.access, 'locked');
    assert.equal((await events('unlock_verified')).filter((e) => e.user_id === other).length, 0);
  });

  // ---------------------------------------------------- analytics outage
  await test('analytics down: a failing or hanging analytics store never breaks or stalls the request', async () => {
    const broken = { ...db, rpc: async (name, args, opts) => (name === 'analytics_record' ? { data: null, error: { message: 'down' } } : db.rpc(name, args, opts)) };
    const hanging = { ...db, rpc: (name, args, opts) => (name === 'analytics_record' ? new Promise(() => {}) : db.rpc(name, args, opts)) };
    for (const store of [broken, hanging]) {
      const started = Date.now();
      const res = await call(createAuthHandler({ env, clients: () => ({ db: store, auth }) }), { body: { action: 'guest', touch: { landing: '/' } } });
      assert.equal(res.statusCode, 200);
      assert.ok(Date.now() - started < 4000, 'bounded wait');
    }
    assert.equal(await recordEvents(null, [buildEvent('landing_view', { guestId })]), 0);
    assert.equal(await track({ headers: {} }, 'landing_view', {}, { env: {}, clients: () => { throw new Error('no config'); } }), 0);
  });

  // --------------------------------------------------- API request health
  await test('observe(): every API call is logged with route, status and duration; crashes become a safe 500', async () => {
    const before = (await one('select count(*)::int n from public.api_requests')).n;
    const ok = observe('/api/test-ok', async (_req, res) => res.status(204).send(''), { env, clients: () => ({ db }) });
    const boom = observe('/api/test-boom', async () => { const e = new Error('secret detail 123-45-6789'); e.name = 'TypeError'; throw e; }, { env, clients: () => ({ db }) });
    await call(ok);
    const crashed = await call(boom);
    await call(ok, { headers: { 'user-agent': 'fynq-uptime-check/1 (+github-actions)' } });
    assert.equal(crashed.statusCode, 500);
    assert.ok(!String(crashed.body).includes('secret'));
    const logged = await rows(`select route, status, error_class, synthetic from public.api_requests order by id desc limit 3`);
    assert.equal((await one('select count(*)::int n from public.api_requests')).n - before, 3);
    assert.deepEqual(logged.map((r) => [r.route, r.status, r.error_class, r.synthetic]),
      [['/api/test-ok', 204, null, true], ['/api/test-boom', 500, 'TypeError', false], ['/api/test-ok', 204, null, false]]);
    const health = (await db.rpc('ops_health', { p_since: '2000-01-01T00:00:00Z', p_until: '2100-01-01T00:00:00Z' }, { get: true })).data;
    assert.ok(health.errors_5xx >= 1);
    assert.ok(health.p95_ms !== null);
    assert.equal(health.requests, 2, 'the synthetic uptime probe is excluded');
  });

  // ------------------------------------------------- read-only ops layer
  await test('ops_* functions run inside a READ ONLY transaction; write functions cannot', async () => {
    const since = '2000-01-01T00:00:00Z', until = '2100-01-01T00:00:00Z';
    for (const [name, args] of [
      ['ops_funnel', { p_since: since, p_until: until, p_segment: 'source', p_test: TESTER }],
      ['ops_revenue', { p_since: since, p_until: until, p_test: TESTER }],
      ['ops_health', { p_since: since, p_until: until }],
      ['ops_milestone_metrics', { p_test: TESTER }],
      ['ops_applied_migrations', {}],
    ]) {
      const { error } = await db.rpc(name, args, { get: true });
      assert.equal(error, null, `${name}: ${error?.message}`);
    }
    const write = await db.rpc('analytics_record', { p_events: [buildEvent('landing_view', { guestId: randomUUID() })] }, { get: true });
    assert.ok(write.error || write.data === 0, 'a write through the read-only path stores nothing');
  });

  await test('no function or table is reachable by anon/authenticated', async () => {
    const leaks = await rows(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and (p.proname like 'ops_%' or p.proname in ('analytics_record','api_request_record'))
        and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`);
    assert.deepEqual(leaks, []);
    for (const table of ['analytics_events', 'api_requests']) {
      assert.equal((await one(`select has_table_privilege('anon', 'public.${table}', 'select') a`)).a, false);
      assert.equal((await one(`select relrowsecurity r from pg_class where relname = '${table}'`)).r, true);
    }
  });

  await test('revenue is live-mode only and excludes test accounts; test-mode payments are not revenue', async () => {
    const since = '2000-01-01T00:00:00Z', until = '2100-01-01T00:00:00Z';
    const before = (await db.rpc('ops_revenue', { p_since: since, p_until: until, p_test: TESTER }, { get: true })).data;
    assert.equal(before.revenue_cents, 0, 'the test-mode payment above is not revenue');
    const live = randomUUID();
    await pg.exec(`insert into public.accounts(user_id, email) values ('${live}', 'live@example.test'), ('${TESTER}', 'tester@example.test')`);
    await pg.exec(`insert into public.billing_checkouts(checkout_session_id, account_id, livemode, is_test_account, status, amount_total, paid_at, expires_at)
      values ('cs_live_obs000001', '${live}', true, false, 'paid', 100, now(), now() + interval '1 hour'),
             ('cs_live_obs000002', '${TESTER}', true, true, 'paid', 100, now(), now() + interval '1 hour')`);
    const after = (await db.rpc('ops_revenue', { p_since: since, p_until: until, p_test: TESTER }, { get: true })).data;
    assert.equal(after.revenue_cents, 100);
    assert.equal(after.payments, 1);
  });

  await test('the ops metrics endpoint: bearer token only, aggregates only, never a cookie', async () => {
    const admin = createAdminHandler(deps());
    const none = await call(admin, { method: 'GET', url: '/api/beta-admin?view=ops' });
    assert.equal(none.statusCode, 401);
    const wrong = await call(admin, { method: 'GET', url: '/api/beta-admin?view=ops', headers: { authorization: 'Bearer ops_read_token_WRONG_0123456789abcdefgh' } });
    assert.equal(wrong.statusCode, 401);
    await clearRates();
    const okRes = await call(admin, { method: 'GET', url: '/api/beta-admin?view=ops&segment=source', headers: { authorization: 'Bearer ops_read_token_synthetic_0123456789abcdef' } });
    assert.equal(okRes.statusCode, 200, JSON.stringify(okRes.body));
    const body = JSON.stringify(okRes.body);
    for (const needle of ['@example.test', 'cs_live_obs', 'cs_test_obs', 'pi_obs', accountId, guestId]) assert.ok(!body.includes(needle), `${needle} leaked`);
    assert.ok(okRes.body.funnel.length >= 1);
    assert.ok('visitor_to_paid' in okRes.body.funnel[0].conversions);
    assert.equal(typeof okRes.body.milestones.registered_users, 'number');
    const unconfigured = await call(createAdminHandler(deps({ env: { ...env, OPS_READ_TOKEN_SHA256: '' } })), { method: 'GET', url: '/api/beta-admin', headers: { authorization: 'Bearer ops_read_token_synthetic_0123456789abcdef' } });
    assert.equal(unconfigured.statusCode, 401, 'no digest configured = no access');
  });

  await test('milestone metrics exclude admin/test accounts', async () => {
    const m = (await db.rpc('ops_milestone_metrics', { p_test: TESTER }, { get: true })).data;
    const all = (await one('select count(*)::int n from public.accounts')).n;
    assert.equal(m.registered_users, all - 1);
    assert.ok(m.events_last_seen.landing_view);
  });

  console.log(`RESULT ${passed} passed (pglite); synthetic data only; no network calls; ${readOnlyCalls} read-only calls.`);
} finally {
  await pg.close();
}
