// FYNLIQ Analyst v1 evals against the REAL model (manual; costs tokens).
//
// Runs every scenario in test/fixtures/intelligence-scenarios.mjs through
// runAnalyst() with the configured provider and scores each brief:
//   valid JSON + schema, grounded numbers, no causal facts, correct
//   bottleneck, small-sample handling, measurable recommendation.
// Synthetic aggregate data only — nothing from production is sent.
//
//   OPENAI_API_KEY=... INTELLIGENCE_MODEL=... node test/intelligence-live-evals.mjs [scenario_id]
//
// Exit code 1 if any scenario fails. Not part of CI (needs a key + network).
import { buildSnapshot } from '../server/intelligence/snapshot.js';
import { runAnalyst, AnalystError } from '../server/intelligence/analyst.js';
import { createProvider } from '../server/intelligence/providers.js';
import { SCENARIOS, scenarioRpc, NOW } from './fixtures/intelligence-scenarios.mjs';

if (!process.env.OPENAI_API_KEY || !(process.env.INTELLIGENCE_MODEL || process.env.OPENAI_MODEL)) {
  console.error('Set OPENAI_API_KEY and INTELLIGENCE_MODEL (or OPENAI_MODEL) to run live evals.');
  process.exit(2);
}
const only = process.argv[2];
const provider = createProvider(process.env);
const results = [];
for (const sc of SCENARIOS.filter((s) => !only || s.id === only)) {
  const snapshot = await buildSnapshot({ rpc: scenarioRpc(sc), now: NOW });
  const logs = [];
  const row = { id: sc.id, ok: false, attempts: null, latencyMs: null, tokens: null, notes: [] };
  try {
    const out = await runAnalyst({ snapshot, provider, log: (r) => logs.push(r) });
    const b = out.brief;
    row.ok = true;
    if (sc.expect.bottleneck && b.primaryBottleneck.stage !== sc.expect.bottleneck) { row.ok = false; row.notes.push(`bottleneck ${b.primaryBottleneck.stage}`); }
    if (sc.expect.noHighConfidence && [b.recommendedAction.confidence, ...b.hypotheses.map((h) => h.confidence)].includes('high')) { row.ok = false; row.notes.push('high confidence'); }
    row.summary = b.executiveSummary;
    row.action = `${b.recommendedAction.title} -> watch ${b.watchMetrics.join(', ')}`;
  } catch (error) {
    row.notes.push(error instanceof AnalystError ? `${error.code} ${error.details.slice(0, 3).join(' ')}` : error.message);
  }
  const log = logs.at(-1) ?? {};
  Object.assign(row, { attempts: log.attempts, latencyMs: log.latencyMs, tokens: `${log.inputTokens ?? '?'}/${log.outputTokens ?? '?'}` });
  results.push(row);
  console.log(`${row.ok ? 'PASS' : 'FAIL'}  ${sc.id}  attempts=${row.attempts} ${row.latencyMs}ms tokens=${row.tokens} ${row.notes.join('; ')}`);
  if (row.summary) console.log(`      ${row.summary}\n      ${row.action}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} scenarios passed`);
process.exit(failed ? 1 : 0);
