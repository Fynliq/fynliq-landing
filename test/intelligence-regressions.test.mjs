// FYNLIQ Intelligence: regression tests for defects found in independent
// review (code-review-agent, qa-agent, security-agent). Each test fails on the
// code before the fix.
//   node --test test/intelligence-regressions.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot } from '../server/intelligence/snapshot.js';
import { prepareModelInput } from '../server/intelligence/sanitize.js';
import { validateBrief, inventedQuantities, allowedNumbers, stripPeriodDates } from '../server/intelligence/schema.js';
import { validationContext, runAnalyst, MIN_ATTEMPT_MS } from '../server/intelligence/analyst.js';
import { handleIntelligence } from '../server/intelligence/handler.js';
import { SCENARIOS, scenarioRpc, NOW, row, LONG_HISTORY } from './fixtures/intelligence-scenarios.mjs';
import { referenceBrief } from './fixtures/reference-brief.mjs';

const world = (windows) => ({ data: { history: LONG_HISTORY, windows: { current: row(), previous: row(), trailing7: row(), trailing30: row(), today: row(), yesterday_same_time: row(), ...windows } } });
const metric = (s, key) => s.comparisons.find((c) => c.metric === key);
const clone = (x) => JSON.parse(JSON.stringify(x));

test('a steady business with lagged conversions is not reported as deteriorating (cohort window length bias)', async () => {
  // Every day: 100 new visitors; 10 sign up the same day, 5 more the next day.
  // A 1-day window sees 10/100; a 7-day window sees 100/700 because most of
  // its cohort had time to convert. Nothing changed, so nothing may "fall".
  const day = { new_visitors: 100, new_visitors_signed_up: 10, signups: 15 };
  const s = await buildSnapshot({ rpc: scenarioRpc(world({
    current: row(day), previous: row(day),
    trailing7: row({ new_visitors: 700, new_visitors_signed_up: 100, signups: 105 }),
    trailing30: row({ new_visitors: 3000, new_visitors_signed_up: 445, signups: 450 }),
  })), now: NOW });
  const v2s = metric(s, 'visitorToSignup');
  assert.equal(v2s.current, 0.1);
  assert.equal(v2s.previous.changePercent, 0, 'like-for-like day vs day: flat');
  assert.equal(v2s.trailing7.value, 0.1429, 'longer-window rate kept for context');
  assert.equal(v2s.trailing7.changePercent, null, 'but never compared');
  assert.equal(v2s.trailing7.reason, 'different_window_length');
  assert.equal(v2s.trailing30.reason, 'different_window_length');
  const b = s.candidates.bottlenecks.find((x) => x.stage === 'visitorToSignup');
  assert.equal(b.deteriorating, false);
  assert.equal(b.baselineWindow, 'previous');
  assert.equal(b.reason, 'most people lost at this step');
  assert.ok(!s.candidates.biggestChanges.some((c) => c.metric === 'visitorToSignup'));
});

test('week period: trailing 7 days is the same length, so it stays a valid rate baseline', async () => {
  const wk = { new_visitors: 700, new_visitors_signed_up: 70 };
  const s = await buildSnapshot({ rpc: scenarioRpc(world({ current: row({ new_visitors: 700, new_visitors_signed_up: 35 }), previous: row(wk), trailing7: row(wk), trailing30: row({ new_visitors: 3000, new_visitors_signed_up: 400 }) })), now: NOW, period: 'week' });
  const v2s = metric(s, 'visitorToSignup');
  assert.equal(v2s.trailing7.changePercent, -50);
  assert.equal(v2s.trailing30.reason, 'different_window_length');
  const b = s.candidates.bottlenecks.find((x) => x.stage === 'visitorToSignup');
  assert.equal(b.deteriorating, true);
  assert.equal(b.baselineWindow, 'trailing7');
});

