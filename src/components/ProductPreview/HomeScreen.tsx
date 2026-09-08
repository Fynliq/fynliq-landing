import { Amount, Pill } from '../ui';
import { computeRunway, formatUSD } from '../../core';
import { DEMO_AWARD, DEMO_RUNWAY } from '../../data/demo';
import { PhoneFrame } from './PhoneFrame';
import styles from './screens.module.css';

const DECISIONS = [
  { title: 'Should I accept these loans?', note: '$7,500 offered. Work out what you actually need.' },
  { title: 'Get more free money', note: 'Six things worth trying before you borrow.' },
  { title: 'Add another award', note: 'Screenshot your portal. Spring, or a revised offer.' },
] as const;

/**
 * The Home tab. Every figure shown is returned by `core/`, not written into
 * the markup — the runway and the weekly number are the same calculation the
 * app runs.
 */
export function HomeScreen() {
  const runway = computeRunway(DEMO_RUNWAY, DEMO_AWARD, true);
  if (runway.status !== 'ready') return null;

  return (
    <PhoneFrame tab="Home" title="This semester">
      <div className={styles.card}>
        <div className={styles.head}>
          <span className={styles.label}>Money left this semester</span>
          <Pill tone="green">On track</Pill>
        </div>

        <span className={styles.figure}>
          <Amount value={runway.moneyLeft} size={40} />
        </span>

        <p className={styles.sub}>
          Has to last <span className={styles.strong}>{runway.daysRemaining} days</span>, until{' '}
          {runway.until.label}.
        </p>

        <div className={styles.split}>
          <div className={styles.cell}>
            <span className={styles.cellLabel}>Spent</span>
            <span className={styles.cellValue}>
              <Amount value={runway.spent} size={17} tone="muted" />
            </span>
          </div>
          <div className={styles.cell}>
            <span className={styles.cellLabel}>Safe weekly</span>
            <span className={styles.cellValue}>
              <Amount value={runway.safeWeekly} size={17} />
            </span>
          </div>
        </div>
      </div>

      <div className={styles.group}>
        <span className={styles.sectionLabel}>Needs a decision</span>
        <div>
          {DECISIONS.map((decision) => (
            <div key={decision.title} className={styles.rowLink}>
              <span>
                <span className={styles.rowTitle}>{decision.title}</span>
                <span className={styles.rowNote}>{decision.note}</span>
              </span>
              <span className={styles.chev} aria-hidden="true">
                &rsaquo;
              </span>
            </div>
          ))}
        </div>
      </div>
    </PhoneFrame>
  );
}

/** The weekly figure, stated once for the surrounding copy to reference. */
export const DEMO_SAFE_WEEKLY = (() => {
  const runway = computeRunway(DEMO_RUNWAY, DEMO_AWARD, true);
  return runway.status === 'ready' ? formatUSD(runway.safeWeekly) : null;
})();
