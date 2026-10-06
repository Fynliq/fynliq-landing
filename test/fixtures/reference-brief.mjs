// A rule-based "perfect analyst" for tests: builds a brief that follows every
// rule using only numbers from the snapshot. The validator must accept it
// for every scenario (no false rejections); mutations of it must be rejected.
import { round } from '../../server/intelligence/metrics.js';

const pct = (r) => `${round(r * 100, 1)}%`;

export function referenceBrief(snapshot) {
  const stage = snapshot.candidates.primaryBottleneck;
  const b = snapshot.candidates.bottlenecks.find((x) => x.stage === stage);
  const bc = snapshot.candidates.biggestChanges[0] ?? null;
  const small = !b || b.reliability !== 'ok' || !bc || bc.reliability !== 'ok';
  const available = new Set(snapshot.comparisons.filter((c) => c.current !== null).map((c) => c.metric));
  const metricToImprove = b ? stage : ['newVisitors', 'signups', 'uploads'].find((m) => available.has(m));
  const evidence = b
    ? [`${b.label}: ${b.numerator} of ${b.denominator} (${pct(b.rate)})${b.baselineRate !== null ? ` vs ${pct(b.baselineRate)} baseline` : ''}.`]
    : ['No funnel step had enough people entering it in this period to compare.'];
  const facts = [
    snapshot.traffic.visitors !== null ? `${snapshot.traffic.visitors} new visitors` : null,
    snapshot.funnel.signups !== null ? `${snapshot.funnel.signups} sign-ups` : null,
    snapshot.funnel.uploads !== null ? `${snapshot.funnel.uploads} upload batches` : null,
  ].filter(Boolean);
  return {
    executiveSummary: `In the period there were ${facts.join(', ')}.`,
    health: { status: 'watch', reason: b ? `${b.label} is the weakest step.` : 'There is not enough data to judge the funnel.' },
    biggestChange: bc
      ? { metric: bc.metric, direction: bc.direction, magnitude: bc.magnitude, explanation: `${bc.label} moved ${bc.direction} ${bc.magnitude}% vs the previous period.` }
      : { metric: 'none', direction: 'flat', magnitude: 0, explanation: 'No metric had a comparable change vs the previous period.' },
    primaryBottleneck: { stage, evidence },
    hypotheses: [{ hypothesis: 'The step may not be clear enough for new users.', confidence: small ? 'low' : 'medium', evidence: evidence[0] }],
    recommendedAction: {
      title: b ? `Run a small copy test on the ${b.label} step` : 'Keep collecting data before changing the funnel',
      reason: 'A reversible, low-effort change that can be measured on the watched metric.',
      metricToImprove, expectedImpact: 'medium', implementationEffort: 'low', risk: 'low', confidence: small ? 'low' : 'medium',
    },
    watchMetrics: [metricToImprove],
    dataQualityWarnings: small ? ['Samples are small, so treat these results as directional.'] : [],
  };
}
