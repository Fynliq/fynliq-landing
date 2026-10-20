/**
 * The budget: what a student expects to have, spend and keep over a term.
 *
 * Everything here is typed in by the student. Nothing is read from their
 * uploaded aid documents, and nothing leaves the browser (see `storage.ts`).
 * These are pure functions so every figure on the page is tested.
 *
 * The same honesty rule as the runway (`core/runway.ts`): without term dates
 * there is no per-week figure. A weekly number divided by a guessed length of
 * term would be a made-up number about somebody's money.
 */

export type Frequency = 'once' | 'weekly' | 'monthly';

export const FREQUENCIES: readonly { id: Frequency; label: string }[] = [
  { id: 'once', label: 'Once this term' },
  { id: 'monthly', label: 'Every month' },
  { id: 'weekly', label: 'Every week' },
];

export type Category = 'housing' | 'food' | 'transport' | 'school' | 'bills' | 'personal' | 'other';

export const CATEGORIES: readonly { id: Category; label: string }[] = [
  { id: 'housing', label: 'Housing' },
  { id: 'food', label: 'Food' },
  { id: 'transport', label: 'Transport' },
  { id: 'school', label: 'Books & school' },
  { id: 'bills', label: 'Phone & bills' },
  { id: 'personal', label: 'Personal' },
  { id: 'other', label: 'Other' },
];

export interface BudgetItem {
  id: string;
  label: string;
  /**
   * The amount exactly as typed, so a half-finished entry ("1,2") is not
   * rewritten under the student's cursor. `parseAmount` reads it.
   */
  amount: string;
  frequency: Frequency;
}

export interface ExpenseItem extends BudgetItem {
  category: Category;
}

export interface Budget {
  /** ISO dates, `YYYY-MM-DD`. Empty until the student adds them. */
  termStart: string;
  termEnd: string;
  /** Money they have right now, as typed. */
  startingCash: string;
  income: BudgetItem[];
  expenses: ExpenseItem[];
}

export const EMPTY_BUDGET: Budget = {
  termStart: '',
  termEnd: '',
  startingCash: '',
  income: [],
  expenses: [],
};

/** Quick-add suggestions. Labels only; the student supplies every amount. */
export const INCOME_PRESETS: readonly { label: string; frequency: Frequency }[] = [
  { label: 'Job or work-study pay', frequency: 'weekly' },
  { label: 'Help from family', frequency: 'monthly' },
  { label: 'Aid refund received', frequency: 'once' },
];

export const EXPENSE_PRESETS: readonly { label: string; frequency: Frequency; category: Category }[] = [
  { label: 'Rent', frequency: 'monthly', category: 'housing' },
  { label: 'Groceries', frequency: 'weekly', category: 'food' },
  { label: 'Phone', frequency: 'monthly', category: 'bills' },
  { label: 'Transport', frequency: 'weekly', category: 'transport' },
  { label: 'Books & supplies', frequency: 'once', category: 'school' },
];

/** The largest single amount accepted. Anything above is almost surely a typo. */
export const MAX_AMOUNT = 1_000_000;

export type ParsedAmount =
  | { ok: true; value: number }
  | { ok: false; reason: 'empty' | 'invalid' | 'negative' | 'too-large' };

/**
 * Reads an amount the way people type money: `1200`, `$1,200`, `1,200.50`.
 * Rejects rather than guesses: `12,00` and `1.2.3` are invalid, not 1200.
 */
export function parseAmount(text: string): ParsedAmount {
  const raw = text.trim();
  if (!raw) return { ok: false, reason: 'empty' };
  const negative = /^[-−]/.test(raw);
  const body = raw.replace(/^[-−]\s*/, '').replace(/^\$\s*/, '').trim();
  // Commas are allowed only as thousands separators.
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(body) && !/^\.\d{1,2}$/.test(body)) {
    return { ok: false, reason: 'invalid' };
  }
  const value = Number(body.replace(/,/g, ''));
  if (!Number.isFinite(value)) return { ok: false, reason: 'invalid' };
  if (negative && value !== 0) return { ok: false, reason: 'negative' };
  if (value > MAX_AMOUNT) return { ok: false, reason: 'too-large' };
  return { ok: true, value };
}

export const AMOUNT_ERRORS: Record<Exclude<ParsedAmount, { ok: true }>['reason'], string> = {
  empty: 'Add an amount.',
  invalid: 'Use a number like 1200 or 1,200.50.',
  negative: 'Use a positive amount. Spending goes under Expenses.',
  'too-large': 'That is more than $1,000,000. Check for a typo.',
};

const DAY_MS = 86_400_000;
/** Average month length, so twelve months make exactly one year. */
const DAYS_PER_MONTH = 365.25 / 12;

/** Parses `YYYY-MM-DD` as UTC so results never shift with the viewer's timezone. */
function utcDay(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  // Rejects dates like 2026-02-31 that Date.parse rolls into March.
  return new Date(ms).toISOString().slice(0, 10) === iso ? ms : null;
}

