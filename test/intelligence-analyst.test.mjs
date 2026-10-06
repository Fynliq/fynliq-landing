// FYNLIQ Intelligence: brief schema, validator, FynliqAnalyst, provider,
// observability and the admin route handler. No network: fake provider/fetch.
//   node --test test/intelligence-analyst.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { briefJsonSchema, validateBrief, allowedNumbers, ungroundedNumbers } from '../server/intelligence/schema.js';
import { runAnalyst, validationContext, AnalystError, ANALYST_INSTRUCTIONS } from '../server/intelligence/analyst.js';
import { OpenAIProvider, createProvider, ProviderError, estimateCostUsd } from '../server/intelligence/providers.js';
import { logRecord, createLogger } from '../server/intelligence/observability.js';
import { handleIntelligence, isIntelligenceRequest } from '../server/intelligence/handler.js';
import { AGENTS, getAgent } from '../server/intelligence/agents.js';
import { buildSnapshot } from '../server/intelligence/snapshot.js';
import { prepareModelInput } from '../server/intelligence/sanitize.js';
import { SCENARIOS, scenarioRpc, NOW } from './fixtures/intelligence-scenarios.mjs';
import { referenceBrief } from './fixtures/reference-brief.mjs';

const scenario = (id) => SCENARIOS.find((s) => s.id === id);
const snap = (id) => buildSnapshot({ rpc: scenarioRpc(scenario(id)), now: NOW });
const ctxFor = (s) => validationContext(s, prepareModelInput(s).value);
const clone = (x) => JSON.parse(JSON.stringify(x));

/** A provider that replays scripted answers and records what it was sent. */
function fakeProvider(answers, usage = { inputTokens: 1000, outputTokens: 200 }) {
  const calls = [];
  return {
    name: 'fake', model: 'fake-model', calls,
    async analyze(req) {
      calls.push(req);
      const next = answers[Math.min(calls.length - 1, answers.length - 1)];
      if (next instanceof Error) throw next;
      return { text: typeof next === 'string' ? next : JSON.stringify(next), usage };
    },
  };
}

// ------------------------------------------------------------------ schema

test('provider JSON schema is strict-mode compatible (every object closed, every key required)', () => {
  const check = (node, path) => {
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false, path);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), path);
      for (const [k, v] of Object.entries(node.properties)) check(v, `${path}.${k}`);
    }
    if (node.type === 'array') check(node.items, `${path}[]`);
    for (const banned of ['minItems', 'maxItems', 'minLength', 'maxLength']) assert.ok(!(banned in node), `${path} uses ${banned}`);
  };
  check(briefJsonSchema(), '$');
});

test('number grounding accepts snapshot numbers in their usual written forms', () => {
  const allowed = allowedNumbers({ rate: 0.1833, count: 1234, cents: 1200, change: -33.3, text: 'n=29 on 2026-10-05' });
  assert.deepEqual(ungroundedNumbers('18.3% and 18% of 1,234; revenue $12.00; down 33.3%; n=29; on 2026-10-05', allowed), []);
  assert.deepEqual(ungroundedNumbers('a 25% lift and 4,000 users', allowed), ['25', '4,000']);
});

test('the reference brief is accepted for every eval scenario (no false rejections)', async () => {
  for (const sc of SCENARIOS) {
    const s = await buildSnapshot({ rpc: scenarioRpc(sc), now: NOW });
    const result = validateBrief(referenceBrief(s), ctxFor(s));
    assert.equal(result.valid, true, `${sc.id}: ${result.errors.join(', ')}`);
  }
});

