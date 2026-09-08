import { Amount, Pill } from '../ui';
import type { AmountSize, AmountTone } from '../ui/Amount';
import styles from './MoneyMetric.module.css';

interface MoneyMetricProps {
  label: string;
  value: number;
  size?: AmountSize;
  tone?: AmountTone;
  /** Status wording. Never colour alone. */
  status?: { tone: 'green' | 'gold' | 'rust'; text: string };
  note?: React.ReactNode;
}

export function MoneyMetric({
  label,
  value,
  size = 40,
  tone = 'default',
  status,
  note,
}: MoneyMetricProps) {
  return (
    <div className={styles.metric}>
      <div className={styles.top}>
        <span className={styles.label}>{label}</span>
        {status && <Pill tone={status.tone}>{status.text}</Pill>}
      </div>
      <div className={styles.figure}>
        <Amount value={value} size={size} tone={tone} />
      </div>
      {note && <p className={styles.note}>{note}</p>}
    </div>
  );
}

interface MissingMetricProps {
  label: string;
  /** What the interface asks for instead of showing a guess. */
  prompt: string;
  explanation: string;
}

/**
 * Shown when a figure genuinely cannot be worked out — most often a weekly
 * number with no disbursement date. We show the gap, not an estimate.
 */
export function MissingMetric({ label, prompt, explanation }: MissingMetricProps) {
  return (
    <div className={styles.metric}>
      <div className={styles.top}>
        <span className={styles.label}>{label}</span>
      </div>
      <span className={styles.dash} aria-hidden="true">
        &mdash;
      </span>
      <div className={styles.missing}>
        <span className={styles.missingLabel}>
          <span aria-hidden="true">&#9675;</span>
          {prompt}
        </span>
        <p className={styles.missingBody}>{explanation}</p>
      </div>
    </div>
  );
}
