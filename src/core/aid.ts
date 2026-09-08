import type { Award, AwardLine } from './types';

/**
 * An award, split by what each dollar actually is.
 *
 * `offered` deliberately excludes work-study: it is wages for hours worked,
 * not money offered as a lump sum, and adding it overstates the package.
 */
export interface AidBreakdown {
  /** Gift aid. Never repaid. */
  giftAid: number;
  /** Subsidized + unsubsidized. Repaid. */
  loansOffered: number;
  /** Offered as wages, contingent on finding and working a job. */
  workStudy: number;
  /** Gift aid + loans. The number an award letter calls a total. */
  offered: number;
  /**
   * Cost of attendance minus everything offered, or `null` when the
   * cost of attendance was not found in the student's document.
   */
  uncovered: number | null;
}

const sumOf = (lines: AwardLine[], ...kinds: AwardLine['kind'][]): number =>
  lines
    .filter((line) => kinds.includes(line.kind))
    .reduce((total, line) => total + line.amount, 0);

export function breakDownAward(award: Award): AidBreakdown {
  const giftAid = sumOf(award.lines, 'grant');
  const loansOffered = sumOf(award.lines, 'subsidized-loan', 'unsubsidized-loan');
  const workStudy = sumOf(award.lines, 'work-study');
  const offered = giftAid + loansOffered;

  return {
    giftAid,
    loansOffered,
    workStudy,
    offered,
    uncovered:
      award.costOfAttendance === null
        ? null
        : Math.max(0, award.costOfAttendance - offered),
  };
}

/** What the student still owes the school this term after gift aid is applied. */
export function amountStillOwed(bill: number, grantsApplied: number): number {
  return Math.max(0, bill - grantsApplied);
}