test('validator rejects invented numbers, causal facts, wrong bottleneck, bad candidates and unmeasurable actions', async () => {
  const s = await snap('uploads_up_checkout_collapse');
  const ctx = ctxFor(s);
  const good = referenceBrief(s);
  const reject = (mutate, code) => {
    const b = clone(good); mutate(b);
    const r = validateBrief(b, ctx);
    assert.equal(r.valid, false, code);
    assert.ok(r.errors.some((e) => e.includes(code)), `${code} not in ${r.errors}`);
  };
  reject((b) => { b.executiveSummary += ' This should lift revenue by 9137%.'; }, 'ungrounded_number:executiveSummary');
  reject((b) => { b.recommendedAction.reason = 'Expected to add 47 paid users.'; }, 'ungrounded_number:actionReason');
  reject((b) => { b.primaryBottleneck.evidence = ['Checkouts fell because the price page is confusing.']; }, 'causal_claim_in_fact');
  reject((b) => { b.primaryBottleneck.stage = 'visitorToSignup'; }, 'bottleneck_mismatch');
  reject((b) => { b.biggestChange.magnitude += 10; }, 'biggest_change_numbers_mismatch');
  reject((b) => { b.biggestChange.metric = 'questions'; }, 'biggest_change_not_a_candidate');
  reject((b) => { b.watchMetrics = ['uploads']; }, 'metric_to_improve_not_watched');
  reject((b) => { delete b.health; }, 'schema:health');
  reject((b) => { b.secret = 'x'; }, 'unexpected_field');
  reject((b) => { b.hypotheses = []; }, 'schema:hypotheses');
  reject((b) => { b.recommendedAction.metricToImprove = 'mrr'; }, 'schema:recommendedAction');
  // Causal language IS allowed inside hypotheses.
  const h = clone(good); h.hypotheses[0].hypothesis = 'Checkout may have dropped because the $1 value is unclear.';
  assert.equal(validateBrief(h, ctx).valid, true);
});

test('small samples: high confidence and missing warnings are rejected', async () => {
  const s = await snap('very_small_sample');
  const ctx = ctxFor(s);
  assert.equal(ctx.smallSample, true);
  const b = referenceBrief(s); b.hypotheses[0].confidence = 'high';
  assert.ok(validateBrief(b, ctx).errors.includes('high_confidence_on_small_sample'));
  const c = referenceBrief(s); c.dataQualityWarnings = [];
  assert.ok(validateBrief(c, ctx).errors.includes('missing_small_sample_warning'));
});

test('an unavailable metric cannot be the metric to improve', async () => {
  const s = await snap('missing_payment_data');
  const b = referenceBrief(s); b.recommendedAction.metricToImprove = 'payments'; b.watchMetrics = ['payments'];
  assert.ok(validateBrief(b, ctxFor(s)).errors.includes('metric_to_improve_unavailable'));
});

// ----------------------------------------------------------------- analyst

test('analyst: valid first answer -> brief with deterministic warnings appended, one log line with tokens', async () => {
  const s = await snap('uploads_up_checkout_collapse');
  const logs = [];
  const provider = fakeProvider([referenceBrief(s)]);
  const out = await runAnalyst({ snapshot: s, provider, log: (r) => logs.push(r), env: { INTELLIGENCE_COST_INPUT_PER_MTOK: '2', INTELLIGENCE_COST_OUTPUT_PER_MTOK: '8' } });
  assert.equal(out.brief.primaryBottleneck.stage, 'uploadToCheckout');
  assert.equal(out.brief.primaryBottleneck.label, 'Upload → Checkout');
  for (const w of s.dataQualityWarnings) assert.ok(out.brief.dataQualityWarnings.includes(w));
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0].instructions, ANALYST_INSTRUCTIONS);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].success, true);
  assert.equal(logs[0].inputTokens, 1000);
  assert.equal(logs[0].estimatedCostUsd, 0.0036);
  assert.match(out.requestId, /^intel_/);
});

test('analyst: invalid then valid -> retried once with validator feedback', async () => {
  const s = await snap('checkout_up_payments_fall');
  const bad = referenceBrief(s); bad.primaryBottleneck.stage = 'visitorToSignup';
  const provider = fakeProvider(['{not json', referenceBrief(s)]);
  const out = await runAnalyst({ snapshot: s, provider });
  assert.equal(provider.calls.length, 2);
  assert.match(provider.calls[1].input, /rejected by validation for: invalid_json/);
  assert.equal(out.brief.primaryBottleneck.stage, 'checkoutToPayment');
});

