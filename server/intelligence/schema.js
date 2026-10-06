// FYNLIQ Intelligence: the CEO brief contract and its validator.
//
// The model's JSON is never passed through as-is. validateBrief() checks:
//   * structure, types, enums and lengths;
//   * the primary bottleneck is the one the metric engine computed;
//   * "biggest change" is one of the computed candidates, with the computed
//     direction and magnitude (the model copies numbers, it never makes them);
//   * every number written in prose already exists in the input (grounding);
//   * fact fields make no causal claims (causes belong in hypotheses);
//   * small samples => no "high" confidence, and data-quality warnings present;
//   * the recommended action names a measurable metric that is also watched.
import { METRIC_KEYS, STAGES } from './metrics.js';

const LEVEL = ['low', 'medium', 'high'];
const str = { type: 'string' };

/** JSON Schema for the provider's strict structured output (no min/max keywords: enforced in validateBrief). */
export function briefJsonSchema() {
  const metricEnum = [...METRIC_KEYS];
  return {
    type: 'object', additionalProperties: false,
    required: ['executiveSummary', 'health', 'biggestChange', 'primaryBottleneck', 'hypotheses', 'recommendedAction', 'watchMetrics', 'dataQualityWarnings'],
    properties: {
      executiveSummary: str,
      health: { type: 'object', additionalProperties: false, required: ['status', 'reason'], properties: { status: { type: 'string', enum: ['good', 'watch', 'concerning'] }, reason: str } },
      biggestChange: {
        type: 'object', additionalProperties: false, required: ['metric', 'direction', 'magnitude', 'explanation'],
        properties: { metric: { type: 'string', enum: [...metricEnum, 'none'] }, direction: { type: 'string', enum: ['up', 'down', 'flat'] }, magnitude: { type: 'number' }, explanation: str },
      },
      primaryBottleneck: {
        type: 'object', additionalProperties: false, required: ['stage', 'evidence'],
        properties: { stage: { type: 'string', enum: [...STAGES, 'insufficient_data'] }, evidence: { type: 'array', items: str } },
      },
      hypotheses: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, required: ['hypothesis', 'confidence', 'evidence'], properties: { hypothesis: str, confidence: { type: 'string', enum: LEVEL }, evidence: str } },
      },
      recommendedAction: {
        type: 'object', additionalProperties: false,
        required: ['title', 'reason', 'metricToImprove', 'expectedImpact', 'implementationEffort', 'risk', 'confidence'],
        properties: {
          title: str, reason: str, metricToImprove: { type: 'string', enum: metricEnum },
          expectedImpact: { type: 'string', enum: LEVEL }, implementationEffort: { type: 'string', enum: LEVEL },
          risk: { type: 'string', enum: LEVEL }, confidence: { type: 'string', enum: LEVEL },
        },
      },
      watchMetrics: { type: 'array', items: { type: 'string', enum: metricEnum } },
      dataQualityWarnings: { type: 'array', items: str },
    },
  };
}

// ------------------------------------------------------------- grounding

const ISO_DATE = /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g;
const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

