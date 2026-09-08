export interface LoanInput {
  /** What is still owed to the school this term after gift aid. */
  owed: number;
  /** Subsidized money the student may accept this term. */
  subsidizedAvailable: number;
  /** Unsubsidized money the student may accept this term. */
  unsubsidizedAvailable: number;
}

/** Green, gold and rust in the order a student meets them. */
export type LoanBand = 'covers' | 'extra' | 'costly';

export interface LoanCopy {
  /** Never the only signal: the headline says the same thing in words. */
  tone: 'green' | 'gold' | 'rust';
  headline: string;
  detail: string;
}

/**
 * The wording for each band, kept here so the interface can reserve room for
 * the longest of them and never resize as the verdict changes.
 */
export const LOAN_BANDS: readonly LoanBand[] = ['covers', 'extra', 'costly'];

export const LOAN_COPY: Record<LoanBand, LoanCopy> = {
  covers: {
    tone: 'green',
    headline: 'Covers your bill, nothing spare',
    detail:
      'Every dollar here is a dollar the school is already charging you. This is the amount most students should stop at.',
  },
  extra: {
    tone: 'gold',
    headline: 'Past your bill, but still subsidized',
    detail:
      'The extra is subsidized, so no interest builds while you are enrolled at least half time. It is still borrowed, and still repaid.',
  },
  costly: {
    tone: 'rust',
    headline: 'Borrowing past your bill, with interest',
    detail:
      'This crosses into unsubsidized money above what you owe. Interest starts the day it disburses, so you repay noticeably more than you take.',
  },
};

export interface LoanVerdict extends LoanCopy {
  band: LoanBand;
  /** Accepted amount, filled subsidized first — the cheaper money. */
  subsidized: number;
  unsubsidized: number;
  /** Borrowed beyond the bill. */
  excess: number;
}

/** Most a student could accept this term. */
export function maxAcceptable(input: LoanInput): number {
  return input.subsidizedAvailable + input.unsubsidizedAvailable;
}

/**
 * The verdict for accepting `amount` of the loans offered.
 *
 * This is division and comparison, not a model. The bands are:
 *   covers  — at or under the bill. Nothing borrowed that is not owed.
 *   extra   — past the bill, but the extra is subsidized, so no interest
 *             accrues while enrolled at least half time.
 *   costly  — past the bill on unsubsidized money, which charges interest
 *             from the day it disburses.
 */
export function evaluateLoan(input: LoanInput, amount: number): LoanVerdict {
  const accepted = Math.max(0, Math.min(amount, maxAcceptable(input)));
  const subsidized = Math.min(accepted, input.subsidizedAvailable);
  const unsubsidized = accepted - subsidized;
  const excess = Math.max(0, accepted - input.owed);
  const unsubsidizedBeyondBill = Math.max(
    0,
    accepted - Math.max(input.owed, input.subsidizedAvailable),
  );

  let band: LoanBand = 'covers';
  if (accepted > input.owed) {
    band = unsubsidizedBeyondBill === 0 ? 'extra' : 'costly';
  }

  return { band, ...LOAN_COPY[band], subsidized, unsubsidized, excess };
}
