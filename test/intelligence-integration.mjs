// FYNLIQ Intelligence v1 against a real Postgres running every migration.
// Synthetic data only; no network, no production.
//
// Proves that public.intelligence_metrics:
//   * returns exact aggregate counts for arbitrary windows,
//   * excludes admin/test accounts and Stripe test mode from revenue,
//   * computes cohort-in-window conversions (always <= their denominators),
//   * returns no ids, emails or free text,
//   * writes nothing (every table's row count is unchanged),
//   * is executable by service_role only,
// and that the snapshot falls back to the existing RPCs before it is applied.
//
//   node test/intelligence-integration.mjs                       # PGlite (devDependency)
//   INTELLIGENCE_TEST_PSQL_DB=fynq_intel node test/intelligence-integration.mjs
//                                                                # local Postgres via psql (PG* env vars)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { buildSnapshot } from '../server/intelligence/snapshot.js';

const migrations = (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter((f) => f.endsWith('.sql')).sort();
const INTEL = '202610060003_intelligence_metrics.sql';
assert.ok(migrations.includes(INTEL), 'migration file present');

function literal(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value) && value.every((v) => typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v))) return `'{${value.join(',')}}'::uuid[]`;
  if (value && typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function openDatabase() {
  if (process.env.INTELLIGENCE_TEST_PSQL_DB) {
    const name = process.env.INTELLIGENCE_TEST_PSQL_DB;
    const psql = (sql, database = name) => execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', database, '-c', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    psql(`drop database if exists ${name}`, 'postgres');
    psql(`create database ${name}`, 'postgres');
    try { psql('create role anon; create role authenticated; create role service_role bypassrls;', 'postgres'); } catch { /* roles are cluster-wide */ }
    return {
      exec: async (sql) => { psql(sql); },
      value: async (sql) => JSON.parse(psql(`select to_json((${sql}))::text`) || 'null'),
      close: async () => {},
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite();
  await pg.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  return {
    exec: async (sql) => { await pg.exec(sql); },
    value: async (sql) => JSON.parse(JSON.stringify((await pg.query(`select to_json((${sql})) as v`)).rows[0]?.v ?? null)),
    close: () => pg.close(),
  };
}

const db = await openDatabase();
const apply = async (file) => db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
const rpc = async (name, args = {}) => {
  const list = Object.entries(args).map(([k, v]) => `${k} => ${literal(v)}`).join(', ');
  return db.value(`select public.${name}(${list})`);
};

// ------------------------------------------------- before the migration
for (const f of migrations.filter((f) => f < INTEL)) await apply(f);
await db.exec('grant usage on schema public to anon, authenticated, service_role');

// Synthetic world. Day under test: 2026-10-05 (UTC). Previous day: 2026-10-04.
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const D = '2026-10-05T', P = '2026-10-04T', OLD = '2026-09-01T10:00:00Z';
const TEST_ACCOUNT = id(900);
await db.exec(`
 -- Guests: 6 new on the day under test, 3 the day before, 1 old.
 insert into public.anonymous_users(id, created_at) values
  ('${id(1)}','${D}01:00:00Z'),('${id(2)}','${D}02:00:00Z'),('${id(3)}','${D}03:00:00Z'),('${id(4)}','${D}04:00:00Z'),('${id(5)}','${D}05:00:00Z'),('${id(6)}','${D}06:00:00Z'),
  ('${id(11)}','${P}01:00:00Z'),('${id(12)}','${P}02:00:00Z'),('${id(13)}','${P}03:00:00Z'),('${id(99)}','${OLD}'),('${id(901)}','${D}07:00:00Z');
 -- Accounts: 3 real sign-ups on the day (from guests 1-3), 1 test account, 1 old account.
 insert into public.accounts(user_id, email, created_at) values
  ('${id(101)}','a@example.test','${D}01:30:00Z'),('${id(102)}','b@example.test','${D}02:30:00Z'),('${id(103)}','c@example.test','${D}03:30:00Z'),
  ('${TEST_ACCOUNT}','admin@example.test','${D}07:30:00Z'),('${id(199)}','old@example.test','${OLD}');
 insert into public.account_guests(user_id, guest_id) values
  ('${id(101)}','${id(1)}'),('${id(102)}','${id(2)}'),('${id(103)}','${id(3)}'),('${TEST_ACCOUNT}','${id(901)}'),('${id(199)}','${id(99)}');
 insert into public.account_events(user_id, event_type, created_at) values ('${id(199)}','logged_in','${D}09:00:00Z');
 -- Uploads: 2 by new accounts (1 read, 1 unreadable), 1 by the old account, 1 the day before.
 insert into public.upload_events(account_id, outcome, files, figures, created_at) values
  ('${id(101)}','read',1,5,'${D}02:00:00Z'),('${id(102)}','unreadable',2,0,'${D}03:00:00Z'),('${id(199)}','read',1,4,'${D}10:00:00Z'),
  (null,'read',1,3,'${P}05:00:00Z');
 -- Ask: 2 questions from guest 4 (1 answered, 1 failed).
 insert into public.beta_sessions(id, token_hash, user_id, kind) values ('${id(500)}','h1','${id(4)}','guest');
 insert into public.beta_questions(user_id, session_id, created_at, finished_at, state) values
  ('${id(4)}','${id(500)}','${D}11:00:00Z','${D}11:00:05Z','success'),('${id(4)}','${id(500)}','${D}11:10:00Z','${D}11:10:05Z','failed');
 -- Paywall funnel (live): accounts 101 and 102 upload; 101 checks out (twice) and pays; 102 does not.
 insert into public.monetization_events(account_id, event_type, livemode, is_test_account, created_at) values
  ('${id(101)}','my_aid_page_view',true,false,'${D}01:40:00Z'),('${id(102)}','my_aid_page_view',true,false,'${D}02:40:00Z'),
  ('${id(101)}','aid_upload_completed',true,false,'${D}02:01:00Z'),('${id(102)}','aid_upload_completed',true,false,'${D}03:01:00Z'),
  ('${id(101)}','aid_preview_viewed',true,false,'${D}02:02:00Z'),('${id(101)}','paywall_viewed',true,false,'${D}02:02:00Z'),('${id(102)}','paywall_viewed',true,false,'${D}03:02:00Z'),
  ('${id(101)}','unlock_button_clicked',true,false,'${D}02:03:00Z'),('${id(101)}','unlock_clicked',true,false,'${D}02:03:01Z'),
  ('${id(101)}','checkout_created',true,false,'${D}02:04:00Z'),('${id(101)}','checkout_created',true,false,'${D}02:05:00Z'),
  -- noise that must be excluded: test mode, a flagged test account, the configured test account
  ('${id(102)}','checkout_created',false,false,'${D}03:05:00Z'),('${id(103)}','checkout_created',true,true,'${D}04:05:00Z'),
  ('${TEST_ACCOUNT}','checkout_created',true,false,'${D}07:40:00Z');
 insert into public.billing_checkouts(checkout_session_id, account_id, livemode, is_test_account, status, amount_total, currency, expires_at, created_at, paid_at) values
  ('cs_live_intelpaid00000001','${id(101)}',true,false,'paid',100,'usd','${D}23:00:00Z','${D}02:04:00Z','${D}02:06:00Z'),
  ('cs_test_intelpaid00000002','${id(102)}',false,false,'paid',100,'usd','${D}23:00:00Z','${D}03:05:00Z','${D}03:06:00Z'),
  ('cs_live_intelpaid00000003','${TEST_ACCOUNT}',true,false,'paid',100,'usd','${D}23:00:00Z','${D}07:40:00Z','${D}07:41:00Z'),
  ('cs_live_intelfail00000004','${id(103)}',true,false,'failed',null,null,'${D}23:00:00Z','${D}04:00:00Z',null);
 insert into public.billing_stripe_events(event_id, event_type, livemode, checkout_session_id, outcome, received_at) values
  ('evt_intelfail0001','checkout.session.async_payment_failed',true,'cs_live_intelfail00000004','payment_failed','${D}04:10:00Z');
 -- Attribution: guests 1-2 from TikTok, guest 3 direct, guest 99 legacy.
 update public.acquisition_attribution set channel='tiktok', attribution_type='utm', source='tiktok', campaign='secret campaign text' where guest_id in ('${id(1)}','${id(2)}');
 update public.acquisition_attribution set channel='direct', attribution_type='direct' where guest_id = '${id(3)}';
`);
// The attribution migration backfills existing guests as legacy; fresh rows are needed for guests created after it.
await db.exec(`insert into public.acquisition_attribution(guest_id, first_seen_at, attribution_type, channel, source, campaign) values
 ('${id(1)}','${D}01:00:00Z','utm','tiktok','tiktok','secret campaign text'),('${id(2)}','${D}02:00:00Z','utm','tiktok','tiktok',null),('${id(3)}','${D}03:00:00Z','direct','direct',null,null)
 on conflict (guest_id) do update set channel=excluded.channel, attribution_type=excluded.attribution_type, first_seen_at=excluded.first_seen_at, source=excluded.source, campaign=excluded.campaign`);

// Fallback before the migration: snapshot still works, from the per-day series.
const now = new Date('2026-10-06T12:00:00Z');
const fallback = await buildSnapshot({ rpc, now, testIds: [TEST_ACCOUNT] });
assert.equal(fallback.dataSource, 'fallback');
assert.equal(fallback.traffic.visitors, 7, 'fallback counts every new browser that day');
assert.equal(fallback.funnel.signups, 4, 'fallback cannot exclude test accounts (warned)');
assert.equal(fallback.funnel.uploads, 3);
assert.equal(fallback.funnel.payments, null);
assert.ok(fallback.dataQualityWarnings.some((w) => w.includes('include admin and test accounts')));
console.log('✓ fallback snapshot before the migration');

// --------------------------------------------------- apply the migration
const TABLES = ['anonymous_users', 'accounts', 'account_guests', 'account_events', 'upload_events', 'beta_questions', 'monetization_events', 'billing_checkouts', 'billing_stripe_events', 'billing_entitlements', 'acquisition_attribution', 'events'];
const counts = async () => Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, await db.value(`select count(*)::int from public.${t}`)])));
await apply(INTEL);
const before = await counts();

