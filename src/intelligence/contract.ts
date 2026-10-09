/**
 * FYNLIQ Intelligence: the Command Center's view of the admin API.
 *
 * The server already validates every brief; these parsers are a second,
 * defensive check so a malformed response can never be rendered as if it
 * were a finding. Anything that doesn't parse becomes `null` and the panel
 * shows an error state instead.
 */

export type Period = 'day' | 'week';
export type Level = 'low' | 'medium' | 'high';
export type Health = 'good' | 'watch' | 'concerning';
export type Direction = 'up' | 'down' | 'flat';

export interface WindowComparison {
  value: number | null;
  changePercent: number | null;
  direction: Direction | null;
  reason: string | null;
}

export interface Comparison {
  metric: string;
  kind: 'count' | 'rate';
  label: string;
  current: number | null;
  numerator?: number | null;
  denominator?: number | null;
  /** True for failure counts: a rise is bad news. */
  lowerIsBetter: boolean;
  reliability: 'ok' | 'small' | 'very_small' | 'unavailable';
  previous: WindowComparison | null;
  trailing7: WindowComparison | null;
  trailing30: WindowComparison | null;
}

export interface Snapshot {
  generatedAt: string;
  period: { type: Period; days: number; start: string; end: string };
  dataSource: 'rpc' | 'fallback';
  comparisons: Comparison[];
  candidates: { primaryBottleneck: string };
  dataQualityWarnings: string[];
}

export interface Brief {
  executiveSummary: string;
  health: { status: Health; reason: string };
  biggestChange: { metric: string; direction: Direction; magnitude: number; explanation: string };
  primaryBottleneck: { stage: string; label: string; evidence: string[] };
  hypotheses: { hypothesis: string; confidence: Level; evidence: string }[];
  recommendedAction: {
    title: string; reason: string; metricToImprove: string;
    expectedImpact: Level; implementationEffort: Level; risk: Level; confidence: Level;
  };
  watchMetrics: string[];
  dataQualityWarnings: string[];
}

export interface BriefResult {
  requestId: string;
  generatedAt: string;
  provider: string;
  model: string;
  brief: Brief;
  snapshot: Snapshot | null;
}

export interface BriefFailure {
  error: string;
  message: string;
  requestId: string | null;
  snapshot: Snapshot | null;
}

const LEVELS: readonly string[] = ['low', 'medium', 'high'];
const HEALTH: readonly string[] = ['good', 'watch', 'concerning'];
const DIRECTIONS: readonly string[] = ['up', 'down', 'flat'];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isNumOrNull = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isFinite(v));
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

function parseWindow(v: unknown): WindowComparison | null {
  if (!isObj(v) || !isNumOrNull(v.value) || !isNumOrNull(v.changePercent)) return null;
  return {
    value: v.value, changePercent: v.changePercent,
    direction: DIRECTIONS.includes(v.direction as string) ? (v.direction as Direction) : null,
    reason: typeof v.reason === 'string' ? v.reason : null,
  };
}

function parseComparison(v: unknown): Comparison | null {
  if (!isObj(v) || !isStr(v.metric) || !isStr(v.label) || (v.kind !== 'count' && v.kind !== 'rate') || !isNumOrNull(v.current)) return null;
  const reliability = ['ok', 'small', 'very_small', 'unavailable'].includes(v.reliability as string) ? (v.reliability as Comparison['reliability']) : 'unavailable';
  return {
    metric: v.metric, kind: v.kind, label: v.label, current: v.current, reliability,
    lowerIsBetter: v.lowerIsBetter === true,
    numerator: isNumOrNull(v.numerator) ? v.numerator : null,
    denominator: isNumOrNull(v.denominator) ? v.denominator : null,
    previous: parseWindow(v.previous), trailing7: parseWindow(v.trailing7), trailing30: parseWindow(v.trailing30),
  };
}

export function parseSnapshot(v: unknown): Snapshot | null {
  if (!isObj(v) || !isObj(v.period) || !isStr(v.generatedAt) || !Array.isArray(v.comparisons) || !isObj(v.candidates)) return null;
  const p = v.period;
  if ((p.type !== 'day' && p.type !== 'week') || typeof p.days !== 'number' || !isStr(p.start) || !isStr(p.end)) return null;
  if (v.dataSource !== 'rpc' && v.dataSource !== 'fallback') return null;
  const comparisons = v.comparisons.map(parseComparison);
  if (comparisons.some((c) => c === null)) return null;
  return {
    generatedAt: v.generatedAt,
    period: { type: p.type, days: p.days, start: p.start, end: p.end },
    dataSource: v.dataSource,
    comparisons: comparisons as Comparison[],
    candidates: { primaryBottleneck: isStr(v.candidates.primaryBottleneck) ? v.candidates.primaryBottleneck : 'insufficient_data' },
    dataQualityWarnings: isStrArray(v.dataQualityWarnings) ? v.dataQualityWarnings : [],
  };
}

