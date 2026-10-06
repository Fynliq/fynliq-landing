// FYNLIQ Intelligence: deterministic engine, snapshot and sanitizer.
//   node --test test/intelligence-engine.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  percentChange, safeRate, reliabilityOf, buildWindows, rankBottlenecks, rankBiggestChanges, round,
} from '../server/intelligence/metrics.js';
import { buildSnapshot, sumDays, cleanWindowRow } from '../server/intelligence/snapshot.js';
import { sanitizeForModel, prepareModelInput, SanitizationError } from '../server/intelligence/sanitize.js';
import { SCENARIOS, scenarioRpc, NOW, LONG_HISTORY, row } from './fixtures/intelligence-scenarios.mjs';

test('percentChange never returns Infinity or NaN', () => {
  assert.deepEqual(percentChange(0, 0), { changePercent: 0, direction: 'flat', reason: null });
  assert.deepEqual(percentChange(5, 0), { changePercent: null, direction: 'up', reason: 'base_zero' });
  assert.deepEqual(percentChange(18, 27), { changePercent: -33.3, direction: 'down', reason: null });
  assert.equal(percentChange(null, 4).changePercent, null);
  assert.equal(percentChange(NaN, 4).reason, 'missing');
});

test('safeRate guards zero and missing denominators', () => {
  assert.equal(safeRate(1, 0), null);
  assert.equal(safeRate(1, null), null);
  assert.equal(safeRate(2, 3), 0.6667);
  assert.equal(round(Infinity), null);
});

test('reliability thresholds', () => {
  assert.equal(reliabilityOf(3), 'very_small');
  assert.equal(reliabilityOf(29), 'small');
  assert.equal(reliabilityOf(30), 'ok');
  assert.equal(reliabilityOf(null), 'unavailable');
});

test('windows are complete UTC days, with a like-for-like today-so-far window', () => {
  const plan = buildWindows(new Date('2026-10-06T15:30:00Z'), 'day');
  assert.deepEqual(plan.windows.current, { start: '2026-10-05T00:00:00.000Z', end: '2026-10-06T00:00:00.000Z', days: 1 });
  assert.equal(plan.windows.previous.start, '2026-10-04T00:00:00.000Z');
  assert.equal(plan.windows.trailing7.start, '2026-09-28T00:00:00.000Z');
  assert.equal(plan.windows.trailing30.start, '2026-09-05T00:00:00.000Z');
  assert.equal(plan.windows.today.end, '2026-10-06T15:30:00.000Z');
  assert.equal(plan.windows.yesterday_same_time.end, '2026-10-05T15:30:00.000Z');
  const week = buildWindows(new Date('2026-10-06T15:30:00Z'), 'week');
  assert.equal(week.windows.current.start, '2026-09-29T00:00:00.000Z');
  assert.equal(week.windows.previous.start, '2026-09-22T00:00:00.000Z');
  assert.equal(buildWindows(new Date(), 'nonsense').period, 'day');
});

test('trailing counts are normalised to the period length; rates are pooled', async () => {
  const s = await buildSnapshot({ rpc: scenarioRpc(SCENARIOS[0]), now: NOW });
  const visitors = s.comparisons.find((c) => c.metric === 'newVisitors');
  assert.equal(visitors.current, 200);
  assert.equal(visitors.previous.value, 120);
  assert.equal(visitors.trailing7.value, 120); // 840 over 7 days -> 120 per 1-day period
  assert.equal(visitors.previous.changePercent, 66.7);
  const v2s = s.comparisons.find((c) => c.metric === 'visitorToSignup');
  assert.equal(v2s.current, 0.02);
  assert.equal(v2s.trailing7.value, 0.1); // 84/840 pooled
  assert.equal(v2s.previous.changePercent, -80);
});

test('metrics recorded only since mid-window are not compared (no fake growth)', async () => {
  const history = { ...LONG_HISTORY, first_funnel_event_at: '2026-10-04T12:00:00Z' };
  const scenario = { data: { history, windows: { current: row({ checkout_accounts: 9 }), previous: row({ checkout_accounts: 1 }), trailing7: row(), trailing30: row(), today: row(), yesterday_same_time: row() } } };
  const s = await buildSnapshot({ rpc: scenarioRpc(scenario), now: NOW });
  const checkouts = s.comparisons.find((c) => c.metric === 'checkoutStarts');
  assert.equal(checkouts.previous.reason, 'insufficient_history');
  assert.equal(checkouts.previous.changePercent, null);
  assert.ok(!s.candidates.biggestChanges.some((c) => c.metric === 'checkoutStarts'));
});

