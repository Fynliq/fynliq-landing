// FYNQ Business API database layer against a real Postgres running every
// migration. Synthetic data only; no network, no production.
//
// Proves: service_role-only access; the application -> approval -> key flow;
// key authentication by hash (revoked keys fail); credits that can't go
// negative or be double-spent (including under real concurrency on Postgres);
// refunds exactly once; Stripe purchases granted once per session;
// Idempotency-Key replays without a second charge; no secrets in views.
//
//   node test/business-integration.mjs                         # PGlite (devDependency)
//   BUSINESS_TEST_PSQL_DB=fynq_biz node test/business-integration.mjs   # local Postgres (PG* env vars)
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { promisify } from 'node:util';

const migrations = (await readdir(new URL('../supabase/migrations/', import.meta.url))).filter((f) => f.endsWith('.sql')).sort();
const BIZ = '202610090001_business_api.sql';
assert.ok(migrations.includes(BIZ), 'migration file present');

const lit = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'boolean' ? String(v) : typeof v === 'number' ? String(v)
  : typeof v === 'object' ? `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb` : `'${String(v).replace(/'/g, "''")}'`);

async function openDatabase() {
  if (process.env.BUSINESS_TEST_PSQL_DB) {
    const name = process.env.BUSINESS_TEST_PSQL_DB;
    const args = (sql, database = name) => ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', database, '-c', sql];
    const psql = (sql, database = name) => execFileSync('psql', args(sql, database), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const psqlAsync = promisify(execFile);
    psql(`drop database if exists ${name}`, 'postgres');
    psql(`create database ${name}`, 'postgres');
    try { psql('create role anon; create role authenticated; create role service_role bypassrls;', 'postgres'); } catch { /* roles are cluster-wide */ }
    return {
      concurrent: true,
      exec: async (sql) => { psql(sql); },
      value: async (sql) => JSON.parse(psql(`select to_json((${sql}))::text`).trim() || 'null'),
      // A separate connection per call, so calls really run in parallel.
      valueAsync: async (sql) => JSON.parse((await psqlAsync('psql', args(`select to_json((${sql}))::text`), { encoding: 'utf8' })).stdout.trim() || 'null'),
      close: async () => {},
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite();
  await pg.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  const value = async (sql) => JSON.parse(JSON.stringify((await pg.query(`select to_json((${sql})) as v`)).rows[0]?.v ?? null));
  return { concurrent: false, exec: async (sql) => { await pg.exec(sql); }, value, valueAsync: value, close: () => pg.close() };
}

const db = await openDatabase();
for (const f of migrations) await db.exec(await readFile(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8'));
const call = (fn, ...a) => db.value(`public.${fn}(${a.map(lit).join(', ')})`);
const fails = async (sql, pattern, label) => {
  await assert.rejects(db.value(sql), (e) => pattern.test(String(e?.stderr ?? e?.message ?? e)), label);
};
const reqId = () => `req_${randomBytes(16).toString('hex')}`;
const hash = (k) => createHash('sha256').update(k).digest('hex');

// ----------------------------------------------------------------- grants
const FNS = ['biz_apply(text, text, text, text)', 'biz_create_key(uuid, text, text, text, boolean)', 'biz_authenticate(text)',
  'biz_reserve(uuid, uuid, text, text, text, integer)', 'biz_grant_purchase(uuid, integer, text, boolean)', 'biz_orgs_overview()'];
for (const fn of FNS) {
  for (const role of ['anon', 'authenticated']) assert.equal(await db.value(`has_function_privilege('${role}', 'public.${fn}', 'execute')`), false, `${role} cannot run ${fn}`);
  assert.equal(await db.value(`has_function_privilege('service_role', 'public.${fn}', 'execute')`), true, `service_role runs ${fn}`);
}
for (const t of ['business_orgs', 'business_api_keys', 'business_credit_ledger', 'business_requests']) {
  assert.equal(await db.value(`has_table_privilege('anon', 'public.${t}', 'select')`), false);
  assert.equal(await db.value(`(select relrowsecurity from pg_class where oid = 'public.${t}'::regclass)`), true, `${t} has RLS on`);
}
console.log('✓ service_role only, RLS on');

// ------------------------------------------------------- apply -> approve
const USE = 'We advise first-generation students on their aid offers and want accurate general answers.';
const org = await call('biz_apply', 'Acme Advising', 'Ops@Acme.example', 'https://acme.example', USE);
assert.match(org, /^[0-9a-f-]{36}$/);
await fails(`public.biz_apply('Other', 'ops@acme.example', null, ${lit(USE)})`, /already_applied/, 'one open application per email');
await fails(`public.biz_apply('X', 'not-an-email', null, ${lit(USE)})`, /check|violat/i, 'invalid email rejected');
await fails(`public.biz_apply('Valid Name', 'a@b.example', 'javascript:alert(1)', ${lit(USE)})`, /check|violat/i, 'website must be http(s)');
const KEY = 'fynq_test_AbCdEf' + randomBytes(16).toString('hex');
await fails(`public.biz_create_key(${lit(org)}, 'Prod', 'fynq_test_AbCdEf', ${lit(hash(KEY))}, false)`, /org_not_approved/, 'no keys before approval');
await call('biz_set_status', org, 'approved');
const keyId = await call('biz_create_key', org, 'Prod', 'fynq_test_AbCdEf', hash(KEY), false);
const principal = await call('biz_authenticate', hash(KEY));
assert.deepEqual({ ...principal, keyId: undefined }, { keyId: undefined, orgId: org, orgName: 'Acme Advising', orgStatus: 'approved', livemode: false });
assert.equal(await call('biz_authenticate', hash('fynq_test_wrong')), null, 'unknown key');
assert.equal(await call('biz_authenticate', 'not-a-hash'), null, 'malformed hash');
console.log('✓ apply, approve, issue key, authenticate by hash');

// ---------------------------------------------------------------- credits
const reserve = (idem = null, r = reqId()) => call('biz_reserve', org, keyId, r, 'POST /api/v1/answers', idem, 1).then((x) => ({ ...x, r }));
assert.deepEqual(await reserve().then(({ r, ...x }) => x), { result: 'insufficient', balance: 0 }, 'no credits, no charge');
assert.equal(await db.value(`(select count(*) from public.business_requests)`), 0, 'nothing recorded for a refused reserve');

const SESSION = 'cs_test_a1B2c3D4e5';
assert.deepEqual(await call('biz_grant_purchase', org, 3, SESSION, false), { granted: true, balance: 3 });
assert.deepEqual(await call('biz_grant_purchase', org, 3, SESSION, false), { granted: false, balance: 3 }, 'a webhook retry grants nothing');

const ok = await reserve();
assert.equal(ok.result, 'reserved');
assert.equal(ok.balance, 2);
assert.deepEqual(await call('biz_finish', ok.r, true, 200, 12, { answer: ['General info'] }), { balance: 2 }, 'success keeps the charge');

const bad = await reserve();
assert.deepEqual(await call('biz_finish', bad.r, false, 502, 30, null), { balance: 2 }, 'failure refunds');
assert.deepEqual(await call('biz_finish', bad.r, false, 502, 30, null), { balance: 2 }, 'refund happens once');
assert.equal(await db.value(`(select response from public.business_requests where request_id = ${lit(bad.r)})`), null, 'no stored answer for a failure');
console.log('✓ reserve, succeed, fail -> refund exactly once; purchase granted once per session');

// ------------------------------------------------------------ idempotency
const IDEM = 'order-7f3a-2026';
const first = await reserve(IDEM);
assert.equal(first.result, 'reserved');
assert.equal((await reserve(IDEM)).result, 'in_progress', 'same key while running');
await call('biz_finish', first.r, true, 200, 10, { answer: ['Cached answer'] });
const replay = await reserve(IDEM);
assert.equal(replay.result, 'replay');
assert.deepEqual(replay.response, { answer: ['Cached answer'] });
assert.equal(await call('biz_balance', org), 1, 'a replay is free');
const failedIdem = await reserve('retry-after-fail-01');
await call('biz_finish', failedIdem.r, false, 504, 9, null);
assert.equal((await reserve('retry-after-fail-01')).result, 'reserved', 'a failed attempt can be retried with the same key');
console.log('✓ Idempotency-Key: in progress, free replay, retry after failure');

// ------------------------------------------------------------ concurrency
await call('biz_adjust', org, 5, 'test grant');
const balanceBefore = await call('biz_balance', org);
const N = db.concurrent ? 40 : 6;
const results = await Promise.all(Array.from({ length: N }, () => db.valueAsync(`public.biz_reserve(${lit(org)}, ${lit(keyId)}, ${lit(reqId())}, 'POST /api/v1/answers', NULL, 1)`)));
const reserved = results.filter((x) => x.result === 'reserved').length;
assert.equal(reserved, Math.min(N, balanceBefore), `exactly ${balanceBefore} of ${N} parallel requests reserved`);
assert.equal(await call('biz_balance', org), Math.max(0, balanceBefore - N), 'never negative');
console.log(`✓ ${N} ${db.concurrent ? 'truly parallel' : 'sequential (PGlite)'} reserves never overspend`);

if (db.concurrent) {
  // Deterministic: while another connection holds this organization's lock,
  // a reserve must wait for it (the parallel test above can miss a race).
  await call('biz_adjust', org, 2, 'lock test');
  const holder = db.valueAsync(`(select 1 from (select pg_advisory_xact_lock(hashtextextended('biz:' || ${lit(org)}, 0)), pg_sleep(1.5)) x)`);
  await new Promise((r) => setTimeout(r, 300));
  const t = Date.now();
  await db.valueAsync(`public.biz_reserve(${lit(org)}, ${lit(keyId)}, ${lit(reqId())}, 'POST /api/v1/answers', NULL, 1)`);
  const waited = Date.now() - t; // measured before awaiting the holder
  await holder;
  assert.ok(waited >= 900, `reserve waited for the organization lock (${waited} ms)`);
  console.log('✓ reserve takes the per-organization lock');
}

// ----------------------------------------------------- status and limits
await fails(`public.biz_adjust(${lit(org)}, -1000, 'too much')`, /balance_would_go_negative/, 'adjustment cannot go negative');
await call('biz_set_status', org, 'suspended');
assert.equal((await reserve()).result, 'org_inactive', 'suspended orgs are refused');
assert.equal((await call('biz_authenticate', hash(KEY))).orgStatus, 'suspended', 'status is visible to the gateway');
await call('biz_set_status', org, 'approved');
assert.equal(await call('biz_revoke_key', keyId), true);
assert.equal(await call('biz_revoke_key', keyId), false, 'revoking twice is a no-op');
assert.equal(await call('biz_authenticate', hash(KEY)), null, 'revoked keys stop working immediately');
console.log('✓ suspension, revocation, no negative adjustments');

// ------------------------------------------------------------------ views
const overview = await call('biz_orgs_overview');
assert.equal(overview.length, 1);
assert.equal(overview[0].creditsPurchased, 3);
const keys = await call('biz_org_keys', org);
assert.equal(keys.length, 1);
assert.ok(keys[0].revokedAt);
const account = await call('biz_account', org);
assert.equal(account.name, 'Acme Advising');
assert.equal(typeof account.balance, 'number');
const text = JSON.stringify({ overview, keys, account });
assert.doesNotMatch(text, new RegExp(hash(KEY)), 'key hashes never leave the database');
assert.doesNotMatch(text, /fynq_test_AbCdEf[0-9a-f]{8}/, 'no secret keys');
console.log('✓ console and account views expose no key material');

await db.close();
console.log('\nbusiness integration: all checks passed');
