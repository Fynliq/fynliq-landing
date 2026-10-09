// FYNLIQ Analyst v1 evals (deterministic part, runs in CI).
//
// For each scenario in test/fixtures/intelligence-scenarios.mjs:
//   * the metric engine finds the expected bottleneck / change / warnings;
//   * no NaN or Infinity anywhere in the snapshot;
//   * a correct brief is accepted;
//   * a brief that invents a number, states a cause as fact, names a
//     different bottleneck, or is over-confident on a small sample is rejected.
// The same scenarios run against the real model in test/intelligence-live-evals.mjs.
//   node --test test/intelligence-evals.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot } from '../server/intelligence/snapshot.js';
import { prepareModelInput } from '../server/intelligence/sanitize.js';
import { validateBrief } from '../server/intelligence/schema.js';
import { validationContext } from '../server/intelligence/analyst.js';
import { STAGES } from '../server/intelligence/metrics.js';
import { SCENARIOS, scenarioRpc, NOW } from './fixtures/intelligence-scenarios.mjs';
import { referenceBrief } from './fixtures/reference-brief.mjs';

const clone = (x) => JSON.parse(JSON.stringify(x));

for (const sc of SCENARIOS) {
  test(`eval ${sc.id}: ${sc.title}`, async () => {
    const s = await buildSnapshot({ rpc: scenarioRpc(sc), now: NOW });
    const e = sc.expect;

    // ---- deterministic engine
    assert.doesNotMatch(JSON.stringify(s), /NaN|Infinity/, 'no NaN/Infinity');
    if (e.bottleneck) assert.equal(s.candidates.primaryBottleneck, e.bottleneck, 'bottleneck');
    if (e.dataSource) assert.equal(s.dataSource, e.dataSource);
    if (e.biggestChange) assert.equal(s.candidates.biggestChanges[0]?.metric, e.biggestChange, 'biggest change');
    if (e.biggestChangeIn) assert.ok(e.biggestChangeIn.includes(s.candidates.biggestChanges[0]?.metric), `biggest change ${s.candidates.biggestChanges[0]?.metric}`);
    if (e.smallSampleWarning) assert.ok(s.dataQualityWarnings.some((w) => /small sample/i.test(w) || /not enough|No funnel step/i.test(w)), 'small-sample warning');
    if (e.anomalyWarning) assert.ok(s.dataQualityWarnings.some((w) => w.startsWith('Possible anomaly')), 'anomaly warning');
    if (e.noDeteriorating) assert.ok(s.candidates.bottlenecks.every((b) => !b.deteriorating));
    if (e.unavailable) for (const m of e.unavailable) assert.ok(s.unavailable.some((u) => u.metric === m), `${m} unavailable`);
    if (e.allRatesNull) assert.ok(s.comparisons.filter((c) => c.kind === 'rate').every((c) => c.current === null));
    if (s.candidates.primaryBottleneck !== 'insufficient_data') {
      const b = s.candidates.bottlenecks[0];
      assert.ok(b.denominator >= 5, 'bottleneck evidence has a minimum sample');
    }

    // ---- validated output
    const input = prepareModelInput(s);
    const ctx = validationContext(s, input.value);
    const good = referenceBrief(s);
    const ok = validateBrief(good, ctx);
    assert.equal(ok.valid, true, `reference brief rejected: ${ok.errors}`);
    assert.ok(good.watchMetrics.includes(good.recommendedAction.metricToImprove), 'actionable + measurable');

    const invented = clone(good); invented.primaryBottleneck.evidence.push('Fixing this would add 8123 paying students.');
    assert.equal(validateBrief(invented, ctx).valid, false, 'invented number rejected');

    const causal = clone(good); causal.executiveSummary += ' Sign-ups fell because TikTok traffic is low quality.';
    assert.ok(validateBrief(causal, ctx).errors.some((x) => x.startsWith('causal_claim_in_fact')), 'causation as fact rejected');

    const wrong = clone(good); wrong.primaryBottleneck.stage = [...STAGES, 'insufficient_data'].find((x) => x !== s.candidates.primaryBottleneck);
    assert.ok(validateBrief(wrong, ctx).errors.some((x) => x.startsWith('bottleneck_mismatch')), 'wrong bottleneck rejected');

    if (ctx.smallSample) {
      const sure = clone(good); sure.recommendedAction.confidence = 'high';
      assert.ok(validateBrief(sure, ctx).errors.includes('high_confidence_on_small_sample'), 'over-confidence rejected');
    }
    if (e.noHighConfidence) assert.equal(ctx.smallSample, true);
  });
}