test('bottleneck ranking: deteriorating steps first, then people lost; needs a minimum denominator', () => {
  const step = (metric, current, num, den, base) => ({ metric, kind: 'rate', label: metric, current, numerator: num, denominator: den, reliability: reliabilityOf(den), trailing7: base === null ? null : { value: base, sampleSize: 40, changePercent: percentChange(current, base).changePercent }, previous: null });
  const r = rankBottlenecks([
    step('visitorToSignup', 0.1, 10, 100, 0.1),
    step('signupToUpload', 0.5, 5, 10, 0.5),
    step('uploadToCheckout', 0.2, 2, 10, 0.5),
    step('checkoutToPayment', 0, 0, 2, 0.5),
  ]);
  assert.equal(r.primary, 'uploadToCheckout');
  assert.equal(r.ranked.find((c) => c.stage === 'checkoutToPayment').eligible, false);
  const none = rankBottlenecks([step('visitorToSignup', 0.5, 2, 4, 0.5)]);
  assert.equal(none.primary, 'insufficient_data');
});

test('biggest changes: reliable movements outrank low-volume ones; base-zero excluded', () => {
  const count = (metric, current, base) => ({ metric, kind: 'count', label: metric, current, previous: { value: base, ...percentChange(current, base) } });
  const ranked = rankBiggestChanges([count('a', 3, 1), count('b', 60, 40), count('c', 5, 0)]);
  assert.deepEqual(ranked.map((r) => r.metric), ['b', 'a']);
  assert.equal(ranked[0].reliability, 'ok');
  assert.equal(ranked[1].reliability, 'low_sample');
});

test('fallback: only per-day series are read; emails and ids never reach the snapshot', async () => {
  const s = await buildSnapshot({ rpc: scenarioRpc(SCENARIOS.find((x) => x.id === 'missing_payment_data')), now: NOW });
  assert.equal(s.dataSource, 'fallback');
  assert.equal(s.traffic.visitors, 130);
  assert.equal(s.funnel.signups, 11);
  assert.equal(s.funnel.uploads, 10);
  assert.equal(s.quality.uploadsFailed, 2);
  assert.equal(s.funnel.payments, null);
  assert.equal(s.revenue.gross, null);
  assert.equal(s.todaySoFar, null);
  const serialized = JSON.stringify(s);
  assert.ok(!serialized.includes('@'), 'no email in snapshot');
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(serialized), 'no ids in snapshot');
  assert.ok(s.dataQualityWarnings.some((w) => w.includes('migration is not applied')));
});

test('sumDays respects [start, end) and ignores junk rows', () => {
  const series = [{ period: '2026-10-04', n: 2 }, { period: '2026-10-05', n: 3 }, { period: 'bad', n: 99 }, null];
  assert.equal(sumDays(series, 'n', '2026-10-05T00:00:00Z', '2026-10-06T00:00:00Z'), 3);
  assert.equal(sumDays(null, 'n', '2026-10-05T00:00:00Z', '2026-10-06T00:00:00Z'), null);
});

test('cleanWindowRow drops unknown fields and unknown channels', () => {
  const r = cleanWindowRow({ new_visitors: 3, email: 'x@y.z', visitors_by_channel: { tiktok: 2, 'evil<script>': 5 } });
  assert.deepEqual(r, { new_visitors: 3, visitors_by_channel: { tiktok: 2, instagram: 0, facebook: 0, google: 0, referral: 0, direct: 0, other: 0 } });
});

test('sanitizer drops emails, UUIDs, long digit runs and odd keys', () => {
  const { value, dropped } = sanitizeForModel({ a: 'ok', b: 'me@x.com', c: '1234567890', d: '7c9e6679-7425-40de-944b-e07fc1f90ae7', 'bad key': 1, e: [1, 'fine'], f: Infinity });
  assert.deepEqual(value, { a: 'ok', e: [1, 'fine'], f: null });
  assert.equal(dropped.length, 4);
});

test('every scenario snapshot passes sanitization and the privacy gate (no false positives)', async () => {
  for (const sc of SCENARIOS) {
    const s = await buildSnapshot({ rpc: scenarioRpc(sc), now: NOW });
    const { value, serialized } = prepareModelInput(s);
    assert.ok(value.comparisons.length > 0, sc.id);
    assert.ok(!serialized.includes('@'), sc.id);
  }
});

test('prepareModelInput fails closed when PII-like data appears', async () => {
  const s = await buildSnapshot({ rpc: scenarioRpc(SCENARIOS[0]), now: NOW });
  s.dataQualityWarnings.push('contact student@example.com');
  assert.throws(() => prepareModelInput(s), SanitizationError);
  const t = await buildSnapshot({ rpc: scenarioRpc(SCENARIOS[0]), now: NOW });
  t.dataQualityWarnings.push('SSN 123-45-6789');
  assert.throws(() => prepareModelInput(t), (e) => e instanceof SanitizationError && e.reason === 'privacy_blocked');
});