for (const role of ['anon', 'authenticated']) {
  assert.equal(await db.value(`select has_function_privilege('${role}', 'public.intelligence_metrics(jsonb, uuid[], boolean)', 'execute')`), false, `${role} cannot execute`);
  assert.equal(await db.value(`select has_function_privilege('${role}', 'public.intelligence_window(timestamptz, timestamptz, uuid[], boolean)', 'execute')`), false, `${role} cannot execute window`);
}
assert.equal(await db.value(`select has_function_privilege('service_role', 'public.intelligence_metrics(jsonb, uuid[], boolean)', 'execute')`), true);
console.log('✓ service_role only');

const result = await rpc('intelligence_metrics', {
  p_windows: [{ key: 'day', start: `${D}00:00:00Z`, end: '2026-10-06T00:00:00Z' }, { key: 'prev', start: `${P}00:00:00Z`, end: `${D}00:00:00Z` }],
  p_test: [TEST_ACCOUNT], p_livemode: true,
});
const w = result.windows.day;
const expected = {
  new_visitors: 7, new_visitors_signed_up: 3, new_visitors_paid: 1, returning_accounts: 1, attributed_visitors: 3,
  signups: 3, signups_uploaded: 2, logins: 1, uploads: 3, uploads_read: 2, uploads_failed: 1, uploaders: 3,
  questions: 2, questions_answered: 1, questions_failed: 1, askers: 1,
  my_aid_accounts: 2, eligible_upload_accounts: 2, preview_accounts: 2, unlock_click_accounts: 1,
  checkout_accounts: 1, checkout_sessions: 2, upload_then_checkout_accounts: 1, checkout_then_paid_accounts: 1,
  payments: 1, paid_accounts: 1, revenue_cents: 100, duplicate_payments: 0, failed_payments: 1, expired_checkouts: 0,
};
for (const [k, v] of Object.entries(expected)) assert.equal(w[k], v, `day.${k}`);
assert.deepEqual(w.visitors_by_channel, { tiktok: 2, direct: 1 });
assert.deepEqual(w.uploads_by_outcome, { read: 2, unreadable: 1 });
assert.equal(result.windows.prev.new_visitors, 3);
assert.equal(result.windows.prev.uploads, 1);
assert.equal(result.windows.prev.payments, 0);
for (const [num, den] of [['new_visitors_signed_up', 'new_visitors'], ['signups_uploaded', 'signups'], ['upload_then_checkout_accounts', 'eligible_upload_accounts'], ['checkout_then_paid_accounts', 'checkout_accounts'], ['new_visitors_paid', 'new_visitors']]) {
  assert.ok(w[num] <= w[den], `${num} <= ${den}`);
}
console.log('✓ exact window counts, exclusions and cohort conversions');