export type TermLength =
  | { status: 'ready'; days: number; weeks: number; months: number }
  | { status: 'missing' | 'invalid' | 'reversed' | 'too-long'; prompt: string };

/** The longest term accepted: a full year plus a summer. */
export const MAX_TERM_DAYS = 400;

/** Term length, counting both the first and the last day. */
export function termLength(start: string, end: string): TermLength {
  if (!start || !end) return { status: 'missing', prompt: 'Add your term start and end dates to see weekly figures.' };
  const from = utcDay(start);
  const to = utcDay(end);
  if (from === null || to === null) return { status: 'invalid', prompt: 'Check the term dates.' };
  if (to < from) return { status: 'reversed', prompt: 'The term ends before it starts. Check the dates.' };
  const days = Math.round((to - from) / DAY_MS) + 1;
  if (days > MAX_TERM_DAYS) return { status: 'too-long', prompt: 'Plan one term or one school year at a time (up to 400 days).' };
  return { status: 'ready', days, weeks: days / 7, months: days / DAYS_PER_MONTH };
}

/** How much one item adds up to over the whole term. */
export function itemTotal(amount: number, frequency: Frequency, term: { weeks: number; months: number } | null): number | null {
  if (frequency === 'once') return amount;
  // A repeating amount has no total until the term has a length.
  if (!term) return null;
  return amount * (frequency === 'weekly' ? term.weeks : term.months);
}

/** Rounds to cents once, at the end, so totals do not drift. */
const cents = (n: number) => Math.round(n * 100) / 100;

export type Tone = 'on-track' | 'check' | 'short';

export interface CategoryTotal {
  category: Category;
  label: string;
  total: number;
  /** Share of planned spending, 0–1. */
  share: number;
}

export interface BudgetSummary {
  term: TermLength;
  startingCash: number;
  incomeTotal: number;
  expenseTotal: number;
  /** Starting cash + income − expenses, over the whole term. */
  leftOver: number;
  /** `null` until the term has dates. */
  perWeek: { spending: number; leftOver: number } | null;
  tone: Tone;
  byCategory: CategoryTotal[];
  /** Ids of items whose amount cannot be read. They are left out of every total. */
  invalid: string[];
  /** Ids of repeating items that cannot be totalled until the term has dates. */
  waitingForDates: string[];
  /** Nothing usable entered yet. */
  empty: boolean;
}

/**
 * Leftover under 5% of the money coming in is "check": technically covered,
 * but one surprise bill away from short.
 */
export const TIGHT_SHARE = 0.05;

export function summarize(budget: Budget): BudgetSummary {
  const term = termLength(budget.termStart, budget.termEnd);
  const length = term.status === 'ready' ? term : null;
  const invalid: string[] = [];
  const waitingForDates: string[] = [];

  const start = parseAmount(budget.startingCash);
  const startingCash = start.ok ? start.value : 0;
  if (!start.ok && start.reason !== 'empty') invalid.push('startingCash');

  const total = (item: BudgetItem): number => {
    const parsed = parseAmount(item.amount);
    if (!parsed.ok) {
      if (parsed.reason !== 'empty') invalid.push(item.id);
      return 0;
    }
    const value = itemTotal(parsed.value, item.frequency, length);
    if (value === null) { waitingForDates.push(item.id); return 0; }
    return value;
  };

  const incomeTotal = cents(budget.income.reduce((sum, item) => sum + total(item), 0));
  const categoryTotals = new Map<Category, number>();
  let expenseTotal = 0;
  for (const item of budget.expenses) {
    const value = total(item);
    expenseTotal += value;
    categoryTotals.set(item.category, (categoryTotals.get(item.category) ?? 0) + value);
  }
  expenseTotal = cents(expenseTotal);

  const leftOver = cents(startingCash + incomeTotal - expenseTotal);
  const moneyIn = startingCash + incomeTotal;
  const tone: Tone = leftOver < 0 ? 'short' : moneyIn > 0 && leftOver < moneyIn * TIGHT_SHARE ? 'check' : 'on-track';

  const byCategory = CATEGORIES
    .map(({ id, label }) => ({ category: id, label, total: cents(categoryTotals.get(id) ?? 0) }))
    .filter((c) => c.total > 0)
    .map((c) => ({ ...c, share: expenseTotal > 0 ? c.total / expenseTotal : 0 }))
    .sort((a, b) => b.total - a.total);

  return {
    term,
    startingCash: cents(startingCash),
    incomeTotal,
    expenseTotal,
    leftOver,
    perWeek: length ? { spending: cents(expenseTotal / length.weeks), leftOver: cents(leftOver / length.weeks) } : null,
    tone,
    byCategory,
    invalid,
    waitingForDates,
    empty: moneyIn === 0 && expenseTotal === 0,
  };
}

let counter = 0;
/** Short unique ids for list items. Not security-sensitive. */
export function newId(): string {
  counter = (counter + 1) % 1_000_000;
  return `${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
