// The Command Center's parsers accept what the server actually sends and
// reject anything malformed (so it can't be rendered as a finding).
//   node --test test/intelligence-contract.test.mjs   (Node strips the TS types)
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSnapshot, parseBriefResult, parseBriefFailure, formatRate, formatChange, formatValue, labelFor, isImprovement } from '../src/intelligence/contract.ts';
import { buildSnapshot } from '../server/intelligence/snapshot.js';
import { runAnalyst } from '../server/intelligence/analyst.js';
import { SCENARIOS, scenarioRpc, NOW } from './fixtures/intelligence-scenarios.mjs';
import { referenceBrief } from './fixtures/reference-brief.mjs';

const wire = (x) => JSON.parse(JSON.stringify(x));

test('every scenario snapshot parses on the client', async () => {
  for (const sc of SCENARIOS) {
    const s = parseSnapshot(wire(await buildSnapshot({ rpc: scenarioRpc(sc), now: NOW })));
    assert.ok(s, sc.id);
    assert.ok(s.comparisons.length > 10);
  }
});

test('a server brief round-trips through parseBriefResult', async () => {
  const snapshot = await buildSnapshot({ rpc: scenarioRpc(SCENARIOS[2]), now: NOW });
  const provider = { name: 'fake', model: 'm', analyze: async () => ({ text: JSON.stringify(referenceBrief(snapshot)), usage: {} }) };
  const result = await runAnalyst({ snapshot, provider });
  const parsed = parseBriefResult(wire({ ...result, snapshot }));
  assert.ok(parsed);
  assert.equal(parsed.brief.primaryBottleneck.label, 'Upload → Checkout');
  assert.equal(labelFor(parsed.brief.recommendedAction.metricToImprove, parsed.snapshot), 'Upload → Checkout');
});

test('malformed briefs and snapshots are rejected', async () => {
  const snapshot = await buildSnapshot({ rpc: scenarioRpc(SCENARIOS[2]), now: NOW });
  const good = { requestId: 'intel_x', generatedAt: NOW.toISOString(), brief: referenceBrief(snapshot) };
  assert.ok(parseBriefResult(wire(good)));
  for (const mutate of [
    (b) => { b.brief.health.status = 'great'; },
    (b) => { delete b.brief.executiveSummary; },
    (b) => { b.brief.recommendedAction.risk = 'none'; },
    (b) => { b.brief.hypotheses = 'many'; },
    (b) => { b.requestId = ''; },
  ]) {
    const b = wire(good); mutate(b);
    assert.equal(parseBriefResult(b), null);
  }
  assert.equal(parseSnapshot({ ...wire(snapshot), dataSource: 'guess' }), null);
  assert.equal(parseSnapshot(null), null);
});

test('failures always produce a displayable message', () => {
  assert.deepEqual(parseBriefFailure(null, 500), { error: 'http_500', message: 'The brief could not be generated. Try again later.', requestId: null, snapshot: null });
  assert.equal(parseBriefFailure({ error: 'brief_unavailable', requestId: 'intel_1', message: 'm' }, 502).requestId, 'intel_1');
});

test('formatting', () => {
  assert.equal(formatRate(0.1833), '18.3%');
  assert.equal(formatRate(null), '—');
  assert.equal(formatChange({ value: 1, changePercent: -9.5, direction: 'down', reason: null }), '−9.5%');
  assert.equal(formatChange({ value: 0, changePercent: null, direction: 'up', reason: 'base_zero' }), 'new (was 0)');
  assert.equal(formatChange({ value: null, changePercent: null, direction: null, reason: 'insufficient_history' }), 'not enough history');
  assert.equal(formatChange({ value: 0.14, changePercent: null, direction: null, reason: 'different_window_length' }), 'not comparable');
  assert.equal(formatValue({ kind: 'count', metric: 'revenueCents' }, 300), '$3.00');
  assert.equal(formatValue({ kind: 'count', metric: 'signups' }, 1200), '1,200');
});

test('a rise in a lower-is-better metric is bad news on the client', async () => {
  const s = parseSnapshot(wire(await buildSnapshot({ rpc: scenarioRpc(SCENARIOS[0]), now: NOW })));
  assert.equal(s.comparisons.find((c) => c.metric === 'uploadsFailed').lowerIsBetter, true);
  assert.equal(isImprovement('uploadsFailed', 'up', s), false);
  assert.equal(isImprovement('uploadsFailed', 'down', s), true);
  assert.equal(isImprovement('signups', 'up', s), true);
  assert.equal(isImprovement('signups', 'flat', s), null);
});
