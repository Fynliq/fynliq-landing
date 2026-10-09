// FYNQ Business API database layer against a real Postgres running every
// migration. Synthetic data only; no network, no production.
//
// Proves: service_role-only access; the application -> approval -> key flow;
// key authentication by hash (revoked keys fail); credits that can't go
// negative or be double-spent (including under real concurrency on Postgres);
// refunds exactly once; Stripe purchases granted once per session;
// Idempotency-Key replays without a second charge (same question, 24 h only);
// test and live credits kept apart; stale reservations swept and refunded;
// Stripe refunds and disputes reversed; no secrets in views.
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
  'biz_reserve(uuid, uuid, text, text, text, text, integer, boolean)', 'biz_grant_purchase(uuid, integer, text, text, boolean)',
  'biz_reverse_purchase(text, bigint, bigint, boolean, boolean)', 'biz_adjust(uuid, integer, text, boolean)', 'biz_account(uuid, boolean)', 'biz_orgs_overview()'];
for (const fn of FNS) {
  for (const role of ['anon', 'authenticated']) assert.equal(await db.value(`has_function_privilege('${role}', 'public.${fn}', 'execute')`), false, `${role} cannot run ${fn}`);
  assert.equal(await db.value(`has_function_privilege('service_role', 'public.${fn}', 'execute')`), true, `service_role runs ${fn}`);
}
for (const t of ['business_orgs', 'business_api_keys', 'business_credit_ledger', 'business_requests']) {
  assert.equal(await db.value(`has_table_privilege('anon', 'public.${t}', 'select')`), false);
  assert.equal(await db.value(`(select relrowsecurity from pg_class where oid = 'public.${t}'::regclass)`), true, `${t} has RLS on`);
}
for (const role of ['anon', 'authenticated']) assert.equal(await db.value(`has_sequence_privilege('${role}', 'public.business_credit_ledger_id_seq', 'usage')`), false, `${role} has no sequence access`);
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
const FP = hash('What is a Pell Grant?');
const reserve = (idem = null, r = reqId(), live = false, fp = FP) => call('biz_reserve', org, keyId, r, 'POST /api/v1/answers', idem, fp, 1, live).then((x) => ({ ...x, r }));
const bal = (live = false) => call('biz_balance', org, live);
assert.deepEqual(await reserve().then(({ r, ...x }) => x), { result: 'insufficient', balance: 0 }, 'no credits, no charge');
assert.equal(await db.value(`(select count(*) from public.business_requests)`), 0, 'nothing recorded for a refused reserve');

const SESSION = 'cs_test_a1B2c3D4e5';
assert.deepEqual(await call('biz_grant_purchase', org, 3, SESSION, 'pi_test1', false), { granted: true, balance: 3 });
assert.deepEqual(await call('biz_grant_purchase', org, 3, SESSION, 'pi_test1', false), { granted: false, balance: 3 }, 'a webhook retry grants nothing');

const ok = await reserve();
assert.equal(ok.result, 'reserved');
assert.equal(ok.balance, 2);
assert.deepEqual(await call('biz_finish', ok.r, true, 200, 12, { answer: ['General info'] }), { balance: 2, state: 'succeeded' }, 'success keeps the charge');

