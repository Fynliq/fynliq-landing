import type { AidAnalysis, DocumentKind, UnreadField } from './analysis';
import type { AwardKind, AwardLine, Semester } from './types';

/**
 * Turns the figures the document reader verified into the award, SAI and
 * bill that the results page draws its colored boxes from.
 *
 * Nothing is invented here. Every amount is one the reader found printed in
 * the student's own upload; a figure that was not found stays `null` and is
 * listed under "What Fynliq could not read". Estimates (FAFSA results) are
 * never mixed into a school offer: when both are present the offer is used
 * and the estimates are shown beside it.
 */

type Fact = NonNullable<AidAnalysis['summaryFacts']>[number];

const KIND: Record<string, AwardKind> = {
  grantOffer: 'grant',
  scholarshipOffer: 'grant',
  estimatedPellGrant: 'grant',
  subsidizedLoanOffer: 'subsidized-loan',
  unsubsidizedLoanOffer: 'unsubsidized-loan',
  workStudyOffer: 'work-study',
};

const TERM = /\b(?:fall|spring|summer|winter|autumn|semester|term|quarter|trimester)\b/i;
const amountOf = (f: Fact) => Number(f.value.replace(/[$,\s]/g, ''));
const norm = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const whole = (n: number) => Math.round(n);
const uniqueAmounts = (facts: Fact[]) => [...new Set(facts.map(amountOf).filter(Number.isFinite))];

