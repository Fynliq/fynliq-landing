import { CATEGORIES, EMPTY_BUDGET, FREQUENCIES, type Budget, type BudgetItem, type ExpenseItem } from './budget';

/**
 * Saving the budget on this device only.
 *
 * The budget is kept in this browser's localStorage and is never sent to
 * Fynliq. It is stored per account (`fynliq:budget:v1:<email>`), so two
 * students sharing a laptop do not see each other's plans, and it is removed
 * when the student deletes it.
 *
 * Storage can be missing, full, or throw (private windows, blocked site
 * data). Every access is guarded, and the page works without it: the budget
 * then simply lasts until the tab closes.
 */
const PREFIX = 'fynliq:budget:v1:';
/** Plenty for a term's budget; refuses anything pathological. */
const MAX_ITEMS = 60;
const MAX_TEXT = 80;

export function storageKey(accountId: string): string {
  return `${PREFIX}${accountId.trim().toLowerCase()}`;
}

function store(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

const text = (value: unknown, max = MAX_TEXT) => (typeof value === 'string' ? value.slice(0, max) : '');
const date = (value: unknown) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '');
const isFrequency = (value: unknown): value is BudgetItem['frequency'] => FREQUENCIES.some((f) => f.id === value);
const isCategory = (value: unknown): value is ExpenseItem['category'] => CATEGORIES.some((c) => c.id === value);

function item(value: unknown): BudgetItem | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const id = text(v.id, 40);
  if (!id || !isFrequency(v.frequency)) return null;
  return { id, label: text(v.label), amount: text(v.amount, 20), frequency: v.frequency };
}

/**
 * Reads a stored budget defensively. Anything malformed is dropped, item by
 * item, rather than trusted: storage can be edited by hand or by an older
 * version of this page.
 */
export function parseStoredBudget(raw: string | null): Budget | null {
  if (!raw) return null;
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return null; }
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const list = (value: unknown) => (Array.isArray(value) ? value.slice(0, MAX_ITEMS) : []);
  return {
    termStart: date(d.termStart),
    termEnd: date(d.termEnd),
    startingCash: text(d.startingCash, 20),
    income: list(d.income).map(item).filter((i): i is BudgetItem => i !== null),
    expenses: list(d.expenses).flatMap((value) => {
      const base = item(value);
      const category = (value as Record<string, unknown>)?.category;
      return base ? [{ ...base, category: isCategory(category) ? category : 'other' } as ExpenseItem] : [];
    }),
  };
}

export function loadBudget(accountId: string): Budget {
  try {
    return parseStoredBudget(store()?.getItem(storageKey(accountId)) ?? null) ?? EMPTY_BUDGET;
  } catch {
    return EMPTY_BUDGET;
  }
}

/** Returns whether the save reached storage, so the page can say so honestly. */
export function saveBudget(accountId: string, budget: Budget): boolean {
  try {
    const target = store();
    if (!target) return false;
    target.setItem(storageKey(accountId), JSON.stringify(budget));
    return true;
  } catch {
    return false;
  }
}

export function deleteBudget(accountId: string): void {
  try {
    store()?.removeItem(storageKey(accountId));
  } catch {
    /* Nothing stored, or storage unavailable: nothing to delete. */
  }
}