const text = JSON.stringify(result);
assert.ok(!text.includes('@'), 'no emails');
assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/.test(text), 'no ids');
assert.ok(!text.includes('secret campaign'), 'no UTM free text');
console.log('✓ aggregate only: no emails, ids or free text');

for (const bad of [[], [{ key: 'x', start: '2026-10-05T00:00:00Z', end: '2026-10-04T00:00:00Z' }], [{ key: 'Bad Key', start: '2026-10-04T00:00:00Z', end: '2026-10-05T00:00:00Z' }], [{ key: 'long', start: '2024-01-01T00:00:00Z', end: '2026-01-01T00:00:00Z' }]]) {
  await assert.rejects(rpc('intelligence_metrics', { p_windows: bad, p_test: [], p_livemode: true }), undefined, `rejects ${JSON.stringify(bad)}`);
}
console.log('✓ invalid windows rejected');

// End to end through the snapshot builder.
const snapshot = await buildSnapshot({ rpc, now, testIds: [TEST_ACCOUNT] });
assert.equal(snapshot.dataSource, 'rpc');
assert.equal(snapshot.traffic.visitors, 7);
assert.equal(snapshot.funnel.signups, 3);
assert.equal(snapshot.revenue.gross, 1);
assert.equal(snapshot.conversion.uploadToCheckout, 0.5);
assert.equal(snapshot.conversion.checkoutToPayment, 1);
assert.equal(snapshot.acquisition.byChannel.tiktok, 2);
console.log('✓ snapshot from intelligence_metrics');

assert.deepEqual(await counts(), before, 'read-only: no table changed');
console.log('✓ read-only: no rows written');

await db.close();
console.log('\nintelligence integration: all checks passed');
