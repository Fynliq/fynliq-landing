import { afterEach, describe, expect, it } from 'vitest';
import { EMPTY_BUDGET, type Budget } from '../budget';
import { deleteBudget, loadBudget, parseStoredBudget, saveBudget, storageKey } from '../storage';

const sample: Budget = {
  termStart: '2026-08-24',
  termEnd: '2026-12-13',
  startingCash: '1,000',
  income: [{ id: 'i1', label: 'Pay', amount: '150', frequency: 'weekly' }],
  expenses: [{ id: 'e1', label: 'Rent', amount: '700', frequency: 'monthly', category: 'housing' }],
};

function fakeStorage(fail = false) {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => { if (fail) throw new Error('blocked'); return data.get(k) ?? null; },
    setItem: (k: string, v: string) => { if (fail) throw new Error('blocked'); data.set(k, v); },
    removeItem: (k: string) => { if (fail) throw new Error('blocked'); data.delete(k); },
  };
}

function withStorage(storage: unknown) {
  (globalThis as { window?: unknown }).window = { localStorage: storage };
}

afterEach(() => { delete (globalThis as { window?: unknown }).window; });

describe('budget storage', () => {
  it('keeps each account separate', () => {
    const storage = fakeStorage();
    withStorage(storage);
    expect(saveBudget('Sam@Example.edu', sample)).toBe(true);
    expect(loadBudget('sam@example.edu')).toEqual(sample);
    expect(loadBudget('alex@example.edu')).toEqual(EMPTY_BUDGET);
    expect([...storage.data.keys()]).toEqual([storageKey('sam@example.edu')]);
  });

  it('deletes only that account', () => {
    const storage = fakeStorage();
    withStorage(storage);
    saveBudget('a@x.edu', sample);
    saveBudget('b@x.edu', sample);
    deleteBudget('a@x.edu');
    expect(loadBudget('a@x.edu')).toEqual(EMPTY_BUDGET);
    expect(loadBudget('b@x.edu')).toEqual(sample);
  });

  it('works without storage, and reports that nothing was saved', () => {
    withStorage(fakeStorage(true));
    expect(saveBudget('a@x.edu', sample)).toBe(false);
    expect(loadBudget('a@x.edu')).toEqual(EMPTY_BUDGET);
    expect(() => deleteBudget('a@x.edu')).not.toThrow();
  });

  it('drops malformed data item by item instead of trusting it', () => {
    const parsed = parseStoredBudget(JSON.stringify({
      termStart: 'next tuesday',
      termEnd: '2026-12-13',
      startingCash: 42,
      income: [{ id: 'ok', label: 'Pay', amount: '10', frequency: 'weekly' }, { id: 'x', frequency: 'yearly' }, 'junk'],
      expenses: [{ id: 'e', label: 'Rent', amount: '700', frequency: 'monthly', category: 'yachts' }],
    }));
    expect(parsed).toEqual({
      termStart: '',
      termEnd: '2026-12-13',
      startingCash: '',
      income: [{ id: 'ok', label: 'Pay', amount: '10', frequency: 'weekly' }],
      expenses: [{ id: 'e', label: 'Rent', amount: '700', frequency: 'monthly', category: 'other' }],
    });
    expect(parseStoredBudget('{not json')).toBe(null);
    expect(parseStoredBudget(null)).toBe(null);
  });
});
