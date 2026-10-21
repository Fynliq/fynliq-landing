import { useEffect, useState } from 'react';
import { FlowShell } from '../components/beta/FlowShell/FlowShell';
import { CheckoutError, startCheckout, trackFunnel } from '../billing/client';
import { useRouter } from '../router/router';
import { createAnalyzer } from '../beta/analyzer';
import { FREE_PREVIEW, PRICE, PRICE_LINE, PRICE_TERMS, UNLOCKS } from '../content/offer';
import styles from './AidPreview.module.css';

/**
 * Search, Ask Fynliq and Earn for an account that has not paid.
 *
 * The $1 is asked for only after the student has seen something useful of
 * their own: a free preview of their aid. Before that, this page sends them to
 * the free upload and says what the $1 will unlock, with no button to pay.
 * Once a preview exists, it offers the way back to it and the same $1 card
 * the preview shows, in the same words (src/content/offer.ts).
 */

export type UnlockFeature = 'ask' | 'search' | 'earn';

const FEATURE: Record<UnlockFeature, { name: string; title: string }> = {
  ask: { name: 'Ask Fynliq', title: 'Ask Fynliq opens with the full analysis' },
  search: { name: 'Search', title: 'Search opens with the full analysis' },
  earn: { name: 'Earn', title: 'Earn opens with the full analysis' },
};

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

  /** Whether this account has a free preview yet. `null` while asking the server. */
  const [hasPreview, setHasPreview] = useState<boolean | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const analyzer = createAnalyzer();
    void (analyzer.fetchSaved?.(controller.signal) ?? Promise.resolve(null))
      .catch(() => null)
      .then((saved) => { if (!controller.signal.aborted) setHasPreview(saved !== null); });
    return () => controller.abort();
  }, []);

  // A price is only shown, and only counted as shown, once there is a preview.
  useEffect(() => { if (hasPreview) trackFunnel('paywall_viewed'); }, [hasPreview]);

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

  const unlocks = (
    <ul className={styles.why} aria-label={`What the ${PRICE} unlocks`}>
      {UNLOCKS.map((item) => <li key={item.label}>{item.label}</li>)}
      <li>Ask Fynliq, Search and Earn</li>
    </ul>
  );

  return (
    <FlowShell step={0} tab={feature ?? 'aid'}>
      {notice && <p className={styles.notice} role="status">{notice}</p>}

      <div className={styles.head}>
        <span className={styles.eyebrow}>{copy ? copy.name : 'My Aid'}</span>
        <h1 className={styles.title}>{copy ? copy.title : 'Unlock your full analysis'}</h1>
        <p className={styles.lede}>{PRICE_LINE}</p>
      </div>

      {hasPreview === null && <p className={styles.terms} role="status">Checking for your preview…</p>}

      {hasPreview === false && (
        <>
          <section className={styles.free} aria-labelledby="free-title">
            <h2 id="free-title" className={styles.freeTitle}>Start with your free preview</h2>
            <p className={styles.freeBody}>Upload a screenshot of your aid offer. Before you pay anything, you see:</p>
            <ul className={styles.why}>{FREE_PREVIEW.map((item) => <li key={item}>{item}</li>)}</ul>
            <button type="button" className={styles.freeCta} onClick={() => navigate('/beta')}>
              Check my aid offer — free <span aria-hidden="true">&rarr;</span>
            </button>
          </section>

          <section className={styles.pay} aria-labelledby="unlock-title">
            <h2 id="unlock-title" className={styles.payTitle}>After your preview, {PRICE} unlocks</h2>
            {unlocks}
            <p className={styles.terms}>{PRICE_TERMS}</p>
          </section>
        </>
      )}

      {hasPreview === true && (
        <>
          <section className={styles.free} aria-labelledby="free-title">
            <h2 id="free-title" className={styles.freeTitle}>Your free preview is ready</h2>
            <p className={styles.freeBody}>Your totals are saved. Look at them again before deciding.</p>
            <button type="button" className={styles.freeCta} onClick={() => navigate('/beta/results')}>
              See my preview <span aria-hidden="true">&rarr;</span>
            </button>
          </section>

          <section className={styles.pay} aria-labelledby="unlock-title">
            <h2 id="unlock-title" className={styles.payTitle}>Unlock your full analysis</h2>
            <p className={styles.price}><b>{PRICE}</b> to unlock the full analysis</p>
            <p className={styles.terms}>{PRICE_TERMS}</p>
            {unlocks}
            {error && <p className={styles.error} role="alert">{error}</p>}
            <button type="button" className={styles.cta} onClick={() => void unlock()} disabled={busy} aria-busy={busy}>
              {busy ? 'Opening secure checkout…' : `Unlock the full analysis — ${PRICE}`}
            </button>
            <p className={styles.trust}><span aria-hidden="true">🔒</span> Secure payment with Stripe</p>
            <p className={styles.trustSub}>Your aid documents stay private. Fynliq never sees your card.</p>
          </section>
        </>
      )}

      <p className={styles.fine}>Gradi is an official Fynliq partner and is separate from your {PRICE} unlock. Gradi sets its offer and may change it.</p>
    </FlowShell>
  );
}