test('analyst: persistent invalid output -> controlled error, never the bad brief; log has codes only', async () => {
  const s = await snap('traffic_up_signup_down');
  const bad = referenceBrief(s); bad.executiveSummary = 'Revenue will rise 9137% because of TikTok.';
  const logs = [];
  await assert.rejects(runAnalyst({ snapshot: s, provider: fakeProvider([bad]), log: (r) => logs.push(r) }),
    (e) => e instanceof AnalystError && e.code === 'validation_failed');
  const line = JSON.stringify(logRecord(logs[0]));
  assert.equal(logs[0].success, false);
  assert.equal(logs[0].attempts, 2);
  assert.ok(!line.includes('TikTok'), 'no model prose in logs');
  assert.ok(!line.includes('9137'), 'no numbers from prose in logs');
});

test('analyst: provider failure -> controlled error with a content-free code', async () => {
  const s = await snap('everything_improves');
  await assert.rejects(runAnalyst({ snapshot: s, provider: fakeProvider([new ProviderError('timeout')]) }),
    (e) => e instanceof AnalystError && e.code === 'provider_timeout');
});

test('analyst: unknown token usage gives null cost, not a guess', async () => {
  const s = await snap('everything_improves');
  const logs = [];
  await runAnalyst({ snapshot: s, provider: fakeProvider([referenceBrief(s)], {}), log: (r) => logs.push(r), env: { INTELLIGENCE_COST_INPUT_PER_MTOK: '1', INTELLIGENCE_COST_OUTPUT_PER_MTOK: '1' } });
  assert.equal(logs[0].estimatedCostUsd, null);
  assert.equal(estimateCostUsd({ inputTokens: 10, outputTokens: 10 }, {}), null);
});

test('registry: only the business analyst is runnable', () => {
  assert.equal(getAgent('fynliq-business-analyst').status, 'active');
  assert.equal(getAgent('fynliq-growth'), null);
  assert.equal(Object.keys(AGENTS).length, 8);
});

// ---------------------------------------------------------------- provider

test('OpenAI provider: store:false, strict schema, parses text and usage', async () => {
  let sent;
  const fetchImpl = async (url, init) => {
    sent = { url, body: JSON.parse(init.body), auth: init.headers.Authorization };
    return { ok: true, json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: '{"a":1}' }] }], usage: { input_tokens: 11, output_tokens: 7 } }) };
  };
  const p = new OpenAIProvider({ apiKey: 'sk-test', model: 'm', fetchImpl });
  const r = await p.analyze({ instructions: 'i', input: '{"x":1}', schema: briefJsonSchema() });
  assert.equal(sent.url, 'https://api.openai.com/v1/responses');
  assert.equal(sent.body.store, false);
  assert.equal(sent.body.text.format.strict, true);
  assert.equal(sent.body.model, 'm');
  assert.deepEqual(r, { text: '{"a":1}', usage: { inputTokens: 11, outputTokens: 7 } });
});

test('OpenAI provider: PII input never reaches fetch; HTTP errors become ProviderError', async () => {
  let called = false;
  const p = new OpenAIProvider({ apiKey: 'k', model: 'm', fetchImpl: async () => { called = true; return { ok: false, status: 500 }; } });
  await assert.rejects(p.analyze({ instructions: 'i', input: 'SSN 123-45-6789', schema: {} }), (e) => e.code === 'privacy_blocked');
  assert.equal(called, false);
  await assert.rejects(p.analyze({ instructions: 'i', input: '{}', schema: {} }), (e) => e.code === 'http_error' && e.status === 500);
});

test('createProvider: model fallback, missing config and unsupported providers', () => {
  assert.equal(createProvider({ OPENAI_API_KEY: 'k', OPENAI_MODEL: 'base' }).model, 'base');
  assert.equal(createProvider({ OPENAI_API_KEY: 'k', OPENAI_MODEL: 'base', INTELLIGENCE_MODEL: 'intel' }).model, 'intel');
  assert.throws(() => createProvider({}), (e) => e.code === 'not_configured');
  assert.throws(() => createProvider({ INTELLIGENCE_PROVIDER: 'gemini', OPENAI_API_KEY: 'k', OPENAI_MODEL: 'm' }), (e) => e.code === 'unsupported_provider');
});

test('observability: log record keeps known metadata only', () => {
  const r = logRecord({ requestId: 'r', success: true, snapshot: { secret: 1 }, prompt: 'x', validationErrors: ['ungrounded_number:executiveSummary:9137'] });
  assert.deepEqual(Object.keys(r).sort(), ['requestId', 'success', 'type', 'validationErrors']);
  assert.deepEqual(r.validationErrors, ['ungrounded_number:executiveSummary']);
  const lines = []; createLogger((l) => lines.push(l))({ requestId: 'x' });
  assert.equal(JSON.parse(lines[0]).type, 'fynliq_intelligence');
});

