import { useEffect, useState } from 'react';
import { FlowShell } from '../components/beta/FlowShell/FlowShell';
import { CheckoutError, startCheckout, trackFunnel } from '../billing/client';
import { useRouter } from '../router/router';
import styles from './AidPreview.module.css';

/**
 * The one-time $1 FYNQ Beta Unlock, shown on Search, Ask Fynliq and Earn for
 * accounts created after the beta cutoff that have not paid.
 *
 * Same card, wording and button as the $1 card on the My Aid preview, so the
 * offer reads the same wherever a student meets it. My Aid itself stays free
 * to try, and this page says so: a student who has not seen what Fynliq does
 * is pointed at the free upload first, not pushed straight to Stripe.
 */

export type UnlockFeature = 'ask' | 'search' | 'earn';

const FEATURE: Record<UnlockFeature, { name: string; title: string }> = {
  ask: { name: 'Ask Fynliq', title: 'Ask Fynliq is part of the $1 unlock' },
  search: { name: 'Search', title: 'Search is part of the $1 unlock' },
  earn: { name: 'Earn', title: 'Earn is part of the $1 unlock' },
};

const INCLUDED = [
  'Your full aid breakdown in My Aid',
  'Ask Fynliq: answers built from your own aid',
  'Search: what other students are asking, answered',
  'Earn: ways to make money with our partner Gradi',
];

interface UnlockMyAidProps {
  /** Called when the server says no payment is needed after all. */
  onUnlocked: () => void;
  /** Calm information, e.g. after a cancelled checkout. */
  notice?: string | null;
  /** The tab the student was trying to open, when there is one. */
  feature?: UnlockFeature | null;
}

export function UnlockMyAid({ onUnlocked, notice = null, feature = null }: UnlockMyAidProps) {
  const { navigate } = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = feature ? FEATURE[feature] : null;

  useEffect(() => { trackFunnel('paywall_viewed'); }, []);

  // Back from Stripe restores this page from the browser's cache with the
  // button still busy. Make it usable again.
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => { if (event.persisted) setBusy(false); };
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);

  async function unlock() {
    if (busy) return;
    setBusy(true);
    setError(null);
    trackFunnel('unlock_button_clicked');
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
    <FlowShell step={0} tab={feature ?? 'aid'}>
      {notice && <p className={styles.notice} role="status">{notice}</p>}

      <div className={styles.head}>
        <span className={styles.eyebrow}>{copy ? copy.name : 'Fynliq beta'}</span>
        <h1 className={styles.title}>{copy ? copy.title : 'Unlock the Fynliq beta'}</h1>
        <p className={styles.lede}>One $1 payment opens every tab. Not sure yet? Try My Aid first. It’s free.</p>
      </div>

      {/* The free way in, before the price. */}
      <section className={styles.free} aria-labelledby="free-title">
        <h2 id="free-title" className={styles.freeTitle}>Start free</h2>
        <p className={styles.freeBody}>Upload a screenshot of your aid offer and see your free money, loans and what you may owe before you pay anything.</p>
        <button type="button" className={styles.freeCta} onClick={() => navigate('/beta')}>
          Check my aid offer — free <span aria-hidden="true">&rarr;</span>
        </button>
      </section>

      <section className={styles.pay} aria-labelledby="unlock-title">
        <h2 id="unlock-title" className={styles.payTitle}>Or unlock everything now</h2>
        <p className={styles.price}><b>$1</b> one-time beta unlock</p>
        <p className={styles.terms}>No subscription. Nothing renews.</p>
        <ul className={styles.why} aria-label="What the $1 unlocks">
          {INCLUDED.map((item) => <li key={item}>{item}</li>)}
        </ul>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <button type="button" className={styles.cta} onClick={() => void unlock()} disabled={busy} aria-busy={busy}>
          {busy ? 'Opening secure checkout…' : 'Unlock everything — $1'}
        </button>
        <p className={styles.trust}><span aria-hidden="true">🔒</span> Secure payment with Stripe</p>
        <p className={styles.trustSub}>Your aid documents stay private. Fynliq never sees your card.</p>
      </section>

      <p className={styles.fine}>Gradi is an official Fynliq partner and is separate from your $1 unlock. Gradi sets its offer and may change it.</p>
    </FlowShell>
  );
}
