import { describe, expect, it } from 'vitest';
import { computeRunway } from '../runway';
import { DEMO_AWARD, DEMO_RUNWAY, DEMO_RUNWAY_NO_DATE } from '../../data/demo';
import type { Award } from '../types';

describe('computeRunway', () => {
  it('counts the days to the next disbursement', () => {
    const runway = computeRunway(DEMO_RUNWAY, DEMO_AWARD, true);
    expect(runway.status).toBe('ready');
    if (runway.status !== 'ready') return;
    expect(runway.daysRemaining).toBe(133);
  });

  it('divides the money left across the weeks remaining, rounding down', () => {
    const runway = computeRunway(DEMO_RUNWAY, DEMO_AWARD, true);
    if (runway.status !== 'ready') throw new Error('expected a weekly figure');
    expect(runway.safeWeekly).toBe(134);
  });

  it('shows a prompt instead of a weekly number when no date was added', () => {
    const runway = computeRunway(DEMO_RUNWAY_NO_DATE, DEMO_AWARD, true);
    expect(runway.status).toBe('unavailable');
    if (runway.status !== 'unavailable') return;
    expect(runway.reason).toBe('missing');
    expect(runway).not.toHaveProperty('safeWeekly');
  });

  it('asks for a new date once the old one has passed', () => {
    const runway = computeRunway(
      { ...DEMO_RUNWAY, today: '2027-02-01' },
      DEMO_AWARD,
      true,
    );
    if (runway.status !== 'unavailable') throw new Error('expected no weekly figure');
    expect(runway.reason).toBe('passed');
  });

  it('leaves work-study out of the runway entirely', () => {
    const withMoreWorkStudy: Award = {
      ...DEMO_AWARD,
      lines: DEMO_AWARD.lines.map((line) =>
        line.kind === 'work-study' ? { ...line, amount: 9_999 } : line,
      ),
    };
    const before = computeRunway(DEMO_RUNWAY, DEMO_AWARD, true);
    const after = computeRunway(DEMO_RUNWAY, withMoreWorkStudy, true);
    expect(after).toEqual(before);
  });

  it('marks unverified figures as needing a check rather than on track', () => {
    const runway = computeRunway(DEMO_RUNWAY, DEMO_AWARD, false);
    if (runway.status !== 'ready') throw new Error('expected a weekly figure');
    expect(runway.tone).toBe('check');
  });

  it('flags a runway with nothing left', () => {
    const runway = computeRunway({ ...DEMO_RUNWAY, moneyLeft: 0 }, DEMO_AWARD, true);
    if (runway.status !== 'ready') throw new Error('expected a weekly figure');
    expect(runway.tone).toBe('short');
  });
});
