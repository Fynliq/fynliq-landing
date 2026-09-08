import { describe, expect, it } from 'vitest';
import { amountStillOwed, breakDownAward } from '../aid';
import { DEMO_AWARD, DEMO_SEMESTER } from '../../data/demo';
import type { Award } from '../types';

describe('breakDownAward', () => {
  const result = breakDownAward(DEMO_AWARD);

  it('separates money kept from money repaid', () => {
    expect(result.giftAid).toBe(12_800);
    expect(result.loansOffered).toBe(7_500);
  });

  it('excludes work-study from the offered total', () => {
    expect(result.workStudy).toBe(2_400);
    expect(result.offered).toBe(20_300);
  });

  it('reports what nothing is covering', () => {
    expect(result.uncovered).toBe(6_300);
  });

  it('returns null rather than guessing when cost of attendance is unknown', () => {
    const withoutCoa: Award = { ...DEMO_AWARD, costOfAttendance: null };
    expect(breakDownAward(withoutCoa).uncovered).toBeNull();
  });
});

describe('amountStillOwed', () => {
  it('subtracts gift aid from the bill', () => {
    expect(amountStillOwed(DEMO_SEMESTER.bill, DEMO_SEMESTER.grantsApplied)).toBe(1_800);
  });

  it('never reports a negative bill', () => {
    expect(amountStillOwed(3_000, 4_000)).toBe(0);
  });
});