test('a step nobody entered is not "unavailable", and may still be the metric to improve', async () => {
  const s = await buildSnapshot({ rpc: scenarioRpc(world({ current: row({ new_visitors: 50, new_visitors_signed_up: 5, signups: 8, signups_uploaded: 4, uploads: 6, uploads_read: 6, eligible_upload_accounts: 6, checkout_accounts: 0 }) })), now: NOW });
  assert.equal(metric(s, 'checkoutToPayment').current, null);
  assert.ok(metric(s, 'checkoutToPayment').notes.includes('no_one_entered_this_step'));
  assert.ok(!s.unavailable.some((u) => u.metric === 'checkoutToPayment'), 'collected, just empty');
  const input = prepareModelInput(s);
  const ctx = validationContext(s, input.value);
  const brief = referenceBrief(s);
  brief.recommendedAction.metricToImprove = 'checkoutToPayment';
  brief.watchMetrics = ['checkoutToPayment'];
  assert.ok(!validateBrief(brief, ctx).errors.includes('metric_to_improve_unavailable'));
  // Genuinely missing data is still blocked (fallback: no payment data at all).
  const f = await buildSnapshot({ rpc: scenarioRpc(SCENARIOS.find((x) => x.id === 'missing_payment_data')), now: NOW });
  assert.ok(f.unavailable.some((u) => u.metric === 'checkoutToPayment'));
});

test('at exactly 00:00 UTC no zero-length window is sent, so the full RPC is still used', async () => {
  const midnight = new Date('2026-10-06T00:00:00.000Z');
  let sent = null;
  const rpc = async (name, args) => {
    assert.equal(name, 'intelligence_metrics');
    sent = args.p_windows;
    for (const w of sent) assert.ok(Date.parse(w.end) > Date.parse(w.start), `${w.key} has length`);
    return { history: LONG_HISTORY, windows: Object.fromEntries(sent.map((w) => [w.key, row({ new_visitors: 5 })])) };
  };
  const s = await buildSnapshot({ rpc, now: midnight });
  assert.equal(s.dataSource, 'rpc');
  assert.ok(!sent.some((w) => w.key === 'today'));
  assert.equal(s.todaySoFar, null);
});

test('validator: spelled-out numbers, multipliers and numeric forecasts are rejected', async () => {
  const s = await buildSnapshot({ rpc: scenarioRpc(SCENARIOS[0]), now: NOW });
  const allowed = allowedNumbers(prepareModelInput(s).value);
  assert.deepEqual(inventedQuantities('This would add 20 paying students and 40% more revenue next week.', allowed), ['forecast']);
  assert.deepEqual(inventedQuantities('Fixing it could double revenue.', allowed), ['multiplier']);
  assert.deepEqual(inventedQuantities('Payments will triple.', allowed), ['multiplier']);
  assert.ok(inventedQuantities('Roughly five hundred extra sign-ups.', allowed).includes('spelled_number'));
  assert.deepEqual(inventedQuantities('A 3x lift is possible.', allowed), ['multiplier']);
  assert.deepEqual(inventedQuantities('Signups reached forty-three.', allowed), ['spelled_number']);
  // Plain, qualitative language and grounded numbers are fine.
  assert.deepEqual(inventedQuantities('A clearer unlock message could improve Upload → Checkout.', allowed), []);
  assert.deepEqual(inventedQuantities('Double-check the tracking for one more day.', allowed), []);
  assert.deepEqual(inventedQuantities('Signups fell to 6 from 20 vs the previous day.', allowed), []);
});

test('validator: the period\'s own dates may be named in prose', async () => {
  const s = await buildSnapshot({ rpc: scenarioRpc(SCENARIOS[0]), now: NOW });
  const ctx = validationContext(s, prepareModelInput(s).value);
  const brief = referenceBrief(s);
  brief.executiveSummary = `On October 5, 2026 ${brief.executiveSummary.charAt(0).toLowerCase()}${brief.executiveSummary.slice(1)}`;
  const r = validateBrief(brief, ctx);
  assert.equal(r.valid, true, r.errors.join(', '));
});

test('validator: biggestChange "none" must be flat with magnitude 0', async () => {
  const sc = SCENARIOS.find((x) => x.id === 'zero_visitors');
  const s = await buildSnapshot({ rpc: scenarioRpc(sc), now: NOW });
  const ctx = validationContext(s, prepareModelInput(s).value);
  const good = referenceBrief(s);
  assert.equal(good.biggestChange.metric, 'none');
  assert.equal(validateBrief(good, ctx).valid, true);
  const bad = clone(good); bad.biggestChange.direction = 'up';
  assert.ok(validateBrief(bad, ctx).errors.includes('biggest_change_none_must_be_flat_zero'));
});

