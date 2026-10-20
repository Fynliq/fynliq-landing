import { useEffect, useId, useMemo, useState } from 'react';
import { AppShell } from '../components/nav/AppShell/AppShell';
import { useAuth } from '../auth/AuthProvider';
import { formatUSD } from '../core/money';
import {
  AMOUNT_ERRORS,
  CATEGORIES,
  EMPTY_BUDGET,
  EXPENSE_PRESETS,
  FREQUENCIES,
  INCOME_PRESETS,
  newId,
  parseAmount,
  summarize,
  type Budget as BudgetData,
  type BudgetItem,
  type BudgetSummary,
  type Category,
  type ExpenseItem,
  type Frequency,
} from '../budget/budget';
import { deleteBudget, loadBudget, saveBudget } from '../budget/storage';
import styles from './Budget.module.css';

/**
 * Budget: plan a term's money by hand.
 *
 * The student types every figure. Nothing here is read from their aid
 * documents, and nothing is sent anywhere: the plan is saved in this browser,
 * under their account, until they delete it (`budget/storage.ts`). Every
 * number shown comes from `summarize`, which is tested on its own.
 */
export function Budget() {
  const { session } = useAuth();
  // The page is behind the account, so there is always a session here. The
  // fallback only keeps a guest's typing in memory if that ever changes.
  const accountId = session?.account.email ?? null;

  const [budget, setBudget] = useState<BudgetData>(() => (accountId ? loadBudget(accountId) : EMPTY_BUDGET));
  const [saved, setSaved] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // A different account in the same tab gets its own plan, not the last one's.
  useEffect(() => {
    setBudget(accountId ? loadBudget(accountId) : EMPTY_BUDGET);
  }, [accountId]);

  const update = (next: BudgetData) => {
    setBudget(next);
    setSaved(accountId ? saveBudget(accountId, next) : false);
  };

  const summary = useMemo(() => summarize(budget), [budget]);
  const problems = new Set([...summary.invalid]);
  const waiting = new Set(summary.waitingForDates);

  const onDelete = () => {
    if (accountId) deleteBudget(accountId);
    setBudget(EMPTY_BUDGET);
    setConfirmingDelete(false);
    setSaved(true);
  };

  return (
    <AppShell tab="budget">
      <div className={styles.page}>
        <header className={styles.head}>
          <p className={styles.eyebrow}>Budget</p>
          <h1 className={styles.title}>Plan your money for the term</h1>
          <p className={styles.lede}>
            Add what you have, what comes in and what you expect to spend. Fynliq shows what is
            left at the end of the term and what that means each week.
          </p>
        </header>

        <div className={styles.layout}>
          <div className={styles.inputs}>
            <TermCard budget={budget} summary={summary} startingCashInvalid={problems.has('startingCash')} onChange={update} />

            <ItemList
              kind="income"
              title="Money coming in"
              hint="Pay, help from family, an aid refund you have received."
              items={budget.income}
              presets={INCOME_PRESETS.map((p) => ({ ...p }))}
              problems={problems}
              waiting={waiting}
              onChange={(income) => update({ ...budget, income })}
            />

            <ItemList
              kind="expense"
              title="Money going out"
              hint="Rent, food, transport, books, phone: anything you will pay this term."
              items={budget.expenses}
              presets={EXPENSE_PRESETS.map((p) => ({ ...p }))}
              problems={problems}
              waiting={waiting}
              onChange={(expenses) => update({ ...budget, expenses: expenses as ExpenseItem[] })}
            />
          </div>

          <aside className={styles.summaryColumn} aria-label="Budget summary">
            <Summary summary={summary} />

            <div className={styles.privacy}>
              <p>
                {saved
                  ? 'Saved on this device only. Your budget is never sent to Fynliq.'
                  : 'This browser is not letting Fynliq save, so your budget will be gone when you close the tab. It is never sent to Fynliq.'}
              </p>
              {!confirmingDelete ? (
                <button type="button" className={styles.textButton} onClick={() => setConfirmingDelete(true)}>
                  Delete my budget
                </button>
              ) : (
                <div className={styles.confirm} role="group" aria-label="Confirm deleting your budget">
                  <span>Delete every figure on this page?</span>
                  <button type="button" className={styles.danger} onClick={onDelete}>Yes, delete</button>
                  <button type="button" className={styles.textButton} onClick={() => setConfirmingDelete(false)}>Keep it</button>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

/* ---- Term and starting cash ----------------------------------------------- */

function TermCard({ budget, summary, startingCashInvalid, onChange }: {
  budget: BudgetData;
  summary: BudgetSummary;
  startingCashInvalid: boolean;
  onChange: (next: BudgetData) => void;
}) {
  const id = useId();
  const dateProblem = summary.term.status !== 'ready' && summary.term.status !== 'missing';
  const cashError = startingCashInvalid ? parseAmount(budget.startingCash) : null;

  return (
    <section className={styles.card} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className={styles.cardTitle}>Your term</h2>
      <div className={styles.dates}>
        <label className={styles.field}>
          <span className={styles.label}>Term starts</span>
          <input
            type="date"
            className={`${styles.input} ${dateProblem ? styles.wrong : ''}`}
            value={budget.termStart}
            aria-invalid={dateProblem || undefined}
            aria-describedby={`${id}-term`}
            onChange={(e) => onChange({ ...budget, termStart: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Term ends</span>
          <input
            type="date"
            className={`${styles.input} ${dateProblem ? styles.wrong : ''}`}
            value={budget.termEnd}
            aria-invalid={dateProblem || undefined}
            aria-describedby={`${id}-term`}
            onChange={(e) => onChange({ ...budget, termEnd: e.target.value })}
          />
        </label>
      </div>
      <p id={`${id}-term`} className={dateProblem ? styles.fieldError : styles.note} aria-live="polite">
        {summary.term.status === 'ready'
          ? `${summary.term.days} days, about ${Math.round(summary.term.weeks * 10) / 10} weeks.`
          : summary.term.prompt}
      </p>

      <label className={styles.field}>
        <span className={styles.label}>Money you have now</span>
        <span className={styles.money}>
          <span className={styles.currency} aria-hidden="true">$</span>
          <input
            className={`${styles.input} ${styles.amount} ${startingCashInvalid ? styles.wrong : ''}`}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={budget.startingCash}
            aria-invalid={startingCashInvalid || undefined}
            aria-describedby={`${id}-cash`}
            onChange={(e) => onChange({ ...budget, startingCash: e.target.value })}
          />
        </span>
      </label>
      <p id={`${id}-cash`} className={cashError && !cashError.ok ? styles.fieldError : styles.note}>
        {cashError && !cashError.ok ? AMOUNT_ERRORS[cashError.reason] : 'In your bank account or wallet today, for spending this term.'}
      </p>
    </section>
  );
}

/* ---- Income and expense lists --------------------------------------------- */

type Preset = { label: string; frequency: Frequency; category?: Category };

function ItemList({ kind, title, hint, items, presets, problems, waiting, onChange }: {
  kind: 'income' | 'expense';
  title: string;
  hint: string;
  items: (BudgetItem | ExpenseItem)[];
  presets: Preset[];
  problems: Set<string>;
  waiting: Set<string>;
  onChange: (items: (BudgetItem | ExpenseItem)[]) => void;
}) {
  const id = useId();
  const [focusId, setFocusId] = useState<string | null>(null);

  const add = (preset?: Preset) => {
    const item = {
      id: newId(),
      label: preset?.label ?? '',
      amount: '',
      frequency: preset?.frequency ?? 'once',
      ...(kind === 'expense' ? { category: preset?.category ?? 'other' } : {}),
    };
    onChange([...items, item]);
    setFocusId(item.id);
  };

  const used = new Set(items.map((i) => i.label.trim().toLowerCase()));
  const available = presets.filter((p) => !used.has(p.label.toLowerCase()));

  return (
    <section className={styles.card} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className={styles.cardTitle}>{title}</h2>
      <p className={styles.note}>{hint}</p>

      {items.length > 0 && (
        <ul className={styles.items}>
          {items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              kind={kind}
              autoFocus={item.id === focusId}
              invalid={problems.has(item.id)}
              waiting={waiting.has(item.id)}
              onChange={(next) => onChange(items.map((i) => (i.id === item.id ? next : i)))}
              onRemove={() => onChange(items.filter((i) => i.id !== item.id))}
            />
          ))}
        </ul>
      )}

      <div className={styles.addRow}>
        <button type="button" className={styles.add} onClick={() => add()}>
          <span aria-hidden="true">+</span> Add {kind === 'income' ? 'income' : 'an expense'}
        </button>
        {available.map((preset) => (
          <button key={preset.label} type="button" className={styles.chip} onClick={() => add(preset)}>
            <span aria-hidden="true">+</span> {preset.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function ItemRow({ item, kind, autoFocus, invalid, waiting, onChange, onRemove }: {
  item: BudgetItem | ExpenseItem;
  kind: 'income' | 'expense';
  autoFocus: boolean;
  invalid: boolean;
  waiting: boolean;
  onChange: (item: BudgetItem | ExpenseItem) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const parsed = parseAmount(item.amount);
  const name = item.label.trim() || (kind === 'income' ? 'this income' : 'this expense');
  const message = invalid && !parsed.ok
    ? AMOUNT_ERRORS[parsed.reason]
    : waiting
      ? 'Add your term dates to count a repeating amount.'
      : null;

  return (
    <li className={styles.item}>
      <label className={`${styles.field} ${styles.itemLabel}`}>
        <span className="srOnly">Name</span>
        <input
          className={styles.input}
          placeholder={kind === 'income' ? 'e.g. Campus job' : 'e.g. Rent'}
          maxLength={80}
          value={item.label}
          autoFocus={autoFocus && !item.label}
          onChange={(e) => onChange({ ...item, label: e.target.value })}
        />
      </label>

      <label className={`${styles.field} ${styles.itemAmount}`}>
        <span className="srOnly">Amount for {name}</span>
        <span className={styles.money}>
          <span className={styles.currency} aria-hidden="true">$</span>
          <input
            className={`${styles.input} ${styles.amount} ${invalid ? styles.wrong : ''}`}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            maxLength={20}
            value={item.amount}
            autoFocus={autoFocus && !!item.label}
            aria-invalid={invalid || undefined}
            aria-describedby={message ? `${id}-msg` : undefined}
            onChange={(e) => onChange({ ...item, amount: e.target.value })}
          />
        </span>
      </label>

      <label className={`${styles.field} ${styles.itemFrequency}`}>
        <span className="srOnly">How often for {name}</span>
        <select
          className={`${styles.input} ${styles.select}`}
          value={item.frequency}
          onChange={(e) => onChange({ ...item, frequency: e.target.value as Frequency })}
        >
          {FREQUENCIES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </label>

      {'category' in item && (
        <label className={`${styles.field} ${styles.itemCategory}`}>
          <span className="srOnly">Category for {name}</span>
          <select
            className={`${styles.input} ${styles.select}`}
            value={item.category}
            onChange={(e) => onChange({ ...item, category: e.target.value as Category })}
          >
            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
      )}

      <button type="button" className={styles.remove} onClick={onRemove} aria-label={`Remove ${name}`}>
        <span aria-hidden="true">×</span>
      </button>

      {message && (
        <p id={`${id}-msg`} className={`${invalid ? styles.fieldError : styles.note} ${styles.itemMessage}`}>
          {message}
        </p>
      )}
    </li>
  );
}

/* ---- Summary -------------------------------------------------------------- */

const VERDICT = {
  'on-track': { glyph: '✓', text: 'Covered, with money left over' },
  check: { glyph: '!', text: 'Covered, but only just' },
  short: { glyph: '×', text: 'Short for the term' },
} as const;

function Summary({ summary }: { summary: BudgetSummary }) {
  if (summary.empty) {
    return (
      <section className={`${styles.summary} ${styles.summaryEmpty}`} aria-live="polite">
        <h2 className={styles.cardTitle}>Your term at a glance</h2>
        <p className={styles.note}>Add what you have and what you will spend. The totals appear here as you type.</p>
      </section>
    );
  }

  const verdict = VERDICT[summary.tone];
  const short = summary.leftOver < 0;

  return (
    <section className={styles.summary} aria-live="polite" aria-atomic="false">
      <h2 className={styles.cardTitle}>Your term at a glance</h2>

      <div className={`${styles.verdict} ${styles[summary.tone]}`}>
        <span className={styles.verdictGlyph} aria-hidden="true">{verdict.glyph}</span>
        <div>
          <p className={styles.verdictLabel}>{short ? 'Short by' : 'Left at the end of the term'}</p>
          <p className={styles.verdictFigure}>{formatUSD(Math.abs(summary.leftOver))}</p>
          <p className={styles.verdictText}>{verdict.text}</p>
        </div>
      </div>

      <dl className={styles.totals}>
        <div><dt>Money you have now</dt><dd>{formatUSD(summary.startingCash)}</dd></div>
        <div><dt>Coming in</dt><dd>+{formatUSD(summary.incomeTotal)}</dd></div>
        <div><dt>Going out</dt><dd>{'−'}{formatUSD(summary.expenseTotal)}</dd></div>
        <div className={styles.totalLine}>
          <dt>{short ? 'Short by' : 'Left over'}</dt>
          {/* The label already says "short", so no minus sign as well. */}
          <dd>{formatUSD(Math.abs(summary.leftOver))}</dd>
        </div>
      </dl>

      {summary.perWeek ? (
        <div className={styles.weekly}>
          <div>
            <p className={styles.weeklyFigure}>{formatUSD(summary.perWeek.spending)}</p>
            <p className={styles.weeklyLabel}>planned spending a week</p>
          </div>
          <div>
            <p className={styles.weeklyFigure}>
              {summary.perWeek.leftOver < 0 ? '−' : ''}{formatUSD(Math.abs(summary.perWeek.leftOver))}
            </p>
            <p className={styles.weeklyLabel}>
              {summary.perWeek.leftOver < 0 ? 'to cut or find each week' : 'spare each week'}
            </p>
          </div>
        </div>
      ) : (
        <p className={styles.note}>{summary.term.status === 'missing' ? 'Add your term dates to see weekly figures.' : 'Fix the term dates to see weekly figures.'}</p>
      )}

      {summary.byCategory.length > 0 && <Breakdown summary={summary} />}

      {(summary.invalid.length > 0 || summary.waitingForDates.length > 0) && (
        <p className={styles.fieldError}>
          {summary.invalid.length > 0
            ? `${summary.invalid.length} ${summary.invalid.length === 1 ? 'amount is' : 'amounts are'} left out until fixed.`
            : `${summary.waitingForDates.length} repeating ${summary.waitingForDates.length === 1 ? 'amount is' : 'amounts are'} left out until you add term dates.`}
        </p>
      )}

      <p className={styles.fine}>
        These totals use only the figures you typed. Check aid amounts and dates with your school's
        financial aid office.
      </p>
    </section>
  );
}

function Breakdown({ summary }: { summary: BudgetSummary }) {
  return (
    <div className={styles.breakdown}>
      <h3 className={styles.breakdownTitle}>Where it goes</h3>
      <ul className={styles.categories}>
        {summary.byCategory.map((c) => {
          const percent = Math.round(c.share * 100);
          return (
            <li key={c.category} className={styles.category}>
              <div className={styles.categoryRow}>
                <span>{c.label}</span>
                <span className={styles.categoryFigure}>{formatUSD(c.total)} <span className={styles.categoryShare}>{percent}%</span></span>
              </div>
              {/* Decorative: the words above already say the same thing. */}
              <span className={styles.track} aria-hidden="true">
                <span className={styles.fill} style={{ width: `${Math.max(c.share * 100, 1)}%` }} />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