const bad = await reserve();
assert.deepEqual(await call('biz_finish', bad.r, false, 502, 30, null), { balance: 2, state: 'failed' }, 'failure refunds');
assert.deepEqual(await call('biz_finish', bad.r, false, 502, 30, null), { balance: 2, state: 'failed' }, 'refund happens once');
assert.deepEqual(await call('biz_finish', ok.r, false, 502, 30, null), { balance: 2, state: 'succeeded' }, 'a late failure cannot refund a success');
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
assert.equal(replay.balance, 1, 'a replay reports the current balance');
assert.equal(await bal(), 1, 'a replay is free');
assert.equal((await reserve(IDEM, reqId(), false, hash('A different question'))).result, 'mismatch', 'same key, different question');
assert.equal((await reserve(IDEM, reqId(), true)).result, 'insufficient', 'idempotency keys are per mode');
await db.exec(`update public.business_requests set finished_at = now() - interval '25 hours' where request_id = ${lit(first.r)}`);
await call('biz_finish', ok.r, true, 200, 1, null); // any finish runs the global purge
assert.equal(await db.value(`(select response from public.business_requests where request_id = ${lit(first.r)})`), null, 'answers erased after 24 h');
await call('biz_adjust', org, 1, 'replay window', false);
assert.equal((await reserve(IDEM)).result, 'reserved', 'after 24 h the key is a fresh request, not a replay');
const failedIdem = await reserve('retry-after-fail-01');
await call('biz_finish', failedIdem.r, false, 504, 9, null);
assert.equal((await reserve('retry-after-fail-01')).result, 'reserved', 'a failed attempt can be retried with the same key');
console.log('✓ Idempotency-Key: in progress, free replay for the same question, per mode, 24 h, retry after failure');

// ------------------------------------------------------------ sweeper
await call('biz_adjust', org, 2, 'sweep test', false);
const before = await bal();
const stuck = await reserve('stuck-request-01');
assert.equal(await bal(), before - 1);
assert.equal((await reserve('stuck-request-01')).result, 'in_progress');
await db.exec(`update public.business_requests set created_at = now() - interval '3 minutes' where request_id = ${lit(stuck.r)}`);
const after = await reserve('stuck-request-01');
assert.equal(after.result, 'reserved', 'a stale reservation releases its Idempotency-Key');
assert.equal(await db.value(`(select state from public.business_requests where request_id = ${lit(stuck.r)})`), 'failed');
assert.equal(await bal(), before - 1, 'the stale credit was refunded (one new charge only)');
assert.deepEqual(await call('biz_finish', stuck.r, true, 200, 1, { late: true }), { balance: before - 1, state: 'failed' }, 'a late success cannot re-charge a swept request');
await call('biz_finish', after.r, true, 200, 1, { answer: ['x'] });
console.log('✓ stale reservations are failed, refunded and release their key');

// ------------------------------------------------------- test vs live
const testBefore = await bal(false);
assert.deepEqual(await reserve(null, reqId(), true).then(({ r, ...x }) => x), { result: 'insufficient', balance: 0 }, 'test credits never pay for live use');
assert.deepEqual(await call('biz_grant_purchase', org, 5, 'cs_live_x9Y8z7', 'pi_live1', true), { granted: true, balance: 5 });
assert.equal(await bal(false), testBefore, 'live purchases never reach the test balance');
const live = await reserve(null, reqId(), true);
assert.equal(live.balance, 4);
await call('biz_finish', live.r, false, 503, 1, null);
assert.equal(await bal(true), 5, 'live refunds go back to the live balance');
assert.equal(await bal(false), testBefore);
console.log('✓ test and live credits are separate ledgers');

// --------------------------------------------- Stripe refunds and disputes
assert.deepEqual(await call('biz_reverse_purchase', 'pi_unknown', 100, 100, true, false), { result: 'no_purchase' });
assert.deepEqual(await call('biz_reverse_purchase', 'pi_live1', 100, 100, false, false), { result: 'no_purchase' }, 'mode must match');
assert.equal((await call('biz_reverse_purchase', 'pi_live1', 2000, 4900, true, false)).credits, 3, 'partial refund: ceil(5 x 2000/4900) = 3');
assert.equal((await call('biz_reverse_purchase', 'pi_live1', 2000, 4900, true, false)).credits, 0, 'the same refund event twice reverses nothing more');
assert.equal((await call('biz_reverse_purchase', 'pi_live1', 4900, 4900, true, false)).credits, 2, 'full refund reverses the rest');
assert.equal(await bal(true), 0);
assert.equal((await call('biz_reverse_purchase', 'pi_live1', 4900, 4900, true, true)).credits, 0, 'a dispute after a full refund takes nothing more');
assert.equal((await call('biz_authenticate', hash(KEY))).orgStatus, 'suspended', 'a dispute suspends the organization');
await call('biz_set_status', org, 'approved');
assert.deepEqual(await call('biz_grant_purchase', org, 4, 'cs_live_spent1', 'pi_live2', true), { granted: true, balance: 4 });
for (let i = 0; i < 4; i += 1) { const x = await reserve(null, reqId(), true); await call('biz_finish', x.r, true, 200, 1, { a: 1 }); }
assert.equal((await call('biz_reverse_purchase', 'pi_live2', 0, 4900, true, true)).balance, -4, 'credits already spent leave a negative balance after a dispute');
assert.equal((await reserve(null, reqId(), true)).result, 'org_inactive');
await call('biz_set_status', org, 'approved');
assert.equal((await reserve(null, reqId(), true)).result, 'insufficient', 'a negative balance blocks spending');
console.log('✓ refunds and disputes take credits back, cumulatively and once');

