import { describe, expect, it } from 'vitest';
import { EMPTY_BUDGET, itemTotal, parseAmount, summarize, termLength, type Budget } from '../budget';

const budget = (patch: Partial<Budget>): Budget => ({ ...EMPTY_BUDGET, ...patch });

describe('parseAmount', () => {
  it.each([
    ['1200', 1200], ['$1,200', 1200], ['1,200.50', 1200.5], [' 45.5 ', 45.5], ['0', 0], ['.75', 0.75], ['$ 30', 30],
  ])('reads %j as %d', (text, value) => {
    expect(parseAmount(text)).toEqual({ ok: true, value });
  });

  it.each([
    ['', 'empty'], ['   ', 'empty'], ['12,00', 'invalid'], ['1.2.3', 'invalid'], ['abc', 'invalid'], ['1.234', 'invalid'],
    ['-40', 'negative'], ['−40', 'negative'], ['1000001', 'too-large'],
  ])('rejects %j as %s rather than guessing', (text, reason) => {
    expect(parseAmount(text)).toEqual({ ok: false, reason });
  });
});

describe('termLength', () => {
  it('counts both the first and last day', () => {
    const term = termLength('2026-08-24', '2026-12-13');
    expect(term.status).toBe('ready');
    if (term.status !== 'ready') return;
    expect(term.days).toBe(112);
    expect(term.weeks).toBe(16);
  });

  it('never shows weekly figures without valid dates', () => {
    expect(termLength('', '2026-12-13').status).toBe('missing');
    expect(termLength('2026-02-31', '2026-05-01').status).toBe('invalid');
    expect(termLength('2026-12-13', '2026-08-24').status).toBe('reversed');
    expect(termLength('2026-01-01', '2027-06-01').status).toBe('too-long');
  });

  it('is not shifted by daylight-saving changes', () => {
    // Spans the November clock change in US time zones.
    const term = termLength('2026-10-25', '2026-11-07');
    expect(term.status === 'ready' && term.days).toBe(14);
  });
});

describe('itemTotal', () => {
  const term = { weeks: 16, months: 112 / (365.25 / 12) };
  it('counts a one-off amount once, with or without dates', () => {
    expect(itemTotal(500, 'once', term)).toBe(500);
    expect(itemTotal(500, 'once', null)).toBe(500);
  });
  it('multiplies repeating amounts across the term', () => {
    expect(itemTotal(60, 'weekly', term)).toBe(960);
    expect(itemTotal(12 * 100, 'monthly', { weeks: 52.18, months: 12 })).toBe(14400);
  });
  it('refuses to total a repeating amount without a term length', () => {
    expect(itemTotal(60, 'weekly', null)).toBe(null);
  });
});

describe('summarize', () => {
  const term = { termStart: '2026-08-24', termEnd: '2026-12-13' }; // 16 weeks

  it('adds starting cash and income, subtracts expenses', () => {
    const s = summarize(budget({
      ...term,
      startingCash: '1,000',
      income: [{ id: 'i1', label: 'Pay', amount: '150', frequency: 'weekly' }],
      expenses: [
        { id: 'e1', label: 'Groceries', amount: '60', frequency: 'weekly', category: 'food' },
        { id: 'e2', label: 'Books', amount: '400', frequency: 'once', category: 'school' },
      ],
    }));
    expect(s.incomeTotal).toBe(2400);
    expect(s.expenseTotal).toBe(1360);
    expect(s.leftOver).toBe(2040);
    expect(s.perWeek).toEqual({ spending: 85, leftOver: 127.5 });
    expect(s.tone).toBe('on-track');
  });

  it('marks a shortfall as short, and a thin margin as check', () => {
    const short = summarize(budget({ startingCash: '100', expenses: [{ id: 'e', label: 'Rent', amount: '700', frequency: 'once', category: 'housing' }] }));
    expect(short.leftOver).toBe(-600);
    expect(short.tone).toBe('short');
    const tight = summarize(budget({ startingCash: '1000', expenses: [{ id: 'e', label: 'Rent', amount: '960', frequency: 'once', category: 'housing' }] }));
    expect(tight.tone).toBe('check');
  });

  it('gives no weekly figures without dates, and holds back repeating items', () => {
    const s = summarize(budget({
      startingCash: '500',
      expenses: [
        { id: 'weekly', label: 'Food', amount: '50', frequency: 'weekly', category: 'food' },
        { id: 'once', label: 'Books', amount: '100', frequency: 'once', category: 'school' },
      ],
    }));
    expect(s.perWeek).toBe(null);
    expect(s.waitingForDates).toEqual(['weekly']);
    expect(s.expenseTotal).toBe(100);
    expect(s.leftOver).toBe(400);
  });

  it('leaves unreadable amounts out of every total and names them', () => {
    const s = summarize(budget({
      startingCash: 'lots',
      income: [{ id: 'bad', label: 'Pay', amount: '12,00', frequency: 'once' }],
      expenses: [{ id: 'blank', label: 'New item', amount: '', frequency: 'once', category: 'other' }],
    }));
    expect(s.invalid).toEqual(['startingCash', 'bad']);
    expect(s.leftOver).toBe(0);
    // A blank amount is unfinished, not wrong.
    expect(s.invalid.includes('blank')).toBe(false);
    expect(s.empty).toBe(true);
  });

  it('breaks spending down by category, largest first, with shares', () => {
    const s = summarize(budget({
      expenses: [
        { id: 'a', label: 'Rent', amount: '600', frequency: 'once', category: 'housing' },
        { id: 'b', label: 'Snacks', amount: '100', frequency: 'once', category: 'food' },
        { id: 'c', label: 'Groceries', amount: '300', frequency: 'once', category: 'food' },
      ],
    }));
    expect(s.byCategory.map((c) => [c.category, c.total, c.share])).toEqual([
      ['housing', 600, 0.6],
      ['food', 400, 0.4],
    ]);
  });

  it('rounds to cents without drifting', () => {
    const s = summarize(budget({
      expenses: Array.from({ length: 10 }, (_, n) => ({ id: `e${n}`, label: 'x', amount: '0.10', frequency: 'once' as const, category: 'other' as const })),
    }));
    expect(s.expenseTotal).toBe(1);
  });
});