test('analyst: with too little time left no model call starts; the failure is logged', async () => {
  const s = await buildSnapshot({ rpc: scenarioRpc(SCENARIOS[2]), now: NOW });
  let called = false; const logs = [];
  const provider = { name: 'fake', model: 'fake', async analyze() { called = true; return { text: '{}', usage: {} }; } };
  await assert.rejects(runAnalyst({ snapshot: s, provider, budgetMs: MIN_ATTEMPT_MS - 1, log: (r) => logs.push(r) }), (e) => e.code === 'deadline');
  assert.equal(called, false);
  assert.equal(logs[0].errorCode, 'deadline');
});

test('analyst: each attempt gets the time actually left, never more than the provider cap', async () => {
  const s = await buildSnapshot({ rpc: scenarioRpc(SCENARIOS[2]), now: NOW });
  let clock = 0; const timeouts = [];
  const provider = { name: 'fake', model: 'fake', async analyze(req) { timeouts.push(req.timeoutMs); clock += 20_000; return { text: '{}', usage: {} }; } };
  await assert.rejects(runAnalyst({ snapshot: s, provider, now: () => clock, budgetMs: 50_000 }));
  assert.deepEqual(timeouts, [45_000, 28_000]);
});

test('handler: a fallback snapshot is logged, so a broken RPC is visible', async () => {
  const logs = [];
  const res = { status() { return this; }, json(v) { this.body = v; return this; } };
  const sc = SCENARIOS.find((x) => x.id === 'missing_payment_data');
  await handleIntelligence({ method: 'GET', query: { view: 'intelligence-snapshot' } }, res, {
    env: {}, rpc: scenarioRpc(sc), testIds: new Set(), paywall: null, clock: () => NOW, log: (r) => logs.push(r),
    helpers: { rate: async () => {}, BetaError: Error },
  });
  assert.equal(res.body.snapshot.dataSource, 'fallback');
  assert.equal(logs.length, 1);
  assert.equal(logs[0].errorCode, 'intelligence_metrics_unavailable');
  assert.equal(logs[0].dataSource, 'fallback');
});

test('handler: the snapshot GET is rate limited', async () => {
  const scopes = [];
  const res = { status() { return this; }, json(v) { this.body = v; return this; } };
  await handleIntelligence({ method: 'GET', query: { view: 'intelligence-snapshot' } }, res, {
    env: {}, rpc: scenarioRpc(SCENARIOS[0]), testIds: new Set(), paywall: null, clock: () => NOW, log: () => {},
    helpers: { rate: async (_req, scope, limit) => { scopes.push([scope, limit]); }, BetaError: Error },
  });
  assert.deepEqual(scopes, [['intelligence-snapshot', 30]]);
});

test('failure counts carry lowerIsBetter so a rise is never shown as good news', async () => {
  const s = await buildSnapshot({ rpc: scenarioRpc(SCENARIOS[0]), now: NOW });
  assert.equal(metric(s, 'uploadsFailed').lowerIsBetter, true);
  assert.equal(metric(s, 'signups').lowerIsBetter, false);
});

// ---- second review round (code-review-agent on the fixes)

test('a tiny previous day is not a baseline: 1 of 2 yesterday vs 10 of 40 today is not a "fall"', async () => {
  const today = { eligible_upload_accounts: 40, upload_then_checkout_accounts: 10, checkout_accounts: 10, checkout_then_paid_accounts: 8, uploads: 40, signups: 40, signups_uploaded: 30, new_visitors: 200, new_visitors_signed_up: 40 };
  const s = await buildSnapshot({ rpc: scenarioRpc(world({
    current: row(today),
    previous: row({ ...today, eligible_upload_accounts: 2, upload_then_checkout_accounts: 1, checkout_accounts: 1, checkout_then_paid_accounts: 1 }),
  })), now: NOW });
  for (const stage of ['uploadToCheckout', 'checkoutToPayment']) {
    const b = s.candidates.bottlenecks.find((x) => x.stage === stage);
    assert.equal(b.deteriorating, false, `${stage}: no fall from a sample of 1-2`);
    assert.equal(b.baselineRate, null);
  }
});

