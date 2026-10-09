// FYNLIQ Intelligence through the real admin route (api/beta-admin.js), with
// the real session / admin / same-origin / body / rate-limit helpers from
// server/beta.js. Only the database is faked (an in-memory rpc() recorder).
//
// @supabase/supabase-js is replaced by a stub through a Node loader hook, so
// this file runs with plain Node and no node_modules. createClient is never
// called: the handler receives `clients` as a dependency.
//
//   node --test test/intelligence-admin-route.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const STUB = 'export function createClient(){throw new Error("supabase stub: createClient must not be called in this test")}';
const HOOKS = `export async function resolve(specifier, context, next) {
  if (specifier === '@supabase/supabase-js') return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(STUB)}), shortCircuit: true };
  return next(specifier, context);
}`;
register(`data:text/javascript,${encodeURIComponent(HOOKS)}`);

const { createAdminHandler, config } = await import('../api/beta-admin.js');
const { SCENARIOS, scenarioRpc, NOW } = await import('./fixtures/intelligence-scenarios.mjs');
const { referenceBrief } = await import('./fixtures/reference-brief.mjs');
const { buildSnapshot } = await import('../server/intelligence/snapshot.js');
const { runAnalyst } = await import('../server/intelligence/analyst.js');

const ADMIN_ID = '30000000-0000-4000-8000-000000000001';
const OTHER_ID = '30000000-0000-4000-8000-000000000002';
const TEST_ID = '30000000-0000-4000-8000-000000000009';
const TOKEN = 'a'.repeat(64);
const ORIGIN = 'https://www.fynliq.example';
const ENV = {
  BETA_ADMIN_USER_IDS: ADMIN_ID, FYNQ_BILLING_TEST_ACCOUNT_IDS: TEST_ID, BETA_ORIGIN: ORIGIN,
  BETA_RATE_SECRET: 'r'.repeat(40), PAYWALL_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test_x',
};
const LEGACY = {
  beta_metrics: { total_signups: 5, activated_users: 2, returning_users: 1, dau: 1, wau: 2, mau: 3, total_questions: 4, successful_answers: 3, failed_answers: 1, signups_by_day: [] },
  account_metrics: { accounts_by_day: [], accounts: [] },
  upload_metrics: { by_day: [], recent: [] },
  billing_metrics: { live: { paywall_views: 1 }, test_mode: { paywall_views: 0 } },
};

/** A fake service-role db: records every rpc call; `kind` is the session kind, `user` its owner. */
function fakeDb({ user = ADMIN_ID, kind = 'admin', rateAllowed = true, scenario = SCENARIOS.find((s) => s.id === 'uploads_up_checkout_collapse') } = {}) {
  const calls = [];
  const intel = scenarioRpc(scenario);
  return {
    calls,
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'beta_session') return { data: { user_id: user, kind }, error: null };
      if (name === 'beta_rate') return { data: rateAllowed, error: null };
      if (name === 'intelligence_metrics') return { data: await intel(name, args), error: null };
      if (name in LEGACY) return { data: structuredClone(LEGACY[name]), error: null };
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
  };
}

function response() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; },
  };
}

async function call({ method = 'GET', url = '/api/beta-admin', query, body, cookie = `__Host-fynliq_admin=${TOKEN}`, origin = ORIGIN, contentType = 'application/json', db = fakeDb(), env = ENV, providerFactory, clock = () => NOW } = {}) {
  const req = { method, url, query: query ?? Object.fromEntries(new URL(url, 'http://x').searchParams), headers: { cookie, origin, 'content-type': contentType }, body, socket: { remoteAddress: '127.0.0.1' } };
  const res = response();
  let providerCalls = 0;
  const factory = providerFactory && ((e) => { providerCalls += 1; return providerFactory(e); });
  await createAdminHandler({ env, clients: () => ({ db }), providerFactory: factory, log: () => {}, clock })(req, res);
  return { res, db, providerCalls };
}

const scriptedProvider = (answer) => ({ name: 'fake', model: 'fake', async analyze() { return { text: JSON.stringify(answer), usage: { inputTokens: 1, outputTokens: 1 } }; } });
const names = (db) => db.calls.map((c) => c.name);

// ------------------------------------------------- existing admin GET unchanged

