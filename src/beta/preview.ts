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
  remainingBasis: 'bill' | 'cost_of_attendance' | null;
  estimatesOnly: boolean;
  /** Full answer only. */
  afterLoans?: number | null;
  workStudy?: number | null;
}

export interface ReviewItem { id: string; title: string; detail: string }

/** Full answer only: everything the preview counts but does not show. */
export interface AidOverview {
  glance: AidGlance;
  review: ReviewItem[];
  questions: string[];
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
  const basis = g.remainingBasis === 'bill' || g.remainingBasis === 'cost_of_attendance' ? g.remainingBasis : null;
  return {
    freeMoney: money(g.freeMoney), borrowed: money(g.borrowed), remainingCost: money(g.remainingCost),
    remainingBasis: basis, estimatesOnly: g.estimatesOnly === true,
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
  return { glance: parseGlance(o.glance), review, questions };
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
