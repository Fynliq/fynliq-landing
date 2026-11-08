import type { AidGlance as Glance } from '../../beta/preview';
import styles from './AidGlance.module.css';

/**
 * The three numbers every aid offer comes down to. Used on the free preview
 * and at the top of the full answer, from the same server-side totals.
 * A number the documents do not support is never shown: it says so instead.
 */
// Cents only when the document printed them (a tuition estimate's exact total).
const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;

const REMAINING_NOTE: Record<string, string> = {
  bill: 'This term’s bill after aid applied',
  stated: 'As printed on your document',
  cost_of_attendance: 'Full-year cost, incl. housing, minus free money',
  estimate: 'Estimated yearly cost minus free money',
};

export function AidGlance({ glance, title }: { glance: Glance; title?: string }) {
  const items: { label: string; value: number | null; note: string; tone: 'green' | 'gold' | 'ink' }[] = [
    { label: 'Free money', value: glance.freeMoney, note: glance.estimatesOnly ? 'Grants + scholarships (FAFSA estimate)' : 'Grants + scholarships', tone: 'green' },
    { label: 'Borrowed money', value: glance.borrowed, note: 'Student loans offered', tone: 'gold' },
    // No remaining cost, but a tuition calculator: show its total as the estimate it is.
    glance.remainingCost === null && glance.estimatedCost != null
      ? { label: `Estimated ${glance.estimatedPeriod ?? 'semester'} cost`, value: glance.estimatedCost, note: 'From a cost estimate, not your bill', tone: 'ink' as const }
      : { label: 'Estimated remaining cost', value: glance.remainingCost, note: (glance.remainingBasis && REMAINING_NOTE[glance.remainingBasis]) || 'Add your award letter or bill to see this', tone: 'ink' as const },
  ];
  return (
    <section className={styles.card} aria-label={title ?? 'Your aid at a glance'}>
      {title && <p className={styles.title}>{title}</p>}
      <dl className={styles.grid}>
        {items.map((item) => (
          <div key={item.label} className={styles.item}>
            <dt className={styles.label}>{item.label}</dt>
            <dd className={`${styles.value} ${item.value === null ? styles.missing : styles[item.tone]}`}>
              {item.value === null ? 'Not enough information' : usd(item.value)}
            </dd>
            <dd className={styles.note}>{item.note}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
