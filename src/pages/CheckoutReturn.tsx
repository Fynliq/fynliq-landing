import { useEffect, useMemo, useRef, useState } from 'react';
import { FlowShell } from '../components/beta/FlowShell/FlowShell';
import { Card } from '../components/ui';
import { useBilling } from '../billing/BillingProvider';
import { trackFunnel, waitForUnlock } from '../billing/client';
import { useRouter } from '../router/router';
import styles from './UnlockMyAid.module.css';

/**
 * Where Stripe Checkout sends the student back: `/beta/checkout?result=…`.
 *
 * The query string only chooses the words. It is never evidence of payment:
 * this page waits for FYNQ's server, which only knows what Stripe's signed
 * webhook told it. Once the account is unlocked it goes back to the analysis
 * the student paid to see (`onConfirmed` loads it from the server), or to the
 * upload step when there is none. A cancelled checkout is handled by the app,
 * which puts the saved preview back.
 */

type View = 'confirming' | 'slow' | 'confirmed' | 'timeout' | 'signed_out';

export function CheckoutReturn({ onConfirmed }: { onConfirmed?: () => void | Promise<void> }) {
  const { navigate } = useRouter();
  const next = useRef(onConfirmed);
  next.current = onConfirmed;
  const goOn = () => (next.current ? void next.current() : navigate('/beta', { replace: true }));
  const { refresh } = useBilling();
  const cancelled = useMemo(() => new URLSearchParams(window.location.search).get('result') === 'cancelled', []);
  const [view, setView] = useState<View>('confirming');
  const poke = useRef<() => void>(() => {});

  // Reaching this page at all is the step that was missing from the data:
  // a payment with nothing after it could not tell "never came back" from
  // "came back and got lost". Content-free, like every funnel step.
  const seen = useRef(false);
  useEffect(() => {
    if (cancelled || seen.current) return;
    seen.current = true;
    trackFunnel('checkout_return_viewed');
  }, [cancelled]);

  useEffect(() => {
    if (cancelled) return;
    const controller = new AbortController();
    const slow = setTimeout(() => setView((v) => (v === 'confirming' ? 'slow' : v)), 15000);
    let signedOut = false;
    const wait = waitForUnlock({ signal: controller.signal, onSignedOut: () => { signedOut = true; } });
    poke.current = wait.poke;
    let advance: ReturnType<typeof setTimeout> | undefined;
    void wait.done.then(async (unlocked) => {
      clearTimeout(slow);
      if (controller.signal.aborted) return;
      if (signedOut) return setView('signed_out');
      if (!unlocked) return setView('timeout');
      await refresh();
      setView('confirmed');
      trackFunnel('unlock_confirmed_viewed');
      advance = setTimeout(() => (next.current ? void next.current() : navigate('/beta', { replace: true })), 1600);
    });
    return () => { controller.abort(); clearTimeout(slow); clearTimeout(advance); };
  }, [cancelled, navigate, refresh]);

  const confirmed = view === 'confirmed';
  const copy: Record<View, { title: string; body: string }> = {
    confirming: { title: 'We’re confirming your payment.', body: 'This usually takes a moment.' },
    slow: { title: 'Still confirming your payment…', body: 'Stripe is taking longer than usual. This page keeps checking — there is no need to pay again.' },
    confirmed: { title: 'Payment confirmed', body: 'Your full aid breakdown is unlocked. Opening it now…' },
    timeout: { title: 'Waiting for Stripe', body: 'Stripe has not confirmed a payment for this account yet. If you completed checkout it can take a few minutes, and you will not be charged twice.' },
    signed_out: { title: 'Log in to see your unlock', body: 'You’re not logged in on this browser. If you paid, the payment is safe — log in with the account you paid from and your full analysis will be there. You will not be charged twice.' },
  };

  return (
    <FlowShell step={confirmed ? 3 : 'preview'}>
      <div className={styles.head}>
        <span className={styles.eyebrow}>My Aid</span>
        <h1 className={styles.title}>{confirmed ? 'You’re unlocked' : 'Unlocking your full analysis'}</h1>
      </div>
      <Card hero className={styles.card}>
        <div className={styles.status} role="status" aria-live="polite">
          <span className={confirmed ? styles.done : styles.spinner} aria-hidden="true">{confirmed ? '✓' : ''}</span>
          <div>
            <p className={styles.statusTitle}>{copy[view].title}</p>
            <p className={styles.statusBody}>{copy[view].body}</p>
          </div>
        </div>
        {confirmed ? (
          <button type="button" className={styles.cta} onClick={goOn}>
            See my full analysis <span aria-hidden="true">&nbsp;&rarr;</span>
          </button>
        ) : (
          <button type="button" className={view === 'signed_out' ? styles.cta : styles.secondary} onClick={() => (view === 'timeout' || view === 'signed_out' ? window.location.reload() : poke.current())}>
            {/* A reload with no session goes through the account gate, which opens Log in and then comes back here. */}
            {view === 'signed_out' ? 'Log in' : 'Check again'}
          </button>
        )}
      </Card>
    </FlowShell>
  );
}
