import { Card } from '../ui';
import { GRADI_FEE, GRADI_PAYOUT } from '../../gradi/offer';
import styles from './EarnWithGradi.module.css';

/**
 * The step after My Aid: a way to earn real cash while the aid comes through.
 *
 * Shown at the end of the results, once the student has paid and uploaded.
 * It leads to the Earn tab (`/gradi`), which carries the referral link and
 * code. The fee is shown next to the payout, never below it.
 */
export function EarnWithGradi() {
  return (
    <Card hero className={styles.card}>
      <span className={styles.eyebrow}>Next: Earn</span>
      <h2 className={styles.title}>Make your first {GRADI_PAYOUT} while you wait on aid</h2>
      <p className={styles.body}>
        Join Gradi as a creator, post three photos, and once they reach 10 likes Gradi pays you {GRADI_PAYOUT}.
        Gradi charges a one-time {GRADI_FEE} creator fee to join.
      </p>
      <a className={styles.cta} href="/gradi">
        Show me how <span aria-hidden="true">&nbsp;&rarr;</span>
      </a>
      <p className={styles.note}>Official Fynliq partner. Offer amount and terms are set by Gradi and may change.</p>
    </Card>
  );
}
