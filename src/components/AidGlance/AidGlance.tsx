import type { AidGlance as Glance } from '../../beta/preview';
import styles from './AidGlance.module.css';

/**
 * The three numbers every aid offer comes down to. Used on the free preview
 * and at the top of the full answer, from the same server-side totals.
 * A number the documents do not support is never shown: it says so instead.
 */
const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

export function AidGlance({ glance, title }: { glance: Glance; title?: string }) {
  const items: { label: string; value: number | null; note: string; tone: 'green' | 'gold' | 'ink' }[] = [
    { label: 'Free money', value: glance.freeMoney, note: glance.estimatesOnly ? 'Grants + scholarships (FAFSA estimate)' : 'Grants + scholarships', tone: 'green' },
    { label: 'Borrowed money', value: glance.borrowed, note: 'Student loans offered', tone: 'gold' },
    { label: 'Estimated remaining cost', value: glance.remainingCost, note: glance.remainingBasis === 'bill' ? 'This term’s bill after aid applied' : glance.remainingBasis === 'cost_of_attendance' ? 'Full-year cost, incl. housing, minus free money' : 'Add your award letter or bill to see this', tone: 'ink' },
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
