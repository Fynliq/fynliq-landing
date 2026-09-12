import { amountStillOwed, breakDownAward, type AidBreakdown } from './aid';
import { evaluateLoan, maxAcceptable, type LoanVerdict } from './loan';
import { formatUSD } from './money';
import type { Award, Semester } from './types';

/**
 * What Fynliq reads out of a student's own aid documents, and what it concludes
 * from it.
 *
 * The shape below is the contract between the upload flow and whatever reads
 * the document — today a stub, tomorrow the backend. Everything downstream of
 * it is a pure function in this file, so connecting the real reader changes
 * where an `AidAnalysis` comes from and nothing about what is done with it.
 *
 * Rule 1 of the architecture still holds: no component computes a dollar
 * figure. `analyseOutcome` and `buildNextSteps` do, and they are tested.
 */

/** A figure the document did not state. Never estimated, never filled in. */
export interface UnreadField {
  /** What is missing, named the way the student would name it. */
  field: string;
  /** Where it is normally printed, so they can supply it themselves. */
  where: string;
}

export type DocumentKind =
  | 'fafsa-submission-summary'
  | 'award-letter'
  | 'account-statement'
  | 'unknown';

export const DOCUMENT_LABEL: Record<DocumentKind, string> = {
  'fafsa-submission-summary': 'FAFSA Submission Summary',
  'award-letter': 'financial aid award letter',
  'account-statement': 'student account statement',
  unknown: 'uploaded document',
};

/**
 * Where the figures came from. `demo` exists so the interface can never
 * present the placeholder student as if it were the person who uploaded a
 * file — the results page says so, in words, at the top.
 */
export type Provenance = 'document' | 'demo';

export interface AidAnalysis {
  provenance: Provenance;
  document: {
    /** The files this was read from, echoed back so the student can confirm. */
    fileNames: string[];
    kind: DocumentKind;
    /** ISO-8601. When the read happened. */
    readAt: string;
    /** 0–1. At or under `CONFIDENCE_FLOOR` the result is flagged for checking. */
    confidence: number;
  };
  student: {
    firstName: string | null;
    school: string | null;
  };
  /** Student Aid Index, when the document stated it. `null` when it did not. */
  sai: number | null;
  award: Award;
  /** This term's bill and what is applied to it. `null` when not stated. */
  semester: Semester | null;
  unread: UnreadField[];
}

/** Below this, the read is presented as something to check before acting on. */
export const CONFIDENCE_FLOOR = 0.7;

/* ------------------------------------------------------------------------ *
 *  Student Aid Index
 * ------------------------------------------------------------------------ */

export type SaiBand = 'unknown' | 'maximum-need' | 'high-need' | 'moderate-need' | 'lower-need';

export interface SaiReading {
  value: number | null;
  band: SaiBand;
  /** What the number means, in one sentence the student can act on. */
  meaning: string;
}

/**
 * The wording is deliberately hedged, and deliberately carries no dollar
 * figure. The SAI thresholds that decide a Pell award are set federally and
 * move every award year; stating one here would be exactly the kind of
 * invented figure the rest of this codebase refuses to print.
 */
const SAI_MEANING: Record<SaiBand, string> = {
  unknown:
    'Your Student Aid Index was not stated on what you uploaded, so nothing on this page is inferred from it. It is printed on the first page of your FAFSA Submission Summary.',
  'maximum-need':
    'A zero or negative Student Aid Index is the strongest need signal the formula produces. It normally puts you in line for the largest Pell Grant your award year allows.',
  'high-need':
    'A low Student Aid Index leaves most of your cost of attendance counted as need, and need is what your school draws its own grant money against.',
  'moderate-need':
    'A middling Student Aid Index still leaves real need for your school to meet, though it usually sits above the line where the largest Pell awards are made.',
  'lower-need':
    'A higher Student Aid Index leaves less of your cost counted as need, so more of an offer tends to arrive as loans rather than as grants.',
};

function bandFor(value: number | null): SaiBand {
  if (value === null) return 'unknown';
  if (value <= 0) return 'maximum-need';
  if (value <= 3_000) return 'high-need';
  if (value <= 9_000) return 'moderate-need';
  return 'lower-need';
}

export function readSai(value: number | null): SaiReading {
  const band = bandFor(value);
  return { value, band, meaning: SAI_MEANING[band] };
}

/* ------------------------------------------------------------------------ *
 *  This term's bill
 * ------------------------------------------------------------------------ */

