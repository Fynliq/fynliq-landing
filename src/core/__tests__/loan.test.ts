import { describe, expect, it } from 'vitest';
import { evaluateLoan, maxAcceptable } from '../loan';
import type { LoanInput } from '../loan';

const student: LoanInput = {
  owed: 1_800,
  subsidizedAvailable: 2_750,
  unsubsidizedAvailable: 1_000,
};

describe('evaluateLoan', () => {
  it('is green at or under the bill', () => {
    expect(evaluateLoan(student, 0).tone).toBe('green');
    expect(evaluateLoan(student, 1_800).band).toBe('covers');
  });

  it('turns gold one dollar past the bill', () => {
    const verdict = evaluateLoan(student, 1_801);
    expect(verdict.band).toBe('extra');
    expect(verdict.tone).toBe('gold');
    expect(verdict.excess).toBe(1);
  });

  it('turns rust once the extra is unsubsidized', () => {
    expect(evaluateLoan(student, 2_750).tone).toBe('gold');
    expect(evaluateLoan(student, 2_751).tone).toBe('rust');
  });

  it('fills subsidized money first', () => {
    const verdict = evaluateLoan(student, 3_000);
    expect(verdict.subsidized).toBe(2_750);
    expect(verdict.unsubsidized).toBe(250);
  });

  it('stays green when the bill itself needs unsubsidized money', () => {
    const bigBill: LoanInput = { ...student, owed: 3_000 };
    const verdict = evaluateLoan(bigBill, 3_000);
    expect(verdict.tone).toBe('green');
    expect(verdict.unsubsidized).toBe(250);
  });

  it('never accepts more than is offered', () => {
    expect(maxAcceptable(student)).toBe(3_750);
    const verdict = evaluateLoan(student, 99_999);
    expect(verdict.subsidized + verdict.unsubsidized).toBe(3_750);
  });

  it('always states the verdict in words, not only colour', () => {
    for (const amount of [0, 1_800, 2_500, 3_500]) {
      expect(evaluateLoan(student, amount).headline.length).toBeGreaterThan(0);
    }
  });
});
