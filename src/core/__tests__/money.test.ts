import { describe, expect, it } from 'vitest';
import { formatDeduction, formatRange, formatUSD } from '../money';

describe('formatting', () => {
  it('shows whole dollars', () => {
    expect(formatUSD(2_555)).toBe('$2,555');
    expect(formatUSD(134.47)).toBe('$134');
  });

  it('uses a real minus sign for deductions', () => {
    expect(formatDeduction(6_400)).toBe('\u2212$6,400');
  });

  it('keeps one dollar sign in a range', () => {
    expect(formatRange(500, 5_000)).toBe('$500\u20135,000');
  });
});