export interface SchoolBalance {
  /** What the school is charging this term. */
  bill: number;
  /** Gift aid already applied against it. */
  grantsApplied: number;
  /** Bill minus that gift aid. What the student is actually asked for. */
  stillOwed: number;
  /** The most the student could accept in loans this term. */
  loansAvailable: number;
  /** Still owed after accepting every loan offered. Zero when they cover it. */
  afterAllLoans: number;
  /**
   * The verdict at exactly the amount owed — the point worth stopping at.
   * Rendered so the student sees the advice at the ceiling, not just below it.
   */
  ceiling: LoanVerdict;
}

function readBalance(semester: Semester | null): SchoolBalance | null {
  if (semester === null) return null;

  const stillOwed = amountStillOwed(semester.bill, semester.grantsApplied);
  const input = {
    owed: stillOwed,
    subsidizedAvailable: semester.subsidizedAvailable,
    unsubsidizedAvailable: semester.unsubsidizedAvailable,
  };
  const loansAvailable = maxAcceptable(input);

  return {
    bill: semester.bill,
    grantsApplied: semester.grantsApplied,
    stillOwed,
    loansAvailable,
    afterAllLoans: Math.max(0, stillOwed - loansAvailable),
    ceiling: evaluateLoan(input, stillOwed),
  };
}

/* ------------------------------------------------------------------------ *
 *  The answer
 * ------------------------------------------------------------------------ */

export interface Headline {
  tone: 'green' | 'gold' | 'rust';
  /** The answer itself. One sentence, with the figure it turns on. */
  sentence: string;
  /** How that figure was arrived at, so the student can check it. */
  detail: string;
}

export interface AnalysisOutcome {
  aid: AidBreakdown;
  sai: SaiReading;
  balance: SchoolBalance | null;
  headline: Headline;
  /** True when the read should be checked against the portal before acting. */
  needsChecking: boolean;
}

function buildHeadline(aid: AidBreakdown, balance: SchoolBalance | null): Headline {
  if (balance === null) {
    return {
      tone: 'gold',
      sentence: `${formatUSD(aid.giftAid)} of your ${formatUSD(aid.offered)} offer is money you keep.`,
      detail: `The remaining ${formatUSD(aid.loansOffered)} is borrowed and repaid. What you uploaded did not state this term's bill, so Fynliq will not claim the offer covers it — add the bill and this becomes a yes or a no.`,
    };
  }

  if (balance.afterAllLoans > 0) {
    return {
      tone: 'rust',
      sentence: `${formatUSD(balance.afterAllLoans)} of this term's bill has nothing covering it.`,
      detail: `Gift aid takes your bill of ${formatUSD(balance.bill)} down to ${formatUSD(balance.stillOwed)}. Every loan you were offered this term adds up to ${formatUSD(balance.loansAvailable)}, which leaves the gap above. This is the number worth acting on first.`,
    };
  }

  if (balance.stillOwed > 0) {
    return {
      tone: 'gold',
      sentence: `Your bill is covered — but the last ${formatUSD(balance.stillOwed)} of it has to be borrowed.`,
      detail: `${formatUSD(balance.grantsApplied)} of gift aid was already applied to your bill of ${formatUSD(balance.bill)}. Accepting ${formatUSD(balance.stillOwed)} in loans clears the rest, and that is the figure to stop at: you were offered ${formatUSD(balance.loansAvailable)}, and the difference is money you would repay without owing it.`,
    };
  }

  return {
    tone: 'green',
    sentence: 'Your gift aid covers this term’s bill in full.',
    detail: `${formatUSD(balance.grantsApplied)} of grant money was applied to your bill of ${formatUSD(balance.bill)}, so the school is not asking you for anything this term and nothing has to be borrowed to attend it.`,
  };
}

export function analyseOutcome(analysis: AidAnalysis): AnalysisOutcome {
  const aid = breakDownAward(analysis.award);
  const balance = readBalance(analysis.semester);

  return {
    aid,
    balance,
    sai: readSai(analysis.sai),
    headline: buildHeadline(aid, balance),
    needsChecking: analysis.document.confidence < CONFIDENCE_FLOOR,
  };
}

/* ------------------------------------------------------------------------ *
 *  What to do next
 * ------------------------------------------------------------------------ */

export type StepUrgency = 'rust' | 'gold' | 'low';

export interface NextStep {
  id: string;
  title: string;
  /** What happens if this is not done. The reason it is on the list at all. */
  why: string;
  /** The concrete thing to do, specific enough to act on today. */
  action: string;
  urgency: StepUrgency;
}

