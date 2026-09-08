import { formatUSD } from '../../core';
import { useCountUp } from '../../lib/useCountUp';
import styles from './Amount.module.css';

export type AmountTone = 'default' | 'green' | 'gold' | 'rust' | 'muted';
export type AmountSize = 13 | 15 | 17 | 21 | 25 | 32 | 40 | 52;

interface AmountProps {
  /** Whole dollars, or a pre-formatted string for ranges. */
  value: number | string;
  size?: AmountSize;
  tone?: AmountTone;
  /** Right-align, for figures sitting in a financial column. */
  column?: boolean;
  /**
   * Marks the figure as an estimate in words as well as in gold, so the
   * meaning does not depend on seeing the colour.
   */
  estimate?: boolean;
  /**
   * Counts the figure up to its true value the first time it is scrolled into
   * view. The animation is decoration on top of a value the maths already
   * settled: it always lands on exactly `value`, and assistive technology is
   * given the final figure rather than the moving one.
   */
  countUp?: boolean;
  className?: string;
}

export function Amount({
  value,
  size = 17,
  tone = 'default',
  column = false,
  estimate = false,
  countUp = false,
  className,
}: AmountProps) {
  const animated = countUp && typeof value === 'number';
  const counter = useCountUp(typeof value === 'number' ? value : 0, formatUSD, animated);
  const classes = [
    styles.amount,
    styles[`s${size}`],
    tone !== 'default' ? styles[tone] : '',
    column ? styles.column : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  if (animated) {
    return (
      <span className={classes}>
        <span className="srOnly">{formatUSD(value as number)}</span>
        <span ref={counter} aria-hidden="true" />
        {estimate && <span className={styles.estimate}>estimate</span>}
      </span>
    );
  }

  return (
    <span className={classes}>
      {typeof value === 'number' ? formatUSD(value) : value}
      {estimate && <span className={styles.estimate}>estimate</span>}
    </span>
  );
}