test('legacy admin GET (no view): same RPCs, same args, same body, no intelligence call', async () => {
  const { res, db } = await call();
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.deepEqual(names(db), ['beta_session', 'beta_metrics', 'account_metrics', 'upload_metrics', 'billing_metrics']);
  const billingArgs = db.calls.find((c) => c.name === 'billing_metrics').args;
  assert.deepEqual([...billingArgs.p_test].sort(), [ADMIN_ID, TEST_ID].sort());
  assert.deepEqual(Object.keys(res.body).sort(), [...Object.keys(LEGACY.beta_metrics), 'accounts', 'uploads', 'billing'].sort());
  assert.equal(res.body.billing.paywall_enabled, true);
  assert.equal(res.body.billing.stripe_livemode, false);
  assert.equal(res.body.snapshot, undefined);
});

test('an unknown view falls through to the legacy GET', async () => {
  const { res, db } = await call({ url: '/api/beta-admin?view=something-else' });
  assert.equal(res.statusCode, 200);
  assert.ok(!names(db).includes('intelligence_metrics'));
  assert.ok('total_signups' in res.body);
});

test('legacy GET still rejects missing, guest and non-admin sessions', async () => {
  assert.equal((await call({ cookie: '' })).res.statusCode, 401);
  assert.equal((await call({ db: fakeDb({ kind: 'guest' }) })).res.statusCode, 401);
  assert.equal((await call({ db: fakeDb({ user: OTHER_ID }) })).res.statusCode, 403);
});

test('methods other than GET/POST are still 405, before any database call', async () => {
  for (const method of ['PUT', 'DELETE', 'PATCH']) {
    const { res, db } = await call({ method });
    assert.equal(res.statusCode, 405, method);
    assert.equal(db.calls.length, 0, method);
  }
});

// ------------------------------------------------- intelligence: admin only

test('snapshot GET: 401 without a session, 403 for a non-admin, no metrics read', async () => {
  const url = '/api/beta-admin?view=intelligence-snapshot&period=day';
  const anon = await call({ url, cookie: '' });
  assert.equal(anon.res.statusCode, 401);
  const nonAdmin = await call({ url, db: fakeDb({ user: OTHER_ID }) });
  assert.equal(nonAdmin.res.statusCode, 403);
  assert.deepEqual(names(nonAdmin.db), ['beta_session']);
});

test('brief POST: non-admin is 403 before same-origin, rate limit or provider', async () => {
  const { res, db, providerCalls } = await call({ method: 'POST', body: { action: 'intelligence-brief' }, db: fakeDb({ user: OTHER_ID }), env: { ...ENV, INTELLIGENCE_ENABLED: 'true' }, providerFactory: () => scriptedProvider({}) });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(names(db), ['beta_session']);
  assert.equal(providerCalls, 0);
});

test('snapshot GET as admin: 200, real RPC args exclude admin/test ids and use live mode', async () => {
  const { res, db } = await call({ url: '/api/beta-admin?view=intelligence-snapshot&period=week' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.snapshot.period.type, 'week');
  assert.equal(res.body.snapshot.dataSource, 'rpc');
  const args = db.calls.find((c) => c.name === 'intelligence_metrics').args;
  assert.equal(args.p_livemode, true);
  assert.deepEqual([...args.p_test].sort(), [ADMIN_ID, TEST_ID].sort());
  assert.deepEqual(args.p_windows.map((w) => w.key), ['current', 'previous', 'trailing7', 'trailing30', 'today', 'yesterday_same_time']);
  assert.ok(!names(db).includes('beta_metrics'), 'no legacy payload (emails) on the snapshot route');
  assert.ok(!JSON.stringify(res.body).includes('@'));
});

test('snapshot GET rejects an unknown period with 400', async () => {
  assert.equal((await call({ url: '/api/beta-admin?view=intelligence-snapshot&period=month' })).res.statusCode, 400);
});

test('brief POST as admin: cross-origin 403 and non-JSON 415, provider never built', async () => {
  const env = { ...ENV, INTELLIGENCE_ENABLED: 'true' };
  const cross = await call({ method: 'POST', body: { action: 'intelligence-brief' }, origin: 'https://evil.example', env, providerFactory: () => scriptedProvider({}) });
  assert.equal(cross.res.statusCode, 403);
  assert.equal(cross.providerCalls, 0);
  const form = await call({ method: 'POST', body: 'action=intelligence-brief', contentType: 'application/x-www-form-urlencoded', env, providerFactory: () => scriptedProvider({}) });
  assert.equal(form.res.statusCode, 415);
  assert.equal(form.providerCalls, 0);
});

test('brief POST disabled: 503 intelligence_disabled, no rate-limit or model call', async () => {
  const { res, db, providerCalls } = await call({ method: 'POST', body: { action: 'intelligence-brief', period: 'day' }, providerFactory: () => scriptedProvider({}) });
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'intelligence_disabled');
  assert.ok(!names(db).includes('beta_rate'));
  assert.equal(providerCalls, 0);
});

