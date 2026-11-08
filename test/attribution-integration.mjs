// Marketing attribution end to end, against a real Postgres running every
// migration, with a fake Stripe in TEST mode. Synthetic data only; no network.
//
//   TikTok UTM link -> guest browser -> account -> My Aid upload -> paywall
//   -> Stripe TEST checkout -> TEST payment -> analysis completed
//
// and checks the purchase still traces back to TikTok / campaign / video,
// that test-mode money is kept apart from live money, and that existing
// data is labelled legacy rather than guessed.
//
//   node test/attribution-integration.mjs                 # PGlite (devDependency)
//   ATTRIBUTION_TEST_PSQL_DB=fynq_attr node test/attribution-integration.mjs
//                                                          # local Postgres via psql
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { createAuthHandler } from '../api/beta-auth.js';
import { createBillingHandler } from '../api/billing.js';
import { createStripeWebhookHandler } from '../api/stripe-webhook.js';
import { createAccountHandler } from '../server/account-login.js';
import { signStripePayload } from '../server/stripe.js';
import { arrivalFrom } from '../src/analytics/attribution.ts';

// ------------------------------------------------------------ database

const migrations = (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter((f) => f.endsWith('.sql')).sort();
function literal(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}
const inline = (sql, params = []) => sql.replace(/\$(\d+)/g, (_, n) => literal(params[Number(n) - 1]));

async function openDatabase() {
  if (process.env.ATTRIBUTION_TEST_PSQL_DB) {
    const name = process.env.ATTRIBUTION_TEST_PSQL_DB;
    const psql = (sql, database = name) => execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', database, '-c', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    psql(`drop database if exists ${name}`, 'postgres');
    psql(`create database ${name}`, 'postgres');
    try { psql('create role anon; create role authenticated; create role service_role bypassrls;', 'postgres'); } catch { /* roles are cluster-wide */ }
    return {
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
    exec: async (sql) => { await pg.exec(sql); },
    query: async (sql, params) => JSON.parse(JSON.stringify((await pg.query(inline(sql, params))).rows)),
    value: async (sql, params) => JSON.parse(JSON.stringify((await pg.query(inline(sql, params))).rows[0] ?? { value: null })).value,
    close: () => pg.close(),
  };
}

const pg = await openDatabase();
// The pre-existing world: one guest browser and one account from before attribution.
const beforeAttribution = migrations.filter((f) => f < '202610060001');
for (const file of beforeAttribution) await pg.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
const OLD_GUEST = '20000000-0000-4000-8000-000000000001';
const OLD_ACCOUNT = '20000000-0000-4000-8000-0000000000a1';
await pg.exec(`insert into public.anonymous_users(id, created_at) values ('${OLD_GUEST}', now() - interval '10 days')`);
await pg.exec(`insert into public.accounts(user_id, email, created_at) values ('${OLD_ACCOUNT}', 'old@example.test', now() - interval '9 days')`);
await pg.exec(`insert into public.account_guests(user_id, guest_id) values ('${OLD_ACCOUNT}', '${OLD_GUEST}')`);
await pg.exec(`insert into public.billing_checkouts(checkout_session_id, account_id, livemode, status, amount_total, currency, expires_at, paid_at)
 values ('cs_live_oldpaymentxx01', '${OLD_ACCOUNT}', true, 'paid', 100, 'usd', now(), now() - interval '5 days')`);
for (const file of migrations.filter((f) => f >= '202610060001')) await pg.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
await pg.exec('grant usage on schema public to anon, authenticated, service_role');

let createdUsers = 0;
const db = {
  async rpc(name, args = {}) {
    const entries = Object.entries(args);
    try {
      const value = await pg.value(`select public.${name}(${entries.map(([k], i) => `${k} => $${i + 1}`).join(', ')}) as value`, entries.map(([, v]) => v));
      return { data: value === '' ? null : value, error: null };
    } catch { return { data: null, error: true }; }
  },
  auth: { admin: { async createUser({ email }) { createdUsers++; return { data: { user: { id: `30000000-0000-4000-8000-${String(createdUsers).padStart(12, '0')}`, email } }, error: null }; } } },
};

// ------------------------------------------------------------- fixtures

const ORIGIN = 'https://www.fynliq.test';
const WEBHOOK_SECRET = 'whsec_synthetic_attribution';
const env = {
  BETA_ENABLED: 'true', BETA_ORIGIN: ORIGIN, BETA_RATE_SECRET: 'synthetic-rate-secret-at-least-32-chars',
  PAYWALL_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test_synthetic123', STRIPE_PRICE_ID: 'price_synthetic123', STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
};
const stripeRequests = [];
const stripeFetch = async (_url, init) => {
  const params = new URLSearchParams(init.body);
  stripeRequests.push(params);
  const id = `cs_test_attribution${String(stripeRequests.length).padStart(4, '0')}`;
  return { ok: true, status: 200, json: async () => ({ id, object: 'checkout.session', url: `https://checkout.stripe.com/c/pay/${id}`, livemode: false }) };
};
const deps = { env, clients: () => ({ db, auth: db }), fetchImpl: stripeFetch };
let ip = 0;
function response() {
  return { statusCode: 200, headers: {}, body: undefined, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, send(v) { this.body = v; return this; }, json(v) { this.body = v; return this; } };
}
async function call(handler, { method = 'POST', body, cookie = '' } = {}) {
  const res = response();
  await handler({ method, body, headers: { 'content-type': 'application/json', origin: ORIGIN, cookie }, socket: { remoteAddress: `198.51.100.${(++ip % 250) + 1}` } }, res);
  return res;
}
const cookieValue = (res) => String(res.headers['Set-Cookie'] || '').split(';')[0];
const visit = (cookie, href, referrer = '', ua = '') => call(createAuthHandler(deps), { body: { action: 'guest', touch: arrivalFrom(href, referrer, ua) }, cookie });
const row = async (guest) => (await pg.query('select * from public.acquisition_attribution where guest_id = $1', [guest]))[0];

let passed = 0;
async function test(name, run) { await run(); passed++; console.log(`PASS ${name}`); }

const TIKTOK_VIDEO = `${ORIGIN}/?utm_source=tiktok&utm_medium=social&utm_campaign=october_growth&utm_content=video_07`;
let guestCookie, guestId, accountCookie, accountId, checkoutId;

try {
  await test('existing guests, accounts and payments become Legacy / Unattributed', async () => {
    const legacy = await row(OLD_GUEST);
    assert.equal(legacy.channel, 'legacy');
    assert.equal(legacy.account_id, OLD_ACCOUNT);
    assert.equal(legacy.touch_count, 0);
    assert.equal((await db.rpc('attribution_for_account', { p_user: OLD_ACCOUNT })).data.channel, 'legacy');
    const [old] = await pg.query("select attribution_channel from public.billing_checkouts where checkout_session_id = 'cs_live_oldpaymentxx01'");
    assert.equal(old.attribution_channel, 'legacy');
  });

  await test('a legacy browser arriving from TikTok later keeps legacy first touch, gets a TikTok last touch', async () => {
    const token = randomBytes(32).toString('hex');
    await db.rpc('beta_guest', { p_user: '20000000-0000-4000-8000-000000000002', p_hash: createHash('sha256').update(token).digest('hex') });
    // Pretend this browser was created long ago but never recorded (code deployed after migration).
    await pg.exec("update public.anonymous_users set created_at = now() - interval '2 hours' where id = '20000000-0000-4000-8000-000000000002'");
    await pg.exec("delete from public.acquisition_attribution where guest_id = '20000000-0000-4000-8000-000000000002'");
    const res = await visit(`__Host-fynliq_beta=${token}`, TIKTOK_VIDEO);
    assert.equal(res.statusCode, 200);
    const r = await row('20000000-0000-4000-8000-000000000002');
    assert.equal(r.channel, 'legacy');
    assert.equal(r.last_channel, 'tiktok');
  });

  await test('1. TikTok video link creates an anonymous visitor with first-touch TikTok attribution', async () => {
    const res = await visit('', TIKTOK_VIDEO, 'https://www.tiktok.com/');
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    guestCookie = cookieValue(res);
    guestId = res.body.user.id;
    const r = await row(guestId);
    assert.equal(r.attribution_type, 'utm');
    assert.equal(r.channel, 'tiktok');
    assert.equal(r.source, 'tiktok');
    assert.equal(r.medium, 'social');
    assert.equal(r.campaign, 'october_growth');
    assert.equal(r.content, 'video_07');
    assert.equal(r.landing_page, '/');
    assert.equal(r.referrer, 'www.tiktok.com');
    assert.equal(r.account_id, null);
    assert.equal(r.touch_count, 1);
  });

  await test('2. returning directly and then via Instagram never overwrites first touch', async () => {
    await visit(guestCookie, `${ORIGIN}/beta`);
    let r = await row(guestId);
    assert.equal(r.channel, 'tiktok');
    assert.equal(r.touch_count, 2);
    assert.equal(r.last_channel, 'tiktok', 'a direct visit does not replace the last real touch');
    await visit(guestCookie, `${ORIGIN}/`, 'https://l.instagram.com/');
    r = await row(guestId);
    assert.equal(r.channel, 'tiktok');
    assert.equal(r.campaign, 'october_growth');
    assert.equal(r.last_channel, 'instagram');
    assert.equal(r.touch_count, 3);
    // Coming back from Stripe Checkout is not a new source either.
    await visit(guestCookie, `${ORIGIN}/beta/checkout?result=success`, 'https://checkout.stripe.com/');
    assert.equal((await row(guestId)).last_channel, 'instagram');
    assert.equal((await pg.query('select count(*)::int n from public.acquisition_attribution where guest_id = $1', [guestId]))[0].n, 1, 'one row per browser');
  });

  await test('3. signing up links the visitor and its attribution to the new account', async () => {
    const res = await call(createAccountHandler('signup', deps), { body: { email: 'student@example.test', password: 'synthetic-password' }, cookie: guestCookie });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    accountCookie = cookieValue(res);
    accountId = (await pg.query("select user_id from public.accounts where email = 'student@example.test'"))[0].user_id;
    const r = await row(guestId);
    assert.equal(r.account_id, accountId);
    const a = (await db.rpc('attribution_for_account', { p_user: accountId })).data;
    assert.equal(a.channel, 'tiktok');
    assert.equal(a.campaign, 'october_growth');
    assert.equal(a.content, 'video_07');
    assert.equal(a.guest_id, guestId);
  });

  await test('4. a second device later used by the same account does not steal first touch', async () => {
    const res = await visit('', `${ORIGIN}/`, 'https://www.google.com/');
    const phone = cookieValue(res);
    const login = await call(createAccountHandler('session', deps), { method: 'GET', cookie: `${phone}; ${accountCookie}` });
    assert.equal(login.statusCode, 200);
    assert.equal((await row(res.body.user.id)).account_id, accountId);
    assert.equal((await db.rpc('attribution_for_account', { p_user: accountId })).data.channel, 'tiktok');
  });

  await test('5. My Aid upload and paywall view are recorded for the account', async () => {
    await db.rpc('record_upload', { p_account: accountId, p_guest: guestId, p_outcome: 'read', p_files: 2, p_figures: 6, p_reason: null });
    const res = await call(createBillingHandler(deps), { body: { action: 'track', event: 'paywall_viewed' }, cookie: `${guestCookie}; ${accountCookie}` });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const [ev] = await pg.query("select livemode from public.monetization_events where account_id = $1 and event_type = 'paywall_viewed'", [accountId]);
    assert.equal(ev.livemode, false, 'a TEST key records test-mode events');
  });

  await test('6. Stripe TEST checkout carries the first-touch UTM values, and the checkout row is stamped', async () => {
    const res = await call(createBillingHandler(deps), { body: { action: 'checkout' }, cookie: `${guestCookie}; ${accountCookie}` });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const params = stripeRequests.at(-1);
    assert.equal(params.get('metadata[fynq_account_id]'), accountId);
    assert.equal(params.get('metadata[purpose]'), 'fynq_beta_unlock');
    assert.equal(params.get('metadata[fynq_channel]'), 'tiktok');
    assert.equal(params.get('metadata[fynq_guest_id]'), guestId);
    assert.equal(params.get('metadata[utm_source]'), 'tiktok');
    assert.equal(params.get('metadata[utm_medium]'), 'social');
    assert.equal(params.get('metadata[utm_campaign]'), 'october_growth');
    assert.equal(params.get('metadata[utm_content]'), 'video_07');
    const sent = [...params.keys()].join(' ');
    for (const forbidden of ['email]', 'facts', 'overview', 'aid']) assert.ok(!sent.includes(`metadata[${forbidden}`), `${forbidden} must not be in Stripe metadata`);
    checkoutId = res.body.url.split('/').pop();
    const [ck] = await pg.query('select * from public.billing_checkouts where checkout_session_id = $1', [checkoutId]);
    assert.equal(ck.livemode, false);
    assert.equal(ck.attribution_channel, 'tiktok');
    assert.equal(ck.attribution_campaign, 'october_growth');
    assert.equal(ck.attribution_content, 'video_07');
    assert.equal(ck.attribution_id, (await row(guestId)).id);
  });

  await test('7. successful TEST payment via the webhook keeps the TikTok attribution', async () => {
    const event = { id: 'evt_attribution00001', object: 'event', type: 'checkout.session.completed', livemode: false, data: { object: {
      object: 'checkout.session', id: checkoutId, client_reference_id: accountId,
      metadata: { fynq_account_id: accountId, purpose: 'fynq_beta_unlock', fynq_channel: 'tiktok', utm_source: 'tiktok', utm_campaign: 'october_growth', utm_content: 'video_07' },
      payment_status: 'paid', amount_total: 100, currency: 'usd', payment_intent: 'pi_attribution0001', customer: 'cus_attribution01' } } };
    const payload = JSON.stringify(event);
    const res = response();
    await createStripeWebhookHandler(deps)({ method: 'POST', body: payload, headers: { 'stripe-signature': signStripePayload(payload, WEBHOOK_SECRET) } }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const [ck] = await pg.query('select status, livemode, attribution_channel, attribution_campaign, attribution_content from public.billing_checkouts where checkout_session_id = $1', [checkoutId]);
    assert.deepEqual(ck, { status: 'paid', livemode: false, attribution_channel: 'tiktok', attribution_campaign: 'october_growth', attribution_content: 'video_07' });
    const [ent] = await pg.query('select livemode, status from public.billing_entitlements where account_id = $1', [accountId]);
    assert.deepEqual(ent, { livemode: false, status: 'active' });
    await db.rpc('billing_track', { p_user: accountId, p_event: 'analysis_completed', p_livemode: false, p_test: false });
  });

  await test('8. the TEST payment is invisible to live revenue; the trace reads TikTok -> campaign -> video -> test payment', async () => {
    const metrics = await pg.value("select public.billing_metrics('2026-09-30T18:53:52.654622Z', '{}'::uuid[]) as value");
    assert.equal(metrics.live.paid_accounts, 0, 'no live entitlement was created');
    assert.equal(metrics.test_mode.paid_accounts, 1);
    const trace = await pg.query(`
      select a.channel, a.campaign, a.content, c.livemode, c.status
      from public.billing_checkouts c
      join public.acquisition_attribution a on a.id = c.attribution_id
      where c.account_id = $1`, [accountId]);
    assert.deepEqual(trace, [{ channel: 'tiktok', campaign: 'october_growth', content: 'video_07', livemode: false, status: 'paid' }]);
  });

  await test('9. an account created before its first recorded visit stays legacy', async () => {
    const res = await visit('', TIKTOK_VIDEO);
    await pg.exec(`insert into public.account_guests(user_id, guest_id) values ('${OLD_ACCOUNT}', '${res.body.user.id}')`);
    // Its own legacy browser is older, so first touch is legacy regardless.
    assert.equal((await db.rpc('attribution_for_account', { p_user: OLD_ACCOUNT })).data.channel, 'legacy');
    // And an old account with no legacy browser at all still cannot be credited to TikTok.
    await pg.exec("insert into public.accounts(user_id, email, created_at) values ('20000000-0000-4000-8000-0000000000a2', 'older@example.test', now() - interval '3 days')");
    const fresh = await visit('', TIKTOK_VIDEO);
    await pg.exec(`insert into public.account_guests(user_id, guest_id) values ('20000000-0000-4000-8000-0000000000a2', '${fresh.body.user.id}')`);
    assert.equal((await db.rpc('attribution_for_account', { p_user: '20000000-0000-4000-8000-0000000000a2' })).data.channel, 'legacy');
  });

  await test('10. bad input never breaks the guest session and never writes junk', async () => {
    const res = await call(createAuthHandler(deps), { body: { action: 'guest', touch: { utm: { source: 'x'.repeat(90) }, referrer: "'; drop table x; --", landing: '/../../etc', clickIds: 'nope' } } });
    assert.equal(res.statusCode, 200);
    const r = await row(res.body.user.id);
    assert.equal(r.channel, 'other');
    assert.equal(r.referrer, null);
    assert.equal((await db.rpc('attribution_touch', { p_guest: '29999999-0000-4000-8000-000000000000', p_touch: {} })).data, 'unknown_guest');
    const plain = await call(createAuthHandler(deps), { body: { action: 'guest' } });
    assert.equal(plain.statusCode, 200, 'old clients without a touch still work');
    assert.equal((await row(plain.body.user.id)), undefined, 'no touch, no row');
    assert.equal((await db.rpc('attribution_touch', { p_guest: plain.body.user.id, p_touch: { attribution_type: 'utm', channel: 'nonsense' } })).data, 'first_touch');
    assert.equal((await row(plain.body.user.id)).channel, 'direct', 'unknown channels are stored as direct, never guessed');
  });

  await test('10b. plain fynliq.com opened in TikTok\'s built-in browser is TikTok (in_app), and later tags only move last touch', async () => {
    const TIKTOK_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_36.5.0 BytedanceWebview/d8a21c6';
    const res = await visit('', `${ORIGIN}/`, '', TIKTOK_UA);
    assert.equal(res.statusCode, 200);
    const cookie = cookieValue(res);
    let r = await row(res.body.user.id);
    assert.equal(r.attribution_type, 'in_app');
    assert.equal(r.channel, 'tiktok');
    assert.equal(r.source, 'tiktok');
    assert.equal(r.last_attribution_type, 'in_app');
    assert.ok(!JSON.stringify(r).includes('Mozilla'), 'the user agent is never stored');
    await visit(cookie, `${ORIGIN}/?utm_source=instagram&utm_medium=social`, '');
    r = await row(res.body.user.id);
    assert.equal(r.channel, 'tiktok', 'first touch kept');
    assert.equal(r.last_channel, 'instagram');
    assert.equal((await db.rpc('attribution_touch', { p_guest: res.body.user.id, p_touch: { attribution_type: 'in_app', channel: 'direct' } })).data, 'touched', 'a mismatched type/channel pair is treated as direct');
  });

  await test('11. browsers cannot read or write attribution', async () => {
    for (const role of ['anon', 'authenticated']) {
      await assert.rejects(pg.exec(`set role ${role}; select * from public.acquisition_attribution; reset role;`).finally(() => pg.exec('reset role').catch(() => {})));
      await assert.rejects(pg.exec(`set role ${role}; select public.attribution_for_account('${accountId}'); reset role;`).finally(() => pg.exec('reset role').catch(() => {})));
    }
  });

  console.log(`RESULT ${passed} passed; synthetic data only; Stripe TEST mode; no network calls.`);
} finally {
  await pg.close();
}
