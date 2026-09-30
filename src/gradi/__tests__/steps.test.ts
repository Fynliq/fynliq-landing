import { describe, expect, it } from 'vitest';
import {
  GRADI_STEPS,
  TOTAL_STEPS,
  parseProgress,
  progressPercent,
  serialiseProgress,
  toggleStep,
} from '../steps';
import { GRADI_CODE, GRADI_FEE, GRADI_LINK, GRADI_PAYOUT } from '../offer';

describe('the offer', () => {
  it('is a referral link, so the page can mark it sponsored', () => {
    expect(GRADI_LINK.startsWith('https://')).toBe(true);
  });

  it('carries the figures as Gradi states them, not as anything derived', () => {
    expect(GRADI_PAYOUT).toBe('$10');
    expect(GRADI_FEE).toBe('$5');
  });

  it('names the code in the first step, so the two cannot drift apart', () => {
    expect(GRADI_STEPS[0].body).toContain(GRADI_CODE);
  });
});

describe('the steps', () => {
  it('are the six the walkthrough counts', () => {
    expect(TOTAL_STEPS).toBe(6);
  });

  it('every one says what to do and what it means', () => {
    for (const step of GRADI_STEPS) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.body.length).toBeGreaterThan(0);
    }
  });
});

describe('parseProgress', () => {
  it('starts empty when nothing has been stored', () => {
    expect(parseProgress(null).size).toBe(0);
  });

  it('reads back what was written', () => {
    const done = new Set([0, 3]);
    expect([...parseProgress(serialiseProgress(done))].sort()).toEqual([0, 3]);
  });

  it('survives a value that is not JSON at all', () => {
    expect(parseProgress('not json {{').size).toBe(0);
  });

  it('survives JSON that is not a list', () => {
    expect(parseProgress('{"done":[1]}').size).toBe(0);
    expect(parseProgress('42').size).toBe(0);
  });

  it('drops entries that are not whole numbers', () => {
    expect([...parseProgress('["1", null, 2.5, true, 3]')]).toEqual([3]);
  });

  /**
   * The list shortening is the case that matters: a student who ticked step
   * six under an older build must not leave an index pointing past the end.
   */
  it('drops indexes outside the current list', () => {
    expect([...parseProgress('[-1, 0, 99]')]).toEqual([0]);
  });

  it('counts a repeated index once', () => {
    expect(parseProgress('[2, 2, 2]').size).toBe(1);
  });
});

describe('serialiseProgress', () => {
  it('sorts, so the stored value is stable however it was ticked', () => {
    expect(serialiseProgress(new Set([4, 0, 2]))).toBe('[0,2,4]');
  });
});

describe('toggleStep', () => {
  it('ticks a step that was not ticked', () => {
    expect([...toggleStep(new Set(), 2)]).toEqual([2]);
  });

  it('unticks one that was, because a student can be wrong', () => {
    expect([...toggleStep(new Set([2]), 2)]).toEqual([]);
  });

  it('leaves the set it was given alone', () => {
    const before = new Set([1]);
    toggleStep(before, 4);
    expect([...before]).toEqual([1]);
  });
});

describe('progressPercent', () => {
  it('is nothing at the start and everything at the end', () => {
    expect(progressPercent(new Set())).toBe(0);
    expect(progressPercent(new Set([0, 1, 2, 3, 4, 5]))).toBe(100);
  });

  it('rounds to a whole percent', () => {
    expect(progressPercent(new Set([0]))).toBe(17);
    expect(progressPercent(new Set([0, 1, 2]))).toBe(50);
  });
});
