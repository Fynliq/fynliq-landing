import type { Award, RunwayInput } from './types';

export type RunwayTone = 'on-track' | 'check' | 'short';

export interface RunwayReady {
  status: 'ready';
  moneyLeft: number;
  spent: number;
  /** Whole days from today until the next disbursement. */
  daysRemaining: number;
  /** Money left divided across the weeks remaining, rounded down. */
  safeWeekly: number;
  until: { date: string; label: string };
  tone: RunwayTone;
}

export interface RunwayUnavailable {
  status: 'unavailable';
  moneyLeft: number;
  spent: number;
  /** `missing` — no date was ever added. `passed` — the date is in the past. */
  reason: 'missing' | 'passed';
  /** What the interface asks the student to do instead of showing a number. */
  prompt: string;
}

export type Runway = RunwayReady | RunwayUnavailable;

const DAY_MS = 86_400_000;

/** Parsed as UTC so the result does not shift with the viewer's timezone. */
function daysBetween(from: string, to: string): number {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/**
 * Cash the student can actually spend before the next disbursement.
 *
 * Work-study is excluded on purpose. It is wages for hours worked, so counting
 * it would tell a student they have money in September that they have not
 * earned yet. This function only ever reads `moneyLeft`; the award is taken
 * so the exclusion is explicit and can be tested.
 */
export function spendableCash(input: RunwayInput, _award: Award): number {
  return input.moneyLeft;
}

/**
 * The money runway and the weekly safe-to-spend figure.
 *
 * Rule 3 of the handoff: with no disbursement date there is no weekly number.
 * We return a prompt instead of dividing by a guess.
 */
export function computeRunway(
  input: RunwayInput,
  award: Award,
  figuresVerified: boolean,
): Runway {
  const moneyLeft = spendableCash(input, award);
  const { spent } = input;

  if (input.nextDisbursement === null) {
    return {
      status: 'unavailable',
      moneyLeft,
      spent,
      reason: 'missing',
      prompt: 'Add your next disbursement date to see a weekly number.',
    };
  }

  const daysRemaining = daysBetween(input.today, input.nextDisbursement.date);

  if (daysRemaining <= 0) {
    return {
      status: 'unavailable',
      moneyLeft,
      spent,
      reason: 'passed',
      prompt: 'That disbursement date has passed. Add the next one.',
    };
  }

  const safeWeekly = Math.floor((moneyLeft * 7) / daysRemaining);

  let tone: RunwayTone = 'on-track';
  if (moneyLeft <= 0) tone = 'short';
  else if (!figuresVerified) tone = 'check';

  return {
    status: 'ready',
    moneyLeft,
    spent,
    daysRemaining,
    safeWeekly,
    until: input.nextDisbursement,
    tone,
  };
}
