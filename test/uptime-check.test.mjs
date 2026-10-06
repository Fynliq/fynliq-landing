// Unit tests for scripts/uptime-check.mjs with a fake fetch: no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHECKS, runChecks } from '../scripts/uptime-check.mjs';

const HEALTHY = {
  '/': [200, '<script type="module" src="/assets/index-AbC_12-x.js"></script>'],
  '/api/beta-auth': [200, '{"user":null,"admin":false}'],
  '/api/auth/session': [401, 'Not logged in.'],
  '/api/auth/login': [405, 'Use POST.'],
  '/api/billing': [200, '{"paywallEnabled":false,"access":"open"}'],
  '/api/analyze': [404, '{"error":"none"}'],
  '/api/stripe-webhook': [405, 'Use POST.'],
};

function fakeFetch(overrides = {}, calls = []) {
  return async (url) => {
    const path = new URL(url).pathname;
    calls.push(path);
    const spec = overrides[path] ?? HEALTHY[path];
    if (spec instanceof Error) throw spec;
    const [status, body, headers = {}] = spec;
    return { status, text: async () => body, headers: { get: (k) => headers[k.toLowerCase()] ?? null } };
  };
}

const quiet = () => {};

test('a healthy site passes every check', async () => {
  const { ok, results } = await runChecks({ fetchImpl: fakeFetch(), retryDelayMs: 0, log: quiet });
  assert.equal(ok, true);
  assert.equal(results.length, CHECKS.length);
  assert.ok(results.every((r) => r.result.state === 'up'));
});

test('a missing-config 503 on an API fails the run after one retry', async () => {
  const calls = [];
  const { ok, results } = await runChecks({
    fetchImpl: fakeFetch({ '/api/beta-auth': [503, 'Fynliq is temporarily unavailable.'] }, calls),
    retryDelayMs: 0, log: quiet,
  });
  assert.equal(ok, false);
  const r = results.find((x) => x.check.path === '/api/beta-auth').result;
  assert.equal(r.state, 'down');
  assert.equal(r.retried, true);
  assert.equal(calls.filter((p) => p === '/api/beta-auth').length, 2);
});

test('the landing page without the app bundle counts as down', async () => {
  const { ok } = await runChecks({ fetchImpl: fakeFetch({ '/': [200, '<html>Deployment not found</html>'] }), retryDelayMs: 0, log: quiet });
  assert.equal(ok, false);
});

test('network errors and timeouts count as down', async () => {
  const { ok, results } = await runChecks({ fetchImpl: fakeFetch({ '/api/billing': new TypeError('fetch failed') }), retryDelayMs: 0, log: quiet });
  assert.equal(ok, false);
  assert.equal(results.find((x) => x.check.path === '/api/billing').result.state, 'down');
});

test('a Vercel bot challenge is inconclusive, not down', async () => {
  const challenge = [403, 'challenge', { 'x-vercel-mitigated': 'challenge' }];
  const { ok, results } = await runChecks({ fetchImpl: fakeFetch({ '/api/analyze': challenge }), retryDelayMs: 0, log: quiet });
  assert.equal(ok, true);
  assert.equal(results.find((x) => x.check.path === '/api/analyze').result.state, 'inconclusive');
});

test('if every check is challenged the run fails, because nothing was verified', async () => {
  const challenge = [403, 'challenge', { 'x-vercel-mitigated': 'challenge' }];
  const all = Object.fromEntries(Object.keys(HEALTHY).map((p) => [p, challenge]));
  const { ok } = await runChecks({ fetchImpl: fakeFetch(all), retryDelayMs: 0, log: quiet });
  assert.equal(ok, false);
});

test('a plain-text NOT_FOUND from a missing reader function is down, not up', async () => {
  const { ok, results } = await runChecks({ fetchImpl: fakeFetch({ '/api/analyze': [404, 'The page could not be found NOT_FOUND'] }), retryDelayMs: 0, log: quiet });
  assert.equal(ok, false);
  assert.equal(results.find((x) => x.check.path === '/api/analyze').result.state, 'down');
});

test('the reader behind a log-in paywall (401) is up', async () => {
  const { ok } = await runChecks({ fetchImpl: fakeFetch({ '/api/analyze': [401, 'Please log in to continue.'] }), retryDelayMs: 0, log: quiet });
  assert.equal(ok, true);
});

test('a missing config 503 on log-in is down', async () => {
  const { ok } = await runChecks({ fetchImpl: fakeFetch({ '/api/auth/login': [503, 'Fynliq is temporarily unavailable.'] }), retryDelayMs: 0, log: quiet });
  assert.equal(ok, false);
});

test('failure notes never echo response bodies into public logs', async () => {
  const { results } = await runChecks({ fetchImpl: fakeFetch({ '/api/billing': [500, 'SECRET-LOOKING internal detail'] }), retryDelayMs: 0, log: quiet });
  assert.ok(!JSON.stringify(results).includes('SECRET-LOOKING'));
});

test('a webhook route that stops refusing GET is flagged', async () => {
  const { ok } = await runChecks({ fetchImpl: fakeFetch({ '/api/stripe-webhook': [404, 'NOT_FOUND'] }), retryDelayMs: 0, log: quiet });
  assert.equal(ok, false);
});

test('every probe is an anonymous GET', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push(init); return fakeFetch()(url); };
  await runChecks({ fetchImpl, retryDelayMs: 0, log: quiet });
  assert.ok(seen.every((init) => init.method === 'GET' && !('cookie' in (init.headers || {})) && !('Cookie' in (init.headers || {})) && !init.body));
});