/** Every number the prose may use: all numeric leaves of the input, as written, rounded, and as percentages. */
export function allowedNumbers(input) {
  const set = new Set([0, 1, 7, 30]); // window lengths the brief may name
  const add = (n) => {
    if (!Number.isFinite(n)) return;
    const a = Math.abs(n);
    for (const v of [a, Math.round(a), Math.round(a * 10) / 10, Math.round(a * 100) / 100]) set.add(v);
    if (a <= 1) for (const v of [a * 100, Math.round(a * 100), Math.round(a * 1000) / 10]) set.add(Math.round(v * 100) / 100);
    if (Number.isInteger(a) && a >= 100) set.add(a / 100); // cents -> dollars
  };
  const walk = (v) => {
    if (typeof v === 'number') add(v);
    else if (typeof v === 'string') { for (const m of v.replace(ISO_DATE, ' ').match(NUMBER) ?? []) add(Number(m.replace(/,/g, ''))); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(input);
  return set;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Removes date phrases for the period's own days ("October 5", "Oct 5, 2026",
 * "5 October") and its year, so they aren't read as metric numbers. Any other
 * date, or a bare day number, is still checked like every other number.
 */
export function stripPeriodDates(text, period) {
  const start = Date.parse(period?.start ?? ''); const end = Date.parse(period?.end ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return String(text);
  const days = [];
  for (let t = start; t <= end && days.length < 9; t += 86_400_000) days.push(new Date(t)); // period days plus the day it ends
  let out = String(text);
  for (const d of days) {
    const full = MONTHS[d.getUTCMonth()]; const abbr = full.slice(0, 3); const day = d.getUTCDate(); const year = d.getUTCFullYear();
    const month = `(?:${full}|${abbr}\\.?)`;
    out = out.replace(new RegExp(`\\b${month}\\s+${day}(?:st|nd|rd|th)?\\b(?:,?\\s+${year}\\b)?`, 'gi'), ' ')
      .replace(new RegExp(`\\b${day}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${month}\\b(?:,?\\s+${year}\\b)?`, 'gi'), ' ');
  }
  const years = new Set(days.map((d) => d.getUTCFullYear()));
  for (const y of years) out = out.replace(new RegExp(`\\b${y}\\b`, 'g'), ' ');
  return out;
}

/** Numbers in a piece of prose that are not in `allowed`. */
export function ungroundedNumbers(text, allowed) {
  const found = String(text).replace(ISO_DATE, ' ').match(NUMBER) ?? [];
  const bad = [];
  for (const raw of found) {
    const n = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;
    const ok = [...allowed].some((a) => Math.abs(a - n) < 0.051);
    if (!ok) bad.push(raw);
  }
  return bad;
}

export const CAUSAL = /\b(because|caused|causes|causing|due to|led to|leads to|leading to|resulted in|results in|drove|driven by|thanks to|as a result of|attributable to)\b/i;

// The digit check alone misses invented numbers written another way.
const SMALL_NUMBER_WORDS = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const LARGE_NUMBER_WORDS = /\b(hundreds?|thousands?|millions?|billions?|dozens?)\b/i;
const NUMBER_WORD = new RegExp(`\\b(${Object.keys(SMALL_NUMBER_WORDS).join('|')})\\b`, 'gi');
const UNITS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
// "forty-three" is 43, not a grounded 40 and a grounded 3.
const COMPOUND_WORD = /\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[-\s](one|two|three|four|five|six|seven|eight|nine)\b/gi;
// "double-check" and "double-counting" are not multipliers. "Halved" is left
// out: a -50% change is a true, grounded description.
export const MULTIPLIER = /\b(doubl(?!e[- ]?(?:check|count))\w*|tripl\w*|quadrupl\w*|twice|thrice|tenfold|\d+(?:\.\d+)?\s?x)\b/i;
// A forecast is a modal that governs a growth verb whose target is a number:
// "would add 20", "will increase sign-ups to 50", "should return to 40%".
// Hedges ("may", "might") and modals without a numeric target ("could improve
// Upload → Checkout", "will be more reliable") are not forecasts.
const MODAL = '(?:will|would|could|should|(?:is|are)\\s+expected\\s+to|expected\\s+to|projected\\s+to|likely\\s+to|on\\s+track\\s+to)';
const GROWTH = '(?:add|increase|grow|rise|raise|lift|boost|generate|bring|gain|reach|recover|improve|cut|reduce|lose|return|hit|halve|drop|fall|climb|jump)';
const FORECAST = new RegExp(`\\b${MODAL}\\s+(?:\\w+\\s+){0,2}?${GROWTH}\\w*\\s+(?:(?:\\S+\\s+){0,4}?(?:by|to|about|around|roughly|over|up\\s+to|another|an\\s+extra|an\\s+additional)\\s+)?\\$?\\d`, 'i');
const MODAL_SENTENCE = new RegExp(`\\b${MODAL}\\b`, 'i');
const NUMBER_MORE = /\$?\d[\d,.]*%?\s+(more|extra|additional)\b/i;

/** Spelled-out numbers, multipliers and numeric forecasts in a piece of prose. */
export function inventedQuantities(text, allowed) {
  const s = String(text); const issues = [];
  const grounded = (n) => [...allowed].some((a) => Math.abs(a - n) < 0.051);
  if (LARGE_NUMBER_WORDS.test(s)) issues.push('spelled_number');
  const values = [];
  const rest = s.replace(COMPOUND_WORD, (_m, tens, unit) => { values.push(SMALL_NUMBER_WORDS[tens.toLowerCase()] + UNITS[unit.toLowerCase()]); return ' '; });
  for (const m of rest.match(NUMBER_WORD) ?? []) values.push(SMALL_NUMBER_WORDS[m.toLowerCase()]);
  if (values.some((n) => !grounded(n))) issues.push('spelled_number');
  if (MULTIPLIER.test(s)) issues.push('multiplier');
  for (const sentence of s.split(/(?<=[.!?;])\s+/)) {
    if (FORECAST.test(sentence) || (MODAL_SENTENCE.test(sentence) && NUMBER_MORE.test(sentence))) { issues.push('forecast'); break; }
  }
  return [...new Set(issues)];
}

// ------------------------------------------------------------- validator

const isStr = (v, max = 600) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const isLevel = (v) => LEVEL.includes(v);

/**
 * @param {any} brief      parsed model output
 * @param {object} ctx
 * @param {object} ctx.input            the sanitized model input (for grounding)
 * @param {string} ctx.primaryBottleneck the engine's bottleneck stage
 * @param {object[]} ctx.biggestChanges  the engine's candidates
 * @param {boolean} ctx.smallSample      true when the key evidence is a small sample
 * @param {string[]} ctx.unavailableMetrics
 * @returns {{valid:boolean, errors:string[], schemaValid:boolean, groundingValid:boolean}}
 */
export function validateBrief(brief, ctx) {
  const schema = []; const grounding = [];
  if (!brief || typeof brief !== 'object' || Array.isArray(brief)) return { valid: false, schemaValid: false, groundingValid: false, errors: ['not_an_object'] };

  // ---- structure
  const allowedTop = ['executiveSummary', 'health', 'biggestChange', 'primaryBottleneck', 'hypotheses', 'recommendedAction', 'watchMetrics', 'dataQualityWarnings'];
  for (const k of Object.keys(brief)) if (!allowedTop.includes(k)) schema.push(`unexpected_field:${k}`);
  if (!isStr(brief.executiveSummary, 900)) schema.push('executiveSummary');
  const h = brief.health;
  if (!h || !['good', 'watch', 'concerning'].includes(h.status) || !isStr(h.reason)) schema.push('health');
  const bc = brief.biggestChange;
  if (!bc || ![...METRIC_KEYS, 'none'].includes(bc.metric) || !['up', 'down', 'flat'].includes(bc.direction) || typeof bc.magnitude !== 'number' || !Number.isFinite(bc.magnitude) || !isStr(bc.explanation)) schema.push('biggestChange');
  const pb = brief.primaryBottleneck;
  if (!pb || ![...STAGES, 'insufficient_data'].includes(pb.stage) || !Array.isArray(pb.evidence) || pb.evidence.length < 1 || pb.evidence.length > 5 || !pb.evidence.every((e) => isStr(e, 400))) schema.push('primaryBottleneck');
  if (!Array.isArray(brief.hypotheses) || brief.hypotheses.length < 1 || brief.hypotheses.length > 4
    || !brief.hypotheses.every((x) => x && isStr(x.hypothesis, 400) && isLevel(x.confidence) && isStr(x.evidence, 400))) schema.push('hypotheses');
  const ra = brief.recommendedAction;
  if (!ra || !isStr(ra.title, 160) || !isStr(ra.reason) || !METRIC_KEYS.includes(ra.metricToImprove)
    || !isLevel(ra.expectedImpact) || !isLevel(ra.implementationEffort) || !isLevel(ra.risk) || !isLevel(ra.confidence)) schema.push('recommendedAction');
  if (!Array.isArray(brief.watchMetrics) || brief.watchMetrics.length < 1 || brief.watchMetrics.length > 4 || !brief.watchMetrics.every((m) => METRIC_KEYS.includes(m))) schema.push('watchMetrics');
  if (!Array.isArray(brief.dataQualityWarnings) || brief.dataQualityWarnings.length > 8 || !brief.dataQualityWarnings.every((w) => isStr(w, 400))) schema.push('dataQualityWarnings');
  if (schema.length) return { valid: false, schemaValid: false, groundingValid: false, errors: schema.map((e) => `schema:${e}`) };

  // ---- agreement with the deterministic engine
  if (pb.stage !== ctx.primaryBottleneck) grounding.push(`bottleneck_mismatch:expected_${ctx.primaryBottleneck}`);
  if (bc.metric === 'none') {
    if (ctx.biggestChanges.length) grounding.push('biggest_change_none_but_candidates_exist');
    if (bc.direction !== 'flat' || bc.magnitude !== 0) grounding.push('biggest_change_none_must_be_flat_zero');
  } else {
    const c = ctx.biggestChanges.find((x) => x.metric === bc.metric);
    if (!c) grounding.push('biggest_change_not_a_candidate');
    else if (c.direction !== bc.direction || Math.abs(c.magnitude - Math.abs(bc.magnitude)) > 0.05) grounding.push('biggest_change_numbers_mismatch');
  }

  // ---- measurable recommendation
  if (!brief.watchMetrics.includes(ra.metricToImprove)) grounding.push('metric_to_improve_not_watched');
  const unavailable = new Set(ctx.unavailableMetrics ?? []);
  if (unavailable.has(ra.metricToImprove)) grounding.push('metric_to_improve_unavailable');

  // ---- numbers in prose must come from the input
  const allowed = allowedNumbers(ctx.input);
  const prose = {
    executiveSummary: brief.executiveSummary, healthReason: h.reason, biggestChange: bc.explanation,
    ...Object.fromEntries(pb.evidence.map((e, i) => [`evidence${i}`, e])),
    ...Object.fromEntries(brief.hypotheses.flatMap((x, i) => [[`hypothesis${i}`, x.hypothesis], [`hypothesisEvidence${i}`, x.evidence]])),
    actionTitle: ra.title, actionReason: ra.reason,
    ...Object.fromEntries(brief.dataQualityWarnings.map((w, i) => [`warning${i}`, w])),
  };
  // The action may count things to do ("test 3 versions"): small counts there are
  // instructions, not metric claims. Forecasts and multipliers are still rejected.
  const allowedInAction = new Set([...allowed, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (const [field, raw] of Object.entries(prose)) {
    const text = stripPeriodDates(raw, ctx.input?.period);
    const ok = field.startsWith('action') ? allowedInAction : allowed;
    const bad = ungroundedNumbers(text, ok);
    if (bad.length) grounding.push(`ungrounded_number:${field}:${bad.slice(0, 3).join('|')}`);
    for (const issue of inventedQuantities(text, ok)) grounding.push(`${issue}:${field}`);
  }

  // ---- facts vs hypotheses
  const facts = { executiveSummary: brief.executiveSummary, healthReason: h.reason, biggestChange: bc.explanation, ...Object.fromEntries(pb.evidence.map((e, i) => [`evidence${i}`, e])) };
  for (const [field, text] of Object.entries(facts)) if (CAUSAL.test(text)) grounding.push(`causal_claim_in_fact:${field}`);

  // ---- small samples
  if (ctx.smallSample) {
    if (brief.hypotheses.some((x) => x.confidence === 'high') || ra.confidence === 'high') grounding.push('high_confidence_on_small_sample');
    if (!brief.dataQualityWarnings.length) grounding.push('missing_small_sample_warning');
  }

  return { valid: grounding.length === 0, schemaValid: true, groundingValid: grounding.length === 0, errors: grounding };
}
