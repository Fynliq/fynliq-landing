import { Card } from '../../ui';
import styles from './Paywall.module.css';

/**
 * The one-time $1 FYNQ Beta Unlock, as the next step of My Aid.
 *
 * It appears only after the student's own documents have been read and
 * redacted on their device and found usable, so it answers the question they
 * came with — "can FYNQ help with my aid?" — before asking for anything.
 * No timers, no scarcity, no fear: what they get, what it costs, and that it
 * is paid once.
 *
 * The page heading ("Your aid explanation is ready to unlock") is owned by
 * the page, like every other step of the flow.
 */

export type PaywallPhase = 'ready' | 'starting' | 'waiting' | 'confirmed';

interface PaywallProps {
  phase: PaywallPhase;
  documentCount: number;
  /** Files with usable aid lines, when known (unknown after a same-tab return). */
  withAidLines: number | null;
  /** Calm, non-error information, e.g. a cancelled checkout. */
  notice?: string | null;
  error?: string | null;
  onUnlock: () => void;
  onCheckNow?: () => void;
  onReopen?: () => void;
  onChangeDocuments: () => void;
}

const WHAT_YOU_SEE = [
  'Which of your aid is free money you keep',
  'Which money you may have to repay, and on what terms',
  'How much of your school bill your aid appears to cover',
  'What balance you might still owe',
];

export function aidLinesLine(found: number | null, total: number): string {
  if (found === null) return 'Financial-aid lines found and ready to explain';
  if (total === 1) return 'Financial-aid lines found in your document';
  if (found === total) return `Financial-aid lines found in all ${total} documents`;
  return `Financial-aid lines found in ${found} of ${total} documents`;
}

export function Paywall({
  phase,
  documentCount,
  withAidLines,
  notice,
  error,
  onUnlock,
  onCheckNow,
  onReopen,
  onChangeDocuments,
}: PaywallProps) {
  const plural = documentCount === 1 ? '' : 's';

  if (phase === 'waiting' || phase === 'confirmed') {
    const confirmed = phase === 'confirmed';
    return (
      <Card hero className={styles.card}>
        <div className={styles.waiting} role="status" aria-live="polite">
          <span className={`${styles.pulse} ${confirmed ? styles.pulseDone : ''}`} aria-hidden="true">
            {confirmed ? '✓' : ''}
          </span>
          <div>
            <p className={styles.waitingTitle}>{confirmed ? 'Payment confirmed' : 'Finish paying in the Stripe tab'}</p>
            <p className={styles.waitingBody}>
              {confirmed
                ? 'Analyzing your aid…'
                : `This page continues by itself as soon as Stripe confirms your payment. ${documentCount === 1 ? 'Your document is' : `Your ${documentCount} documents are`} still here — you will not need to choose ${documentCount === 1 ? 'it' : 'them'} again.`}
            </p>
          </div>
        </div>
        {!confirmed && (
          <div className={styles.waitingActions}>
            {onCheckNow && (
              <button type="button" className={styles.secondary} onClick={onCheckNow}>
                I’ve paid — check now
              </button>
            )}
            {onReopen && (
              <button type="button" className={styles.link} onClick={onReopen}>
                Reopen checkout
              </button>
            )}
            <button type="button" className={styles.link} onClick={onChangeDocuments}>
              Cancel
            </button>
          </div>
        )}
        {error && <p className={styles.error} role="alert">{error}</p>}
      </Card>
    );
  }

  return (
    <Card hero className={styles.card}>
      <ul className={styles.ready} aria-label="What FYNQ found">
        <li className={styles.readyItem}>
          <span className={styles.tick} aria-hidden="true">✓</span>
          {documentCount} document{plural} read on this device
        </li>
        <li className={styles.readyItem}>
          <span className={styles.tick} aria-hidden="true">✓</span>
          {aidLinesLine(withAidLines, documentCount)}
        </li>
        <li className={styles.readyItem}>
          <span className={styles.tick} aria-hidden="true">✓</span>
          Names, Social Security numbers and account numbers removed before anything leaves your device
        </li>
      </ul>

      <div className={styles.unlocks}>
        <h2 className={styles.unlocksTitle}>Your explanation will show</h2>
        <ul className={styles.unlocksList}>
          {WHAT_YOU_SEE.map((line) => (
            <li key={line}>{line}</li>
          ))}
          <li>What your actual aid document means, line by line</li>
        </ul>
      </div>

      <div className={styles.offer}>
        <p className={styles.price}>
          <span className={styles.amount}>$1.00</span>
          <span className={styles.priceLabel}>One-Time Beta Unlock</span>
        </p>
        <p className={styles.terms}>No subscription. No recurring charges.</p>
      </div>

      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}

      <div className={styles.actions}>
        <button type="button" className={styles.cta} onClick={onUnlock} disabled={phase === 'starting'} aria-busy={phase === 'starting'}>
          {phase === 'starting' ? 'Opening secure checkout…' : 'Unlock My Aid — $1'}
        </button>
        <p className={styles.support}>Pay once for beta access. Upload future aid documents without paying again.</p>
      </div>

      <p className={styles.trust}>
        <span aria-hidden="true">🔒</span> Your original financial-aid files are not sent to Stripe. Payment is handled by
        Stripe; Fynliq never sees your card number.
      </p>

      <button type="button" className={styles.link} onClick={onChangeDocuments}>
        Choose different documents
      </button>
    </Card>
  );
}