// ------------------------------------------------------------ concurrency
await call('biz_adjust', org, 5, 'test grant', false);
const balanceBefore = await bal();
const N = db.concurrent ? 40 : 6;
const reserveSql = () => `public.biz_reserve(${lit(org)}, ${lit(keyId)}, ${lit(reqId())}, 'POST /api/v1/answers', NULL, ${lit(FP)}, 1, false)`;
const results = await Promise.all(Array.from({ length: N }, () => db.valueAsync(reserveSql())));
const reserved = results.filter((x) => x.result === 'reserved').length;
assert.equal(reserved, Math.min(N, balanceBefore), `exactly ${balanceBefore} of ${N} parallel requests reserved`);
assert.equal(await bal(), Math.max(0, balanceBefore - N), 'never negative');
console.log(`✓ ${N} ${db.concurrent ? 'truly parallel' : 'sequential (PGlite)'} reserves never overspend`);

if (db.concurrent) {
  // Deterministic: while another connection holds this organization's lock,
  // a reserve must wait for it (the parallel test above can miss a race).
  await call('biz_adjust', org, 2, 'lock test', false);
  const holder = db.valueAsync(`(select 1 from (select pg_advisory_xact_lock(hashtextextended('biz:' || ${lit(org)}, 0)), pg_sleep(1.5)) x)`);
  await new Promise((r) => setTimeout(r, 300));
  const t = Date.now();
  await db.valueAsync(reserveSql());
  const waited = Date.now() - t; // measured before awaiting the holder
  await holder;
  assert.ok(waited >= 900, `reserve waited for the organization lock (${waited} ms)`);
  console.log('✓ reserve takes the per-organization lock');
}

// ----------------------------------------------------- status and limits
await fails(`public.biz_adjust(${lit(org)}, -1000, 'too much', false)`, /balance_would_go_negative/, 'adjustment cannot go negative');
// Re-approving a rejected org whose email has a newer open application gives a clear error.
const org2 = await call('biz_apply', 'Beta Org', 'beta@b.example', null, USE);
await call('biz_set_status', org2, 'rejected');
await call('biz_apply', 'Beta Org Again', 'beta@b.example', null, USE);
await fails(`public.biz_set_status(${lit(org2)}, 'approved')`, /email_in_use/, 'email still unique among open orgs');
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
assert.equal(overview.length, 3);
const acme = overview.find((o) => o.id === org);
assert.equal(acme.creditsPurchased, 9, 'live purchases only (5 + 4)');
assert.equal(acme.creditsReversed, 9);
assert.equal(typeof acme.testBalance, 'number');
const keys = await call('biz_org_keys', org);
assert.equal(keys.length, 1);
assert.ok(keys[0].revokedAt);
const account = await call('biz_account', org, false);
assert.equal(account.name, 'Acme Advising');
assert.equal(typeof account.balance, 'number');
const text = JSON.stringify({ overview, keys, account });
assert.doesNotMatch(text, new RegExp(hash(KEY)), 'key hashes never leave the database');
assert.doesNotMatch(text, /fynq_test_AbCdEf[0-9a-f]{8}/, 'no secret keys');
console.log('✓ console and account views expose no key material');

await db.close();
console.log('\nbusiness integration: all checks passed');
