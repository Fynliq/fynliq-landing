/**
 * Preview before pay.
 *
 * An account that has not unlocked gets only this from the server: three
 * totals and a count. The figures, labels and quotes stay on the server until
 * Stripe has confirmed the $1 unlock (see api/analyze.js).
 */

/** Totals the server works out from the verified figures. null = not enough information. */
export interface AidGlance {
  freeMoney: number | null;
  borrowed: number | null;
  remainingCost: number | null;
  /** What the remaining cost was measured against. */
  remainingBasis: 'bill' | 'stated' | 'cost_of_attendance' | 'estimate' | null;
  estimatesOnly: boolean;
  /** A tuition calculator or other cost estimate, exactly as printed. Never a bill. */
  estimatedCost?: number | null;
  estimatedPeriod?: 'semester' | 'year' | null;
  /** Full answer only. */
  afterLoans?: number | null;
  workStudy?: number | null;
}

export interface ReviewItem { id: string; title: string; detail: string }

/** The structured reading of the upload (server/financial-document.js). Full answer only. */
export interface FinancialDocument {
  documentType: string;
  estimatedSemesterCost: number | null;
  estimatedAnnualCost: number | null;
  studentAccountBalance: number | null;
  amountDue: number | null;
  remainingCost: number | null;
  lineItems: { label: string; amount: number; category: string }[];
  detectedTotals: { label: string; amount: number; context: string; type: string; confidence: number }[];
  confidence: number;
  warnings: { code: string; message: string }[];
}

/** Full answer only: everything the preview counts but does not show. */
export interface AidOverview {
  glance: AidGlance;
  review: ReviewItem[];
  questions: string[];
  document?: FinancialDocument;
}

export interface LockedPreview {
  locked: true;
  analysisId: string | null;
  readAt: string;
  documentKind: string;
  preview: { glance: AidGlance; reviewCount: number; figures: number };
}

const money = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

export function parseGlance(value: unknown): AidGlance {
  const g = (value ?? {}) as Record<string, unknown>;
  const basis = g.remainingBasis === 'bill' || g.remainingBasis === 'stated' || g.remainingBasis === 'cost_of_attendance' || g.remainingBasis === 'estimate' ? g.remainingBasis : null;
  const period = g.estimatedPeriod === 'semester' || g.estimatedPeriod === 'year' ? g.estimatedPeriod : null;
  return {
    freeMoney: money(g.freeMoney), borrowed: money(g.borrowed), remainingCost: money(g.remainingCost),
    remainingBasis: basis, estimatesOnly: g.estimatesOnly === true,
    estimatedCost: money(g.estimatedCost), estimatedPeriod: period,
    ...('afterLoans' in g ? { afterLoans: money(g.afterLoans) } : {}),
    ...('workStudy' in g ? { workStudy: money(g.workStudy) } : {}),
  };
}

export function parseOverview(value: unknown): AidOverview | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const o = value as Record<string, unknown>;
  const review = Array.isArray(o.review) ? o.review.filter((r): r is ReviewItem =>
    !!r && typeof (r as ReviewItem).id === 'string' && typeof (r as ReviewItem).title === 'string' && typeof (r as ReviewItem).detail === 'string') : [];
  const questions = Array.isArray(o.questions) ? o.questions.filter((q): q is string => typeof q === 'string') : [];
  return { glance: parseGlance(o.glance), review, questions, ...(parseDocument(o.document) ? { document: parseDocument(o.document) } : {}) };
}

function parseDocument(value: unknown): FinancialDocument | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const d = value as Record<string, unknown>;
  const n = (v: unknown) => money(v);
  const list = <T,>(v: unknown, ok: (x: Record<string, unknown>) => T | null): T[] =>
    Array.isArray(v) ? v.map((x) => (x && typeof x === 'object' ? ok(x as Record<string, unknown>) : null)).filter((x): x is T => x !== null) : [];
  return {
    documentType: typeof d.documentType === 'string' ? d.documentType : 'unknown',
    estimatedSemesterCost: n(d.estimatedSemesterCost), estimatedAnnualCost: n(d.estimatedAnnualCost),
    studentAccountBalance: n(d.studentAccountBalance), amountDue: n(d.amountDue), remainingCost: n(d.remainingCost),
    lineItems: list(d.lineItems, (x) => (typeof x.label === 'string' && typeof x.amount === 'number' ? { label: x.label, amount: x.amount, category: typeof x.category === 'string' ? x.category : 'other' } : null)),
    detectedTotals: list(d.detectedTotals, (x) => (typeof x.label === 'string' && typeof x.amount === 'number' && typeof x.type === 'string'
      ? { label: x.label, amount: x.amount, context: typeof x.context === 'string' ? x.context : '', type: x.type, confidence: typeof x.confidence === 'number' ? x.confidence : 0 } : null)),
    confidence: typeof d.confidence === 'number' ? d.confidence : 0,
    warnings: list(d.warnings, (x) => (typeof x.code === 'string' && typeof x.message === 'string' ? { code: x.code, message: x.message } : null)),
  };
}

export function parseLocked(payload: unknown): LockedPreview | null {
  if (!payload || typeof payload !== 'object' || (payload as { locked?: unknown }).locked !== true) return null;
  const p = payload as Record<string, unknown>;
  const pv = (p.preview ?? {}) as Record<string, unknown>;
  return {
    locked: true,
    analysisId: typeof p.analysisId === 'string' ? p.analysisId : null,
    readAt: typeof p.readAt === 'string' ? p.readAt : new Date().toISOString(),
    documentKind: typeof p.documentKind === 'string' ? p.documentKind : 'unknown',
    preview: {
      glance: parseGlance(pv.glance),
      reviewCount: typeof pv.reviewCount === 'number' ? Math.max(0, Math.round(pv.reviewCount)) : 0,
      figures: typeof pv.figures === 'number' ? pv.figures : 0,
    },
  };
}

export const isLockedPreview = (value: unknown): value is LockedPreview =>
  !!value && typeof value === 'object' && (value as { locked?: unknown }).locked === true;
