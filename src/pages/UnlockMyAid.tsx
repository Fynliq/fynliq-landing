import { useEffect, useState } from 'react';
import { FlowShell } from '../components/beta/FlowShell/FlowShell';
import { Card } from '../components/ui';
import { CheckoutError, startCheckout, trackFunnel } from '../billing/client';
import { GRADI_FEE, GRADI_PAYOUT } from '../gradi/offer';
import { GRADI_FEE, GRADI_PAYOUT } from '../gradi/offer';
import styles from './UnlockMyAid.module.css';

/**
 * Step 1 of My Aid for accounts created after the beta cutoff: the one-time
 * $1 FYNQ Beta Unlock, shown right after log-in and before any document is
 * chosen. Paying leads straight into the upload step.
 *
 * One card, one action. No timers, no scarcity, no fear: what the student
 * gets, what it costs, and that it is paid once. Stripe opens in this same
 * tab — nothing on this page is lost by leaving it.
 */

interface UnlockMyAidProps {
  /** Called when the server says no payment is needed after all. */
  onUnlocked: () => void;
  /** Calm information, e.g. after a cancelled checkout. */
  notice?: string | null;
}

export function UnlockMyAid({ onUnlocked, notice = null }: UnlockMyAidProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { trackFunnel('paywall_viewed'); }, []);

  async function unlock() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await startCheckout();
      if (result.url) {
        window.location.assign(result.url);
        return; // Leaving for Stripe; keep the button in its busy state.
      }
      onUnlocked();
    } catch (thrown) {
      setError(thrown instanceof CheckoutError ? thrown.message : 'Payments are not available right now. Please try again in a moment.');
    }
    setBusy(false);
  }

  return (
    <FlowShell step={0}>
      <div className={styles.head}>
        <span className={styles.eyebrow}>My Aid</span>
        <h1 className={styles.title}>Unlock My Aid</h1>
        <p className={styles.lede}>
          See what your grants cover, what you may have to repay, and what you could still owe.
        </p>
      </div>

      <Card hero className={styles.card}>
        <div className={styles.price}>
          <span className={styles.amount}>$1</span>
          <span className={styles.priceText}>
            <span className={styles.priceLabel}>One-Time Beta Unlock</span>
            <span className={styles.priceTerms}>No subscription</span>
          </span>
        </div>

        {notice && <p className={styles.notice} role="status">{notice}</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}

        <button type="button" className={styles.cta} onClick={() => void unlock()} disabled={busy} aria-busy={busy}>
          {busy ? 'Opening secure checkout…' : 'Unlock My Aid'}
        </button>

        <div className={styles.earn}>
          <span className={styles.earnIcon} aria-hidden="true">💰</span>
          <div>
            <p className={styles.earnTitle}>Make your $1 back with Gradi</p>
            <p className={styles.earnBody}>
              Join as a creator for {GRADI_FEE}, get {GRADI_PAYOUT} at 10 likes. <strong className={styles.earnNet}>$4 ahead.</strong>
            </p>
          </div>
        </div>

        <p className={styles.trust}>
          <span aria-hidden="true">🔒</span> Secure checkout by Stripe · Your aid files never go to Stripe
        </p>
      </Card>

      <p className={styles.fine}>Gradi is an official Fynliq partner. Gradi sets its offer and may change it.</p>
    </FlowShell>
  );
}