// ----------------------------------------------------------------- handler

class TestError extends Error { constructor(status, message) { super(message); this.status = status; } }
function harness({ env = {}, providerFactory, sc = scenario('uploads_up_checkout_collapse') } = {}) {
  const calls = { sameOrigin: 0, rate: [] };
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  const ctx = {
    env, rpc: scenarioRpc(sc), testIds: new Set(), paywall: { enabled: true, pilot: false }, clock: () => NOW, log: () => {},
    providerFactory,
    helpers: {
      BetaError: TestError,
      sameOrigin: () => { calls.sameOrigin += 1; },
      body: (req) => req.body,
      rate: async (_req, scope, limit) => { calls.rate.push([scope, limit]); },
    },
  };
  return { res, ctx, calls };
}

test('handler: routing predicate', () => {
  assert.equal(isIntelligenceRequest({ method: 'GET', query: { view: 'intelligence-snapshot' } }), true);
  assert.equal(isIntelligenceRequest({ method: 'GET', url: '/api/beta-admin?view=intelligence-snapshot' }), true);
  assert.equal(isIntelligenceRequest({ method: 'GET', url: '/api/beta-admin' }), false);
  assert.equal(isIntelligenceRequest({ method: 'POST' }), true);
});

test('handler: GET returns the deterministic snapshot without any model call', async () => {
  const { res, ctx } = harness({ providerFactory: () => { throw new Error('must not be called'); } });
  await handleIntelligence({ method: 'GET', query: { view: 'intelligence-snapshot', period: 'week' } }, res, ctx);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.snapshot.period.type, 'week');
  await assert.rejects(handleIntelligence({ method: 'GET', query: { view: 'intelligence-snapshot', period: 'year' } }, res, ctx), (e) => e.status === 400);
});

test('handler: POST is opt-in, same-origin checked and rate limited', async () => {
  const off = harness();
  await handleIntelligence({ method: 'POST', body: { action: 'intelligence-brief' } }, off.res, off.ctx);
  assert.equal(off.res.statusCode, 503);
  assert.equal(off.res.body.error, 'intelligence_disabled');
  assert.equal(off.calls.sameOrigin, 1);

  const s = await snap('uploads_up_checkout_collapse');
  const on = harness({ env: { INTELLIGENCE_ENABLED: 'true' }, providerFactory: () => fakeProvider([referenceBrief(s)]) });
  await handleIntelligence({ method: 'POST', body: { action: 'intelligence-brief', period: 'day' } }, on.res, on.ctx);
  assert.equal(on.res.statusCode, 200);
  assert.deepEqual(on.calls.rate, [['intelligence', 5]]);
  assert.equal(on.res.body.brief.primaryBottleneck.stage, 'uploadToCheckout');
  assert.ok(on.res.body.snapshot);

  await assert.rejects(handleIntelligence({ method: 'POST', body: { action: 'drop-tables' } }, on.res, on.ctx), (e) => e.status === 400);
});

test('handler: unconfigured provider -> 503; invalid model output -> 502 with requestId and no brief', async () => {
  const nocfg = harness({ env: { INTELLIGENCE_ENABLED: 'true' } });
  await handleIntelligence({ method: 'POST', body: { action: 'intelligence-brief' } }, nocfg.res, nocfg.ctx);
  assert.equal(nocfg.res.statusCode, 503);
  assert.equal(nocfg.res.body.error, 'intelligence_not_configured');

  const bad = harness({ env: { INTELLIGENCE_ENABLED: 'true' }, providerFactory: () => fakeProvider(['{"executiveSummary":"x"}']) });
  await handleIntelligence({ method: 'POST', body: { action: 'intelligence-brief' } }, bad.res, bad.ctx);
  assert.equal(bad.res.statusCode, 502);
  assert.equal(bad.res.body.error, 'brief_unavailable');
  assert.match(bad.res.body.requestId, /^intel_/);
  assert.equal(bad.res.body.brief, undefined);
});
