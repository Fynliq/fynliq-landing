// FYNLIQ Intelligence: comparison edge cases and validator gaps, derived
// from the requirement (not the implementation).
//   node --test test/intelligence-edge-cases.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot } from '../server/intelligence/snapshot.js';
import { prepareModelInput } from '../server/intelligence/sanitize.js';
import { validateBrief } from '../server/intelligence/schema.js';
import { validationContext } from '../server/intelligence/analyst.js';
import { SCENARIOS, scenarioRpc, NOW, row, LONG_HISTORY } from './fixtures/intelligence-scenarios.mjs';
import { referenceBrief } from './fixtures/reference-brief.mjs';

const world = (windows, history = LONG_HISTORY) => ({ data: { history, windows: { current: row(), previous: row(), trailing7: row(), trailing30: row(), today: row(), yesterday_same_time: row(), ...windows } } });
const snapshotOf = (sc, period = 'day') => buildSnapshot({ rpc: scenarioRpc(sc), now: NOW, period });
const metric = (s, key) => s.comparisons.find((c) => c.metric === key);
const noNaN = (s) => assert.doesNotMatch(JSON.stringify(s), /NaN|Infinity/);

test('today so far vs yesterday at the same time: counts, base-zero and flat-zero handled', async () => {
  const s = await snapshotOf(world({ today: row({ new_visitors: 6, signups: 3 }), yesterday_same_time: row({ new_visitors: 4 }) }));
  noNaN(s);
  const by = Object.fromEntries(s.todaySoFar.metrics.map((m) => [m.metric, m]));
  assert.deepEqual(by.newVisitors, { metric: 'newVisitors', today: 6, yesterdaySameTime: 4, changePercent: 50, direction: 'up', reason: null });
  assert.equal(by.signups.changePercent, null, 'no percentage from a zero base');
  assert.equal(by.signups.reason, 'base_zero');
  assert.equal(by.payments.changePercent, 0);
  assert.equal(s.todaySoFar.partial, true);
  assert.equal(s.todaySoFar.asOf, NOW.toISOString());
  assert.equal(s.todaySoFar.since, '2026-10-06T00:00:00.000Z');
});

test('week period: previous is the prior 7 days; trailing 30 is normalised to 7 days; rates pooled', async () => {
  const s = await snapshotOf(world({
    current: row({ new_visitors: 140, new_visitors_signed_up: 14 }),
    previous: row({ new_visitors: 70, new_visitors_signed_up: 14 }),
    trailing7: row({ new_visitors: 70, new_visitors_signed_up: 7 }),
    trailing30: row({ new_visitors: 300, new_visitors_signed_up: 15 }),
  }), 'week');
  const v = metric(s, 'newVisitors');
  assert.equal(s.period.days, 7);
  assert.equal(v.previous.value, 70);
  assert.equal(v.previous.changePercent, 100);
  assert.equal(v.trailing7.value, 70, '7-day total over a 7-day period is unchanged');
  assert.equal(v.trailing30.value, 70, '300 over 30 days -> 70 per 7-day period');
  const r = metric(s, 'visitorToSignup');
  assert.equal(r.current, 0.1);
  assert.equal(r.previous.value, 0.2);
  assert.equal(r.previous.changePercent, -50);
  assert.equal(r.trailing30.value, 0.05, 'pooled 15/300, not normalised');
});

test('a rate whose previous denominator is 0 has no change percentage and no NaN', async () => {
  const s = await snapshotOf(world({ current: row({ checkout_accounts: 8, checkout_then_paid_accounts: 4 }) }));
  noNaN(s);
  const r = metric(s, 'checkoutToPayment');
  assert.equal(r.current, 0.5);
  assert.equal(r.previous.value, null);
  assert.equal(r.previous.changePercent, null);
  assert.equal(r.previous.reason, 'no_denominator');
  assert.ok(!s.candidates.biggestChanges.some((c) => c.metric === 'checkoutToPayment'));
});

test('a metric never recorded (no history marker) is not compared and cannot become the biggest change', async () => {
  const s = await snapshotOf(world({ current: row({ checkout_accounts: 40 }), previous: row({ checkout_accounts: 10 }) }, { ...LONG_HISTORY, first_funnel_event_at: null }));
  const c = metric(s, 'checkoutStarts');
  assert.ok(c.notes.includes('tracking_started_during_period'));
  assert.equal(c.previous.reason, 'insufficient_history');
  assert.ok(!s.candidates.biggestChanges.some((x) => x.metric === 'checkoutStarts'));
});

test('missing payment data: every payment/revenue figure is null (never 0) and listed as unavailable', async () => {
  const s = await snapshotOf(SCENARIOS.find((x) => x.id === 'missing_payment_data'));
  assert.equal(s.funnel.payments, null);
  assert.equal(s.funnel.checkoutStarts, null);
  assert.equal(s.revenue.gross, null);
  assert.equal(s.revenue.grossCents, null);
  assert.equal(s.conversion.checkoutToPayment, null);
  for (const m of ['payments', 'revenueCents', 'checkoutStarts', 'failedPayments', 'checkoutToPayment', 'uploadToCheckout']) {
    assert.ok(s.unavailable.some((u) => u.metric === m), `${m} unavailable`);
  }
  assert.ok(s.unavailable.some((u) => u.metric === 'sessions' && u.reason === 'not_tracked'));
});

test('ordinary or low-volume moves are not reported as anomalies (extreme case: evals extreme_anomaly)', async () => {
  const calm = await snapshotOf(world({ current: row({ new_visitors: 130 }), previous: row({ new_visitors: 120 }) }));
  assert.ok(!calm.dataQualityWarnings.some((w) => w.startsWith('Possible anomaly')));
  const tiny = await snapshotOf(world({ current: row({ new_visitors: 8 }), previous: row({ new_visitors: 1 }) }));
  assert.ok(!tiny.dataQualityWarnings.some((w) => w.startsWith('Possible anomaly')), '1 -> 8 is low volume, not an anomaly');
  assert.equal(tiny.candidates.biggestChanges[0].reliability, 'low_sample');
});

// ------------------------------------------------- "no invented numbers"

test('validator rejects numbers invented in words or multipliers, not only in digits', async () => {
  const s = await snapshotOf(SCENARIOS.find((x) => x.id === 'uploads_up_checkout_collapse'));
  const ctx = validationContext(s, prepareModelInput(s).value);
  const invented = [
    'Fixing this step could double revenue.',
    'Expect roughly five hundred extra sign-ups next week.',
    'Payments will triple within a month.',
  ];
  const accepted = invented.filter((sentence) => {
    const b = referenceBrief(s); b.recommendedAction.reason = `${b.recommendedAction.reason} ${sentence}`;
    return validateBrief(b, ctx).valid;
  });
  assert.deepEqual(accepted, [], `invented projections accepted by the validator: ${accepted.join(' | ')}`);
});
