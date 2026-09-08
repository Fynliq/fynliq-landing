/**
 * Domain types for Fynliq's money layer.
 *
 * Everything here is data the student (or their award document) provides.
 * Nothing in `core/` invents a figure: a value that is not known is `null`,
 * and every calculation is required to say so rather than guess.
 */

/** How a line on an award is treated financially. */
export type AwardKind =
  /** Gift aid. Money the student keeps and never repays. */
  | 'grant'
  /** Borrowed. Repaid, no interest while enrolled at least half time. */
  | 'subsidized-loan'
  /** Borrowed. Interest starts the day it disburses. */
  | 'unsubsidized-loan'
  /** Wages for hours worked. Never a lump sum, never part of the runway. */
  | 'work-study';

export interface AwardLine {
  id: string;
  label: string;
  /** One plain-English sentence. Shown next to the amount. */
  meaning: string;
  kind: AwardKind;
  /** Whole dollars, for the full award year. */
  amount: number;
  /** True when the figure was read from the student's own document. */
  verified: boolean;
}

export interface Award {
  /** e.g. '2026-27'. */
  year: string;
  /** Where the figures came from, shown verbatim in the UI. */
  source: string;
  lines: AwardLine[];
  /**
   * Full cost of attendance for the year, when the student's document
   * actually stated it. `null` means it was not found — never estimated.
   */
  costOfAttendance: number | null;
}

export interface Semester {
  /** What the school is billing this term. */
  bill: number;
  /** Gift aid already applied to that bill this term. */
  grantsApplied: number;
  /** Subsidized loan money available to accept this term. */
  subsidizedAvailable: number;
  /** Unsubsidized loan money available to accept this term. */
  unsubsidizedAvailable: number;
}

export interface RunwayInput {
  /** Cash actually in hand for the term. */
  moneyLeft: number;
  /** Spent so far this term. Display only — already excluded from moneyLeft. */
  spent: number;
  /** The day the next disbursement lands. `null` when the student has not added it. */
  nextDisbursement: { date: string; label: string } | null;
  /** Today, injected so the calculation stays pure and testable. */
  today: string;
}
