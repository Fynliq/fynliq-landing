import { describe, expect, it } from 'vitest';
import { analyseOutcome, buildNextSteps, readSai, type AidAnalysis } from '../analysis';
import { DEMO_AWARD, DEMO_SEMESTER } from '../../data/demo';
import type { Semester } from '../types';

/** The demo student, as the reader would hand them over. */
const base: AidAnalysis = {
  provenance: 'document',
  document: {
    fileNames: ['award-letter.pdf'],
    kind: 'award-letter',
    readAt: '2026-09-01T10:00:00.000Z',
    confidence: 0.92,
  },
  student: { firstName: 'Sam', school: 'State University' },
  sai: 0,
  award: DEMO_AWARD,
  semester: DEMO_SEMESTER,
  unread: [],
};

const withSemester = (semester: Semester | null): AidAnalysis => ({ ...base, semester });

describe('analyseOutcome', () => {
  it('reduces the bill by gift aid and reports what is left to borrow', () => {
    const { balance } = analyseOutcome(base);

    expect(balance?.stillOwed).toBe(1_800);
    expect(balance?.loansAvailable).toBe(3_750);
    expect(balance?.afterAllLoans).toBe(0);
  });

  it('puts the loan verdict at the amount owed, not at the amount offered', () => {
    const { balance } = analyseOutcome(base);

    // Stopping at the bill is the advice, so that is the point evaluated.
    expect(balance?.ceiling.band).toBe('covers');
    expect(balance?.ceiling.subsidized).toBe(1_800);
    expect(balance?.ceiling.excess).toBe(0);
  });

  it('answers in gold when the bill is only covered by borrowing', () => {
    expect(analyseOutcome(base).headline.tone).toBe('gold');
  });

  it('answers in green when gift aid clears the bill outright', () => {
    const covered = withSemester({ ...DEMO_SEMESTER, grantsApplied: DEMO_SEMESTER.bill });
    const { headline, balance } = analyseOutcome(covered);

    expect(balance?.stillOwed).toBe(0);
    expect(headline.tone).toBe('green');
  });

  it('answers in rust, with the gap, when every loan offered still falls short', () => {
    const short = withSemester({
      ...DEMO_SEMESTER,
      subsidizedAvailable: 500,
      unsubsidizedAvailable: 0,
    });
    const { headline, balance } = analyseOutcome(short);

    expect(balance?.afterAllLoans).toBe(1_300);
    expect(headline.tone).toBe('rust');
    expect(headline.sentence).toContain('$1,300');
  });

  it('refuses to say whether the offer covers a bill it was never given', () => {
    const { balance, headline } = analyseOutcome(withSemester(null));

    expect(balance).toBeNull();
    expect(headline.sentence).toContain('$12,800');
    expect(headline.detail).toContain('did not state');
  });

  it('flags a low-confidence read as needing checking', () => {
    const blurry: AidAnalysis = { ...base, document: { ...base.document, confidence: 0.5 } };

    expect(analyseOutcome(base).needsChecking).toBe(false);
    expect(analyseOutcome(blurry).needsChecking).toBe(true);
  });
});

describe('readSai', () => {
  it('reads zero and below as the strongest need signal', () => {
    expect(readSai(0).band).toBe('maximum-need');
    expect(readSai(-1_500).band).toBe('maximum-need');
  });

  it('separates the bands above zero', () => {
    expect(readSai(2_000).band).toBe('high-need');
    expect(readSai(6_000).band).toBe('moderate-need');
    expect(readSai(20_000).band).toBe('lower-need');
  });

  it('says where to find it rather than estimating one', () => {
    const unknown = readSai(null);

    expect(unknown.band).toBe('unknown');
    expect(unknown.value).toBeNull();
    expect(unknown.meaning).toContain('FAFSA Submission Summary');
  });
});

describe('buildNextSteps', () => {
  const stepsFor = (analysis: AidAnalysis) =>
    buildNextSteps(analysis, analyseOutcome(analysis));
  const idsFor = (analysis: AidAnalysis) => stepsFor(analysis).map((step) => step.id);

  it('orders by what it costs to skip the step', () => {
    const short = withSemester({
      ...DEMO_SEMESTER,
      subsidizedAvailable: 500,
      unsubsidizedAvailable: 0,
    });
    const rank = { rust: 0, gold: 1, low: 2 } as const;
    const ranks = stepsFor(short).map((step) => rank[step.urgency]);

    expect(ranks[0]).toBe(rank.rust);
    // Non-decreasing: nothing urgent is ever listed below something that is not.
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('puts checking the read above acting on it', () => {
    const blurry: AidAnalysis = { ...base, document: { ...base.document, confidence: 0.4 } };

    expect(idsFor(blurry)[0]).toBe('check-read');
  });

  it('names the amount to accept and the amount to decline', () => {
    const steps = stepsFor(base);
    const accept = steps.find((step) => step.id === 'accept-loans');
    const decline = steps.find((step) => step.id === 'decline-extra');

    expect(accept?.title).toContain('$1,800');
    // Offered $3,750 against an $1,800 bill leaves $1,950 worth declining.
    expect(decline?.title).toContain('$1,950');
  });

  it('does not suggest declining anything when the offer does not exceed the bill', () => {
    const exact = withSemester({
      ...DEMO_SEMESTER,
      subsidizedAvailable: 1_800,
      unsubsidizedAvailable: 0,
    });

    expect(idsFor(exact)).not.toContain('decline-extra');
  });

  it('asks for the figures it could not read, and names them', () => {
    const missing: AidAnalysis = {
      ...base,
      unread: [{ field: 'Next disbursement date', where: 'Your account statement.' }],
    };
    const step = stepsFor(missing).find((entry) => entry.id === 'add-missing');

    expect(step?.action).toContain('Next disbursement date');
    expect(idsFor(base)).not.toContain('add-missing');
  });

  it('always ends on FAFSA renewal', () => {
    const ids = idsFor(base);

    expect(ids.at(-1)).toBe('renew-fafsa');
  });
});
