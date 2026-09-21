import { describe, expect, it } from 'vitest';
import { analyseOutcome, buildNextSteps, type AidAnalysis } from '../analysis';
import { analysisFromFacts, tidyLabel } from '../documentAnalysis';

type Fact = NonNullable<AidAnalysis['summaryFacts']>[number];

let n = 0;
const fact = (over: Partial<Fact>): Fact => ({
  id: `f${++n}`, field: 'grantOffer', label: 'Federal Pell Grant', value: '1,000.00', page: 1, document: 1,
  kind: 'award-letter', period: 'Not stated', estimated: false, quote: 'Federal Pell Grant 1,000.00', ...over,
});

const read = (facts: Fact[]): AidAnalysis => ({
  provenance: 'document',
  document: { fileNames: ['IMG_0001.png'], kind: 'award-letter', readAt: '2026-09-01T10:00:00.000Z', confidence: 0.6 },
  student: { firstName: null, school: null },
  sai: null,
  award: { year: 'Not stated', source: 'Uploaded aid documents', costOfAttendance: null, lines: [] },
  semester: null,
  unread: [],
  summaryFacts: facts,
  summaryToken: 'token',
});

// Invented figures, laid out like a portal Accept/Decline table.
const PORTAL = [
  fact({ label: 'Federal Pell Grant', value: '6,100.00' }),
  fact({ label: 'Institutional Grant', value: '4,200.00' }),
  fact({ field: 'subsidizedLoanOffer', label: 'Direct Subsidized Loan', value: '3,500.00' }),
  fact({ field: 'unsubsidizedLoanOffer', label: 'Direct Unsubsidized Loan', value: '2,000.00' }),
];

describe('analysisFromFacts', () => {
  it('turns a portal award table into the colored award lines', () => {
    const a = analysisFromFacts(read(PORTAL));
    expect(a.award.lines.map((l) => [l.label, l.kind, l.amount])).toEqual([
      ['Federal Pell Grant', 'grant', 6100],
      ['Institutional Grant', 'grant', 4200],
      ['Direct Subsidized Loan', 'subsidized-loan', 3500],
      ['Direct Unsubsidized Loan', 'unsubsidized-loan', 2000],
    ]);
    const { aid, headline } = analyseOutcome(a);
    expect(aid.giftAid).toBe(10300);
    expect(aid.loansOffered).toBe(5500);
    expect(aid.offered).toBe(15800);
    expect(headline.sentence).toBe('$10,300 of your $15,800 offer is money you keep.');
    expect(a.award.lines[1].meaning).toBe("Your school's own money, never repaid");
  });

  it('adds term amounts into one yearly line, and prefers a printed yearly total', () => {
    const terms = analysisFromFacts(read([
      fact({ value: '3,050.00', period: 'Fall 2026' }),
      fact({ value: '3,050.00', period: 'Spring 2027' }),
    ]));
    expect(terms.award.lines).toHaveLength(1);
    expect(terms.award.lines[0].amount).toBe(6100);
    expect(terms.award.year).toBe('2026–27');

    const withTotal = analysisFromFacts(read([
      fact({ value: '3,050.00', period: 'Fall 2026' }),
      fact({ value: '3,050.00', period: 'Spring 2027' }),
      fact({ value: '6,100.00', period: '2026-2027' }),
    ]));
    expect(withTotal.award.lines[0].amount).toBe(6100);
  });

  it('tidies all-caps portal codes into readable labels', () => {
    expect(tidyLabel('FED DIRECT LOAN-SUBSIDIZED 1')).toBe('Fed Direct Loan-Subsidized');
    expect(tidyLabel('Federal Pell Grant')).toBe('Federal Pell Grant');
  });

  it('shows FAFSA estimates as estimates, never as a school offer', () => {
    const a = analysisFromFacts(read([
      fact({ field: 'estimatedPellGrant', value: '$6,100', estimated: true, kind: 'fafsa-submission-summary' }),
      fact({ field: 'unsubsidizedLoanOffer', label: 'Federal Direct Loans', value: '$5,500', estimated: true, kind: 'fafsa-submission-summary' }),
    ]));
    expect(a.estimatesOnly).toBe(true);
    const outcome = analyseOutcome(a);
    expect(outcome.headline.sentence).toBe('Your FAFSA estimate shows up to $6,100 in grants.');
    expect(outcome.headline.sentence).not.toMatch(/Not stated/);
    expect(buildNextSteps(a, outcome).some((s) => s.id === 'find-offer')).toBe(true);
    expect(a.unread.map((u) => u.field)).toContain("Your school's award offer");
  });

  it('keeps FAFSA estimates beside a school offer instead of adding them in', () => {
    const a = analysisFromFacts(read([
      ...PORTAL,
      fact({ field: 'estimatedPellGrant', value: '$6,100', estimated: true, kind: 'fafsa-submission-summary' }),
    ]));
    expect(a.estimatesOnly).toBe(false);
    expect(analyseOutcome(a).aid.giftAid).toBe(10300);
    expect(a.estimateLines).toHaveLength(1);
  });

  it('builds the bill from a statement and caps loans at what is owed', () => {
    const a = analysisFromFacts(read([
      ...PORTAL,
      fact({ field: 'schoolBill', label: 'Tuition and fees', value: '8,000.00', kind: 'account-statement', period: 'Fall 2026' }),
      fact({ field: 'paymentApplied', label: 'Grants applied', value: '6,500.00', kind: 'account-statement', period: 'Fall 2026' }),
    ]));
    expect(a.semester).toEqual({ bill: 8000, grantsApplied: 6500, subsidizedAvailable: 3500, unsubsidizedAvailable: 2000 });
    const { balance } = analyseOutcome(a);
    expect(balance?.stillOwed).toBe(1500);
  });

  it('reads the SAI and cost of attendance, and lists what is still missing', () => {
    const a = analysisFromFacts(read([
      ...PORTAL,
      fact({ field: 'sai', label: 'Student Aid Index', value: '0', kind: 'fafsa-submission-summary' }),
      fact({ field: 'costOfAttendance', label: 'Cost of attendance', value: '24,000', period: '2026-2027' }),
    ]));
    expect(a.sai).toBe(0);
    expect(a.award.costOfAttendance).toBe(24000);
    expect(analyseOutcome(a).aid.uncovered).toBe(8200);
    expect(a.unread.map((u) => u.field)).toEqual(["This term's bill", 'Next disbursement date']);
  });

  it('does not claim a $0 offer when only an SAI was found', () => {
    const a = analysisFromFacts(read([fact({ field: 'sai', label: 'Student Aid Index', value: '1500', kind: 'fafsa-submission-summary' })]));
    expect(analyseOutcome(a).headline.sentence).toBe('Your Student Aid Index is 1,500.');
  });
});
