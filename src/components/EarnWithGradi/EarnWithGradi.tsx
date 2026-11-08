import styles from './EarnWithGradi.module.css';

/**
 * A quiet pointer to the Earn tab at the end of the results.
 *
 * Secondary on purpose: the $1 pays for Fynliq's breakdown, not for a Gradi
 * payout, and nothing here should suggest otherwise. The details, fee and
 * terms live on the Earn tab (`/gradi`).
 */
export function EarnWithGradi() {
  return (
    <aside className={styles.card} aria-label="Earn with Gradi">
      <p className={styles.title}>
        Want another way to earn?{' '}
        <a className={styles.cta} href="/gradi">
          Explore Gradi <span aria-hidden="true">&rarr;</span>
        </a>
      </p>
      <p className={styles.note}>Official Fynliq partner. Separate from your $1 unlock. Offer amount and terms are set by Gradi and may change.</p>
    </aside>
  );
}