const URGENCY_RANK: Record<StepUrgency, number> = { rust: 0, gold: 1, low: 2 };

/**
 * The next steps, ordered by what it costs to skip them.
 *
 * Every step is produced by a rule reading the student's own figures. Nothing
 * here invents a scholarship, a deadline or an amount: where a date matters it
 * is a published federal one (FAFSA opens 1 October) and is described as such.
 */
export function buildNextSteps(analysis: AidAnalysis, outcome: AnalysisOutcome): NextStep[] {
  const { aid, balance } = outcome;
  const steps: NextStep[] = [];

  if (outcome.needsChecking) {
    steps.push({
      id: 'check-read',
      title: 'Check these figures against your portal before you act on them',
      why: 'Parts of your document were hard to read, and a wrong figure here would lead to a wrong decision about borrowing.',
      action: `Open your school's financial aid portal and compare the ${analysis.award.lines.length} award lines below against what it shows.`,
      urgency: 'rust',
    });
  }

  if (balance && balance.afterAllLoans > 0) {
    steps.push({
      id: 'close-gap',
      title: `Close the ${formatUSD(balance.afterAllLoans)} your aid does not reach`,
      why: 'Your school will ask for this before the term is billed, and the options that cost least — grants, payment plans, an appeal — are the ones with the earliest cut-offs.',
      action: 'Email your aid office, say your aid falls short of your bill by this amount, and ask what institutional grant, appeal or interest-free payment plan is available.',
      urgency: 'rust',
    });
  }

  if (balance && balance.stillOwed > 0 && balance.loansAvailable > 0) {
    steps.push({
      id: 'accept-loans',
      title: `Accept ${formatUSD(Math.min(balance.stillOwed, balance.loansAvailable))} of your loans, and no more`,
      why: 'Loans are an offer, not a deposit. Accepting the whole amount when you only owe part of it means repaying money you never needed.',
      action: `Your portal's Accept/Decline page takes a custom amount. ${formatUSD(balance.ceiling.subsidized)} of it is subsidized, which charges no interest while you are enrolled at least half time.`,
      urgency: 'gold',
    });
  }

  if (balance && balance.loansAvailable > balance.stillOwed) {
    steps.push({
      id: 'decline-extra',
      title: `Decline the ${formatUSD(balance.loansAvailable - balance.stillOwed)} you were offered beyond your bill`,
      why: 'It is borrowed money with nothing owed against it. Declining it costs you nothing now and removes it from what you repay later.',
      action: 'Decline it on the same page. You can request it again later in the year if something changes.',
      urgency: 'gold',
    });
  }

  if (aid.uncovered !== null && aid.uncovered > 0) {
    steps.push({
      id: 'ask-institutional',
      title: `Ask your aid office about the ${formatUSD(aid.uncovered)} of your year nothing is covering`,
      why: "Your cost of attendance is higher than everything you were offered. Schools hold grant money back for students who ask, and asking is free.",
      action: 'Ask three questions: is any institutional grant still unawarded, does my file qualify for a professional judgement review, and is there a departmental or state award I should be applying for.',
      urgency: 'gold',
    });
  }

  if (analysis.unread.length > 0) {
    steps.push({
      id: 'add-missing',
      title: `Add the ${analysis.unread.length === 1 ? 'figure' : `${analysis.unread.length} figures`} Fynliq could not read`,
      why: 'Each missing figure is a part of the picture left blank rather than guessed at — including, where it applies, your weekly safe-to-spend.',
      action: `Still missing: ${analysis.unread.map((entry) => entry.field).join(', ')}.`,
      urgency: 'gold',
    });
  }

  if (aid.workStudy > 0) {
    steps.push({
      id: 'start-work-study',
      title: 'Find a work-study job early in the term',
      why: `Your ${formatUSD(aid.workStudy)} of work-study is wages for hours worked, not a lump sum. Unworked hours are simply not paid, and the good placements go in the first weeks.`,
      action: "Search your school's student employment listings for roles marked work-study, and apply before classes settle.",
      urgency: 'low',
    });
  }

  steps.push({
    id: 'renew-fafsa',
    title: 'Renew your FAFSA when it opens on 1 October',
    why: 'Renewal is not automatic, and missing it is the most common way a student loses a Pell Grant they were otherwise entitled to.',
    action: 'Set a reminder for 1 October and renew at studentaid.gov. Most fields carry over from this year.',
    urgency: 'low',
  });

  return steps.sort((a, b) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency]);
}
