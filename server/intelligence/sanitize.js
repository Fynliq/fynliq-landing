// FYNLIQ Intelligence: what the model is allowed to see.
//
// The model gets a curated projection of the snapshot: aggregate numbers,
// fixed enums and labels written in this repository. No ids, emails, UTM
// text, referrers, question text or document content exist in the snapshot,
// and this layer checks again before anything leaves the server:
//   1. keys must look like identifiers, values must be numbers, booleans,
//      null or short strings;
//   2. any string containing '@', a UUID or a long digit run is dropped;
//   3. the serialized payload must pass server/privacy.js assertSafeInput.
// Anything unexpected fails closed (SanitizationError) — no model call.
import { assertSafeInput } from '../privacy.js';
import { METRIC_KEYS, STAGES } from './metrics.js';

export class SanitizationError extends Error {
  constructor(reason) { super('Intelligence input failed sanitization'); this.name = 'SanitizationError'; this.reason = reason; }
}

const KEY = /^[A-Za-z0-9_]{1,40}$/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const LONG_DIGITS = /\d{9,}/;
const MAX_STRING = 400;
const MAX_ARRAY = 60;
const MAX_DEPTH = 7;

/** Deep copy keeping only safe shapes. Returns { value, dropped }. */
export function sanitizeForModel(input) {
  const dropped = [];
  const walk = (v, path, depth) => {
    if (depth > MAX_DEPTH) { dropped.push(`${path}:depth`); return undefined; }
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') {
      if (v.length > MAX_STRING || v.includes('@') || UUID.test(v) || LONG_DIGITS.test(v)) { dropped.push(`${path}:string`); return undefined; }
      return v;
    }
    if (Array.isArray(v)) {
      return v.slice(0, MAX_ARRAY).map((x, i) => walk(x, `${path}[${i}]`, depth + 1)).filter((x) => x !== undefined);
    }
    if (typeof v === 'object') {
      const out = {};
      for (const [k, x] of Object.entries(v)) {
        if (!KEY.test(k)) { dropped.push(`${path}.<key>`); continue; }
        const w = walk(x, `${path}.${k}`, depth + 1);
        if (w !== undefined) out[k] = w;
      }
      return out;
    }
    dropped.push(`${path}:type`);
    return undefined;
  };
  return { value: walk(input, '$', 0), dropped };
}

/** Static product context the analyst needs to reason about the funnel. Written here, not user data. */
export const PRODUCT_CONTEXT = [
  'FYNQ (Fynliq) helps college students understand financial-aid documents: upload an award letter or FAFSA summary, get a plain answer.',
  'Funnel: visit, create account, open My Aid, upload aid documents, see a free preview, pay a one-time $1 unlock (Stripe Checkout), see the full analysis.',
  'Ask FYNLIQ is a separate question-and-answer feature; it is not a step on the payment path.',
  'Accounts created before the beta cutoff are grandfathered and never pay; only newer accounts see the $1 unlock.',
  'Volumes are early-stage and small; most rates are based on single or double-digit samples.',
];

const compactWindow = (w) => (w ? { value: w.value, changePercent: w.changePercent, direction: w.direction, reason: w.reason } : null);

/** The projection of a snapshot that is sent to the model. */
export function modelInputFromSnapshot(snapshot) {
  return {
    productContext: PRODUCT_CONTEXT,
    period: snapshot.period,
    dataSource: snapshot.dataSource,
    headline: {
      traffic: snapshot.traffic,
      funnel: snapshot.funnel,
      revenue: { gross: snapshot.revenue.gross, transactions: snapshot.revenue.transactions, currency: snapshot.revenue.currency },
      conversion: snapshot.conversion,
      quality: snapshot.quality,
      acquisition: { attributedVisitors: snapshot.acquisition.attributedVisitors, byChannel: snapshot.acquisition.byChannel },
    },
    comparisons: snapshot.comparisons.map((c) => ({
      metric: c.metric, label: c.label, kind: c.kind, current: c.current,
      ...(c.kind === 'rate' ? { numerator: c.numerator, denominator: c.denominator } : {}),
      reliability: c.reliability, notes: c.notes,
      previousPeriod: compactWindow(c.previous), trailing7DayAverage: compactWindow(c.trailing7), trailing30DayAverage: compactWindow(c.trailing30),
    })),
    todaySoFar: snapshot.todaySoFar,
    biggestChangeCandidates: snapshot.candidates.biggestChanges,
    primaryBottleneck: snapshot.candidates.primaryBottleneck,
    bottleneckCandidates: snapshot.candidates.bottlenecks.map((b) => ({
      stage: b.stage, label: b.label, rate: b.rate, numerator: b.numerator, denominator: b.denominator, lost: b.lost,
      baselineRate: b.baselineRate, baselineWindow: b.baselineWindow, changePercent: b.changePercent,
      reliability: b.reliability, eligible: b.eligible, deteriorating: b.deteriorating, reason: b.reason,
    })),
    unavailable: snapshot.unavailable,
    dataQualityWarnings: snapshot.dataQualityWarnings,
    allowedMetricKeys: METRIC_KEYS,
    allowedStages: [...STAGES, 'insufficient_data'],
  };
}

/** Build, sanitize and privacy-check the model input. Throws SanitizationError. */
export function prepareModelInput(snapshot) {
  const { value, dropped } = sanitizeForModel(modelInputFromSnapshot(snapshot));
  if (dropped.length) throw new SanitizationError(`unexpected_fields:${dropped.length}`);
  const serialized = JSON.stringify(value);
  try { assertSafeInput(serialized); } catch { throw new SanitizationError('privacy_blocked'); }
  return { value, serialized };
}
