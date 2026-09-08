import { Amount } from '../ui';
import type { AmountTone } from '../ui/Amount';
import styles from './FinancialCard.module.css';

export interface MoneyRow {
  id: string;
  label: string;
  /** One plain-English sentence under the label. */
  meaning?: string;
  /** A number, or a pre-formatted string for ranges and deductions. */
  value: number | string;
  tone?: AmountTone;
  estimate?: boolean;
}

interface FinancialCardProps {
  rows: MoneyRow[];
  total?: { label: string; value: number | string; tone?: AmountTone };
  footnote?: React.ReactNode;
}

/**
 * A grouped list of money rows. Every amount sits in the same right-aligned
 * monospaced column, so the digits stack cleanly however long the labels are.
 */
export function FinancialCard({ rows, total, footnote }: FinancialCardProps) {
  return (
    <div>
      <dl className={styles.rows}>
        {rows.map((row) => (
          <div key={row.id} className={styles.row}>
            <dt className={styles.label}>
              {row.label}
              {row.meaning && <span className={styles.meaning}>{row.meaning}</span>}
            </dt>
            <dd>
              <Amount value={row.value} size={17} tone={row.tone} estimate={row.estimate} column />
            </dd>
          </div>
        ))}
      </dl>

      {total && (
        <div className={styles.total}>
          <span className={styles.totalLabel}>{total.label}</span>
          <Amount value={total.value} size={21} tone={total.tone} column />
        </div>
      )}

      {footnote && <p className={styles.foot}>{footnote}</p>}
    </div>
  );
}
