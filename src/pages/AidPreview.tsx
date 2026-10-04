import { useEffect, useState } from 'react';
import { FlowShell } from '../components/beta/FlowShell/FlowShell';
import { AidGlance } from '../components/AidGlance/AidGlance';
import { CheckoutError, startCheckout, trackFunnel } from '../billing/client';
import type { LockedPreview } from '../beta/preview';
import styles from './AidPreview.module.css';

/**
 * Step 3 for accounts that have not unlocked: what Fynliq found, for free,
 * then the $1 unlock for the full breakdown.
 *
 * The locked section below is decoration only. The detailed analysis is not
 * in this page, its source or its network traffic: the server releases it
 * after Stripe confirms payment.
 */
const LOCKED: { label: string; what: (reviewCount: number) => string }[] = [
  { label: 'Your grants explained', what: () => 'Each line of free money, and what keeps it coming next year' },
  { label: 'Your loans explained', what: () => 'How much you actually need to borrow, and which loan to take first' },
  { label: 'What you may actually owe', what: () => 'What is left after grants, and after loans' },
  { label: 'Important things to review', what: (n) => (n > 0 ? `The ${n} ${n === 1 ? 'thing' : 'things'} Fynliq flagged, in plain English` : 'Anything worth checking before you accept') },
  { label: 'Personalized next steps', what: () => 'What to do next, most important first' },
  { label: 'Questions to ask your financial aid office', what: () => 'Written for your offer, ready to copy into an email' },
];

interface AidPreviewProps {
  preview: LockedPreview;
  /** Shown above the preview, e.g. after a cancelled checkout. */
  notice?: string | null;
  /** Server says this account is already unlocked: load the full answer. */
  onUnlocked: () => void;
  onRestart: () => void;
}

export function AidPreview({ preview, notice = null, onUnlocked, onRestart }: AidPreviewProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { glance, reviewCount } = preview.preview;

  useEffect(() => { trackFunnel('aid_preview_viewed'); trackFunnel('paywall_viewed'); }, []);

  // Back from Stripe restores this page from the browser's cache with the
  // button still saying "Opening secure checkout…". Make it usable again.
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
      if (result.url) { window.location.assign(result.url); return; }
      onUnlocked();
    } catch (thrown) {
      setError(thrown instanceof CheckoutError ? thrown.message : 'Payments are not available right now. Please try again in a moment.');
    }
    setBusy(false);
  }

  return (
    <FlowShell step="preview">
      {notice && <p className={styles.notice} role="status">{notice}</p>}

      <div className={styles.head}>
        <span className={styles.eyebrow}>Preview</span>
        <h1 className={styles.title}>Your aid has been analyzed</h1>
        <p className={styles.lede}>Here’s what Fynliq found.</p>
      </div>

      <AidGlance glance={glance} />

      <p className={styles.found}>
        {reviewCount > 0
          ? <>Fynliq found <b>{reviewCount} {reviewCount === 1 ? 'thing' : 'things'}</b> worth reviewing.</>
          : <>Your full breakdown explains each part of your aid.</>}{' '}
        <a className={styles.jump} href="#unlock-title" onClick={(event) => { event.preventDefault(); document.getElementById('unlock-title')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>
          See them for $1 <span aria-hidden="true">&darr;</span>
        </a>
      </p>

      <section className={styles.locked} aria-labelledby="locked-title">
        <h2 id="locked-title" className={styles.lockedTitle}>What the $1 unlocks</h2>
        <ul className={styles.lockedList}>
          {LOCKED.map((item) => (
            <li key={item.label} className={styles.lockedItem}>
              <span className={styles.tick} aria-hidden="true">✓</span>
              <span className={styles.lockedLabel}>{item.label}</span>
              <span className={styles.lockedWhat}>{item.what(reviewCount)}</span>
              <span className={styles.bars} aria-hidden="true"><i /></span>
            </li>
          ))}
        </ul>
        <div className={styles.lock} aria-hidden="true">🔒</div>
      </section>

      <section className={styles.pay} aria-labelledby="unlock-title">
        <h2 id="unlock-title" className={styles.payTitle}>Unlock your complete aid breakdown</h2>
        <p className={styles.price}><b>$1</b> one-time beta unlock</p>
        <p className={styles.terms}>No subscription. Nothing renews.</p>
        <p className={styles.also}>Also opens Ask Fynliq, Search and Earn.</p>
        <ul className={styles.why} aria-label="Why Fynliq instead of a chatbot">
          <li>Every number is checked against your document. Nothing is guessed.</li>
          <li>Made for aid offers: grants, loans, work-study and what you’ll owe.</li>
          <li>Your name and ID numbers are removed before anything is read.</li>
        </ul>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <button type="button" className={styles.cta} onClick={() => void unlock()} disabled={busy} aria-busy={busy}>
          {busy ? 'Opening secure checkout…' : 'Unlock Full Analysis — $1'}
        </button>
        <p className={styles.trust}><span aria-hidden="true">🔒</span> Secure payment with Stripe</p>
        <p className={styles.trustSub}>Your aid documents stay private. Fynliq never sees your card.</p>
      </section>

      <p className={styles.secondary}>
        <button type="button" className={styles.link} onClick={onRestart}>Upload a different document</button>
      </p>
      <p className={styles.secondary}>
        Want another way to earn? <a className={styles.link} href="/gradi">Explore Gradi&nbsp;&rarr;</a>
      </p>
    </FlowShell>
  );
}