test('brief POST over the rate limit: 429, provider never built', async () => {
  const { res, providerCalls } = await call({ method: 'POST', body: { action: 'intelligence-brief' }, db: fakeDb({ rateAllowed: false }), env: { ...ENV, INTELLIGENCE_ENABLED: 'true' }, providerFactory: () => scriptedProvider({}) });
  assert.equal(res.statusCode, 429);
  assert.equal(providerCalls, 0);
});

test('brief POST without an OpenAI key: 503 intelligence_not_configured (real createProvider)', async () => {
  const { res } = await call({ method: 'POST', body: { action: 'intelligence-brief' }, env: { ...ENV, INTELLIGENCE_ENABLED: 'true', OPENAI_API_KEY: '' } });
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'intelligence_not_configured');
});

test('brief POST end to end: valid brief 200; invalid brief 502 brief_unavailable with no brief', async () => {
  const env = { ...ENV, INTELLIGENCE_ENABLED: 'true' };
  const s = await buildSnapshot({ rpc: scenarioRpc(SCENARIOS.find((x) => x.id === 'uploads_up_checkout_collapse')), now: NOW, testIds: [ADMIN_ID, TEST_ID] });
  const ok = await call({ method: 'POST', body: { action: 'intelligence-brief', period: 'day' }, env, providerFactory: () => scriptedProvider(referenceBrief(s)) });
  assert.equal(ok.res.statusCode, 200);
  assert.equal(ok.res.body.brief.primaryBottleneck.stage, 'uploadToCheckout');
  assert.ok(names(ok.db).includes('beta_rate'));
  const bad = await call({ method: 'POST', body: { action: 'intelligence-brief', period: 'day' }, env, providerFactory: () => scriptedProvider({ executiveSummary: 'x' }) });
  assert.equal(bad.res.statusCode, 502);
  assert.equal(bad.res.body.error, 'brief_unavailable');
  assert.equal(bad.res.body.brief, undefined);
});

// ------------------------------------------------- time budget

test('the worst-case model time fits inside the function maxDuration (controlled error, not a platform timeout)', async () => {
  // Simulated clock. Each fake call takes `fraction` of the timeout it was given
  // (1 = runs right up to its timeout, the worst case), then returns invalid
  // output so the analyst wants to retry. The provider default (45s) applies
  // when the analyst passes no timeout.
  const DEFAULT_PROVIDER_TIMEOUT_MS = 45000;
  const s = await buildSnapshot({ rpc: scenarioRpc(SCENARIOS[2]), now: NOW });
  for (const fraction of [1, 0.75, 0.5, 0.2]) {
    let clock = 0;
    const calls = [];
    const logs = [];
    const provider = {
      name: 'fake', model: 'fake',
      async analyze(req) { const t = req.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS; calls.push(t); clock += Math.round(t * fraction); return { text: '{"invalid":true}', usage: {} }; },
    };
    await assert.rejects(runAnalyst({ snapshot: s, provider, now: () => clock, log: (r) => logs.push(r) }), (e) => e.code === 'validation_failed');
    assert.ok(clock < config.maxDuration * 1000,
      `fraction ${fraction}: ${calls.length} attempts (timeouts ${calls.join(', ')}ms) took ${clock}ms of model time, but maxDuration is ${config.maxDuration}s: the platform would kill the request (504) instead of returning 502 brief_unavailable`);
    assert.equal(logs.length, 1, 'the failure is always logged');
  }
});