/** "FED DIRECT LOAN-SUBSIDIZED 1" -> "Fed Direct Loan-Subsidized". */
export function tidyLabel(label: string): string {
  let text = label.trim().replace(/\s+\d{1,2}$/, '');
  if (/[A-Z]/.test(text) && text === text.toUpperCase()) {
    text = text.toLowerCase().replace(/(^|[\s\-/(])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
  }
  return text || label.trim();
}

function meaningFor(kind: AwardKind, field: string, label: string, estimated: boolean): string {
  if (estimated) {
    return kind === 'grant'
      ? 'Federal estimate from your FAFSA, not a school award yet'
      : 'Federal estimate from your FAFSA. Repaid with interest if borrowed';
  }
  switch (kind) {
    case 'grant':
      if (field === 'scholarshipOffer') return 'Scholarship money, never repaid';
      if (/pell/i.test(label)) return 'Free money, never repaid';
      if (/institution|universit|college|school|ugrd|merit|presidential|tuition/i.test(label)) return "Your school's own money, never repaid";
      return 'Grant money, never repaid';
    case 'subsidized-loan':
      return 'Repaid. No interest while enrolled';
    case 'unsubsidized-loan':
      return /sub/i.test(label) ? 'Repaid. Interest starts immediately' : 'Repaid with interest';
    case 'work-study':
      return 'Wages for hours worked. Not a lump sum';
  }
}

/** One award's yearly amount: a whole-year figure when printed, otherwise its terms added up. */
function yearlyAmount(facts: Fact[]): number {
  const year = facts.filter((f) => !TERM.test(f.period));
  if (year.length) return Math.max(...year.map(amountOf));
  const byTerm = new Map<string, number>();
  for (const f of facts) byTerm.set(norm(f.period), amountOf(f));
  return [...byTerm.values()].reduce((sum, n) => sum + n, 0);
}

function buildLines(facts: Fact[], prefix: string): AwardLine[] {
  const groups = new Map<string, Fact[]>();
  for (const f of facts) {
    const kind = KIND[f.field];
    if (!kind) continue;
    const key = `${kind}|${norm(tidyLabel(f.label))}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  return [...groups.values()].map((group, i) => {
    const first = group[0];
    const kind = KIND[first.field];
    const label = tidyLabel(first.label);
    return {
      id: `${prefix}-${i + 1}`,
      label,
      meaning: meaningFor(kind, first.field, label, first.estimated),
      kind,
      amount: whole(yearlyAmount(group)),
      verified: true,
    };
  }).filter((line) => line.amount > 0);
}

/** "2026-2027" -> "2026–27"; otherwise the years named in the periods. */
function awardYear(facts: Fact[]): string {
  const printed = facts.find((f) => f.field === 'awardYear')?.value ?? '';
  const years = [...`${printed} ${facts.map((f) => f.period).join(' ')}`.matchAll(/\b20(\d\d)\b/g)].map((m) => Number(m[1]));
  if (!years.length) return 'this award year';
  const low = Math.min(...years);
  const high = Math.max(...years);
  if (high === low + 1) return `20${low}–${String(high).padStart(2, '0')}`;
  if (high === low) return printed.trim() || `20${low}`;
  return 'this award year';
}

function readSemester(facts: Fact[], lines: Fact[]): Semester | null {
  const of = (field: string) => facts.filter((f) => f.field === field && !f.estimated);
  const bills = uniqueAmounts(of('schoolBill'));
  const dues = uniqueAmounts(of('balanceDue'));
  const payments = new Map<string, number>();
  for (const f of of('paymentApplied')) payments.set(`${norm(f.label)}|${norm(f.period)}`, amountOf(f));
  const paid = payments.size ? [...payments.values()].reduce((sum, n) => sum + n, 0) : null;

  let bill: number | null = null;
  let grantsApplied = 0;
  if (bills.length === 1) {
    bill = bills[0];
    grantsApplied = paid ?? (dues.length === 1 ? Math.max(0, bill - dues[0]) : 0);
  } else if (dues.length === 1) {
    bill = dues[0] + (paid ?? 0);
    grantsApplied = paid ?? 0;
  }
  if (bill === null) return null;

  // Loans offered for the statement's own term, when the offer is split by
  // term; otherwise the yearly offer, which is the most that can be accepted.
  const term = [...of('schoolBill'), ...of('balanceDue')].map((f) => norm(f.period)).find((p) => TERM.test(p));
  const loanFacts = (field: string) => lines.filter((f) => f.field === field && !f.estimated);
  const available = (field: string) => {
    const all = loanFacts(field);
    const sameTerm = term ? all.filter((f) => norm(f.period) === term) : [];
    if (sameTerm.length) return sameTerm.reduce((sum, f) => sum + amountOf(f), 0);
    const groups = new Map<string, Fact[]>();
    for (const f of all) groups.set(norm(tidyLabel(f.label)), [...(groups.get(norm(tidyLabel(f.label))) ?? []), f]);
    return [...groups.values()].reduce((sum, g) => sum + yearlyAmount(g), 0);
  };
  return {
    bill: whole(bill),
    grantsApplied: whole(Math.min(grantsApplied, bill)),
    subsidizedAvailable: whole(available('subsidizedLoanOffer')),
    unsubsidizedAvailable: whole(available('unsubsidizedLoanOffer')),
  };
}

export function analysisFromFacts(analysis: AidAnalysis): AidAnalysis {
  const facts = analysis.summaryFacts ?? [];
  if (!facts.length) return analysis;

  const awardFacts = facts.filter((f) => f.field in KIND);
  const offers = awardFacts.filter((f) => !f.estimated);
  const estimates = awardFacts.filter((f) => f.estimated);
  const estimatesOnly = offers.length === 0 && estimates.length > 0;

  const lines = buildLines(estimatesOnly ? estimates : offers, 'line');
  const estimateLines = estimatesOnly ? [] : buildLines(estimates, 'estimate');

  const sais = uniqueAmounts(facts.filter((f) => f.field === 'sai'));
  const sai = sais.length === 1 ? sais[0] : null;

  const coaFacts = facts.filter((f) => f.field === 'costOfAttendance' && !f.estimated);
  const coaYear = uniqueAmounts(coaFacts.filter((f) => !TERM.test(f.period)));
  const coaAll = uniqueAmounts(coaFacts);
  const costOfAttendance = coaYear.length === 1 ? whole(coaYear[0]) : coaAll.length === 1 ? whole(coaAll[0]) : null;

  const semester = readSemester(facts, offers);

  const unread: UnreadField[] = [];
  if (!lines.length) unread.push({ field: 'Your aid offer', where: "Your school portal's financial aid or Accept/Decline page, or your award letter" });
  if (estimatesOnly) unread.push({ field: "Your school's award offer", where: "Your school portal's Accept/Decline page, or your award letter" });
  if (sai === null) unread.push({ field: 'Student Aid Index', where: 'Page 1 of your FAFSA Submission Summary, or your studentaid.gov account' });
  if (costOfAttendance === null) unread.push({ field: 'Cost of attendance', where: "Your school's award letter or its cost of attendance page" });
  if (semester === null) unread.push({ field: "This term's bill", where: 'Your student account statement' });
  unread.push({ field: 'Next disbursement date', where: "Your school's disbursement calendar, or the refund date shown on your student account" });

  const kind: DocumentKind = offers.length ? 'award-letter'
    : estimates.length || sai !== null ? 'fafsa-submission-summary'
      : semester ? 'account-statement' : 'unknown';

  return {
    ...analysis,
    provenance: 'document',
    document: { ...analysis.document, kind, confidence: 0.8 },
    sai,
    award: { year: awardYear(facts), source: 'Your uploaded documents', lines, costOfAttendance },
    semester,
    unread,
    estimatesOnly,
    estimateLines,
  };
}