export function parseBrief(v: unknown): Brief | null {
  if (!isObj(v) || !isStr(v.executiveSummary)) return null;
  const { health: h, biggestChange: c, primaryBottleneck: b, recommendedAction: a } = v;
  if (!isObj(h) || !HEALTH.includes(h.status as string) || !isStr(h.reason)) return null;
  if (!isObj(c) || !isStr(c.metric) || !DIRECTIONS.includes(c.direction as string) || typeof c.magnitude !== 'number' || !isStr(c.explanation)) return null;
  if (!isObj(b) || !isStr(b.stage) || !isStrArray(b.evidence)) return null;
  if (!Array.isArray(v.hypotheses) || !v.hypotheses.every((x) => isObj(x) && isStr(x.hypothesis) && LEVELS.includes(x.confidence as string) && isStr(x.evidence))) return null;
  if (!isObj(a) || !isStr(a.title) || !isStr(a.reason) || !isStr(a.metricToImprove)
    || ![a.expectedImpact, a.implementationEffort, a.risk, a.confidence].every((x) => LEVELS.includes(x as string))) return null;
  if (!isStrArray(v.watchMetrics) || !Array.isArray(v.dataQualityWarnings) || !v.dataQualityWarnings.every((x) => typeof x === 'string')) return null;
  return {
    executiveSummary: v.executiveSummary,
    health: { status: h.status as Health, reason: h.reason },
    biggestChange: { metric: c.metric, direction: c.direction as Direction, magnitude: c.magnitude, explanation: c.explanation },
    primaryBottleneck: { stage: b.stage, label: isStr(b.label) ? b.label : b.stage, evidence: b.evidence },
    hypotheses: (v.hypotheses as Obj[]).map((x) => ({ hypothesis: x.hypothesis as string, confidence: x.confidence as Level, evidence: x.evidence as string })),
    recommendedAction: {
      title: a.title, reason: a.reason, metricToImprove: a.metricToImprove,
      expectedImpact: a.expectedImpact as Level, implementationEffort: a.implementationEffort as Level, risk: a.risk as Level, confidence: a.confidence as Level,
    },
    watchMetrics: v.watchMetrics,
    dataQualityWarnings: v.dataQualityWarnings as string[],
  };
}

export function parseBriefResult(v: unknown): BriefResult | null {
  if (!isObj(v) || !isStr(v.requestId) || !isStr(v.generatedAt)) return null;
  const brief = parseBrief(v.brief);
  if (!brief) return null;
  return {
    requestId: v.requestId, generatedAt: v.generatedAt,
    provider: isStr(v.provider) ? v.provider : 'unknown', model: isStr(v.model) ? v.model : 'unknown',
    brief, snapshot: parseSnapshot(v.snapshot),
  };
}

export function parseBriefFailure(v: unknown, status: number): BriefFailure {
  const o = isObj(v) ? v : {};
  return {
    error: isStr(o.error) ? o.error : `http_${status}`,
    message: isStr(o.message) ? o.message : 'The brief could not be generated. Try again later.',
    requestId: isStr(o.requestId) ? o.requestId : null,
    snapshot: parseSnapshot(o.snapshot),
  };
}

// ------------------------------------------------------------- formatting

/** 0.1833 -> "18.3%". */
export const formatRate = (v: number | null): string => (v === null ? '—' : `${(Math.round(v * 1000) / 10).toFixed(1)}%`);

export function formatValue(c: Pick<Comparison, 'kind' | 'metric'>, v: number | null): string {
  if (v === null) return '—';
  if (c.kind === 'rate') return formatRate(v);
  if (c.metric === 'revenueCents') return `$${(v / 100).toFixed(2)}`;
  return Number.isInteger(v) ? v.toLocaleString('en-US') : v.toFixed(1);
}

/** "+18.0%", "−9.5%", "no change", or why there is no percentage. */
export function formatChange(w: WindowComparison | null): string {
  if (!w) return 'not available';
  if (w.reason === 'insufficient_history') return 'not enough history';
  if (w.reason === 'different_window_length') return 'not comparable';
  if (w.changePercent === null) return w.reason === 'base_zero' ? 'new (was 0)' : 'not available';
  if (w.changePercent === 0) return 'no change';
  return `${w.changePercent > 0 ? '+' : '−'}${Math.abs(w.changePercent).toFixed(1)}%`;
}

/** Whether a move in `direction` is good news for this metric (null when flat or unknown). */
export function isImprovement(metric: string, direction: Direction | null, snapshot: Snapshot | null): boolean | null {
  if (direction !== 'up' && direction !== 'down') return null;
  const lowerIsBetter = snapshot?.comparisons.find((c) => c.metric === metric)?.lowerIsBetter ?? false;
  return (direction === 'up') !== lowerIsBetter;
}

export function labelFor(metric: string, snapshot: Snapshot | null): string {
  return snapshot?.comparisons.find((c) => c.metric === metric)?.label ?? metric;
}