test('a deteriorating step with a small baseline counts as a small sample (no high confidence)', async () => {
  const sc = SCENARIOS.find((x) => x.id === 'uploads_up_checkout_collapse');
  const s = await buildSnapshot({ rpc: scenarioRpc(sc), now: NOW });
  const b = s.candidates.bottlenecks.find((x) => x.stage === s.candidates.primaryBottleneck);
  assert.equal(b.deteriorating, true);
  assert.equal(b.baselineSampleSize, 25);
  assert.equal(b.baselineReliability, 'small');
  assert.equal(validationContext(s, prepareModelInput(s).value).smallSample, true);
});

test('validator: hedged hypotheses, data-quality wording and true descriptions are not rejected', async () => {
  const sc = SCENARIOS.find((x) => x.id === 'uploads_up_checkout_collapse');
  const s = await buildSnapshot({ rpc: scenarioRpc(sc), now: NOW });
  const allowed = allowedNumbers(prepareModelInput(s).value);
  for (const ok of [
    'Checkout starts reached 4 out of 40 uploaders, so the paywall step might be confusing.',
    'Upload → Checkout loses 36 of 40 uploaders, which may point to unclear unlock copy.',
    'Rerun this comparison once the step reaches 30 people, when the rate will be more reliable.',
    'Check that checkout events are not being double-counted.',
    "Make sure the funnel isn't double counting checkout sessions.",
    'A clearer unlock message could improve Upload → Checkout (currently 10%).',
  ]) assert.deepEqual(inventedQuantities(ok, allowed), [], ok);
  for (const bad of [
    'With clearer copy, Upload → Checkout should return to 40.0%.',
    'This will increase sign-ups to 50.',
    'The change would add 20 paying students.',
    'It could lift conversion by 10%.',
  ]) assert.deepEqual(inventedQuantities(bad, allowed), ['forecast'], bad);
});

test('validator: the action may count things to do, but not predict results', async () => {
  const sc = SCENARIOS.find((x) => x.id === 'zero_visitors');
  const s = await buildSnapshot({ rpc: scenarioRpc(sc), now: NOW });
  const ctx = validationContext(s, prepareModelInput(s).value);
  const good = referenceBrief(s);
  good.recommendedAction.title = 'Post 4 short TikToks and test two versions of the welcome copy';
  assert.equal(validateBrief(good, ctx).valid, true, validateBrief(good, ctx).errors.join(', '));
  const forecast = clone(good); forecast.recommendedAction.reason = 'This would add 8 sign-ups.';
  assert.ok(validateBrief(forecast, ctx).errors.includes('forecast:actionReason'));
  const fact = clone(good); fact.executiveSummary = 'There were 4 new visitors.';
  assert.ok(validateBrief(fact, ctx).errors.some((e) => e.startsWith('ungrounded_number:executiveSummary')), 'counts outside the action are still grounded');
});

test('only the period\'s own dates are exempt from number grounding', () => {
  const period = { type: 'day', days: 1, start: '2026-10-05T00:00:00.000Z', end: '2026-10-06T00:00:00.000Z' };
  assert.doesNotMatch(stripPeriodDates('On October 5, 2026 and Oct. 6 and 5th of October', period), /\d/);
  assert.match(stripPeriodDates('On October 12 there were 5 sign-ups', period), /12.*5/);
});

test('non-comparable windows are sent to the model without their value', async () => {
  const day = { new_visitors: 100, new_visitors_signed_up: 10, signups: 15 };
  const s = await buildSnapshot({ rpc: scenarioRpc(world({ current: row(day), previous: row(day), trailing7: row({ new_visitors: 700, new_visitors_signed_up: 100, signups: 105 }) })), now: NOW });
  const input = prepareModelInput(s).value;
  const v2s = input.comparisons.find((c) => c.metric === 'visitorToSignup');
  assert.equal(v2s.trailing7DayAverage.value, null);
  assert.equal(v2s.trailing7DayAverage.reason, 'different_window_length');
  assert.ok(!allowedNumbers(input).has(14.29), 'the 7-day cohort rate (14.29%) cannot be cited');
  assert.equal(input.comparisons.find((c) => c.metric === 'newVisitors').trailing7DayAverage.value, 100, 'counts keep their trailing average');
});
