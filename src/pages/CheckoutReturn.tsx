import { useEffect, useMemo, useRef, useState } from 'react';
import { Analyzing } from '../components/beta/Analyzing/Analyzing';
import { FlowShell } from '../components/beta/FlowShell/FlowShell';
import { Paywall, type PaywallPhase } from '../components/beta/Paywall/Paywall';
import { Card } from '../components/ui';
import { AnalysisError, createAnalyzer, type AnalyzeStage } from '../beta/analyzer';
import {
  CheckoutError,
  checkoutChannel,
  forgetPending,
  getBillingStatus,
  isLocked,
  readPending,
  startCheckout,
  waitForUnlock,
  type PendingRef,
} from '../billing/client';
import type { AidAnalysis } from '../core';
import styles from './BetaUpload.module.css';

/**
 * Where Stripe Checkout sends the student back: `/beta/checkout?result=…`.
 *
 * The query string only chooses which words to show. It is never evidence of
 * payment: this page asks FYNQ's server, which only knows what Stripe's
 * signed webhook told it.
 *
 *  - Desktop (Stripe opened in a new tab): tell the original My Aid tab,
 *    which is still holding the student's read, and let it carry on.
 *  - Phone (same tab): the redacted read is in the server's encrypted
 *    30-minute store. Once payment is confirmed, analyse it from there.
 *  - Neither (the original tab was closed): the account is unlocked; the
 *    student chooses their documents again and is not asked to pay again.
 */

type View =
  | { kind: 'confirming' }
  | { kind: 'slow' }
  | { kind: 'handed-off'; paid: boolean }
  | { kind: 'analyzing'; stage: AnalyzeStage; documents: number }
  | { kind: 'unlocked'; message: string }
  | { kind: 'cancelled-pending'; pending: PendingRef }
  | { kind: 'cancelled' };

interface CheckoutReturnProps {
  onAnalysed: (analysis: AidAnalysis) => void;
}

export function CheckoutReturn({ onAnalysed }: CheckoutReturnProps) {
  const analyzer = useMemo(() => createAnalyzer(), []);
  const cancelled = useMemo(() => new URLSearchParams(window.location.search).get('result') === 'cancelled', []);
  const [view, setView] = useState<View>({ kind: 'confirming' });
  const [payPhase, setPayPhase] = useState<PaywallPhase>('ready');
  const [payError, setPayError] = useState<string | null>(null);
  const poke = useRef<() => void>(() => {});

  useEffect(() => {
    // Safe to run twice (Strict Mode in development): the first run is
    // aborted by its cleanup, and nothing here changes server state except
    // the analysis itself, which only starts once payment is confirmed.
    const controller = new AbortController();
    let acked = false;
    const channel = checkoutChannel((message) => { if (message.type === 'ack') acked = true; });
    channel.post({ type: cancelled ? 'cancelled' : 'returned' });

    void (async () => {
      // Give an open My Aid tab a moment to answer.
      await new Promise((resolve) => setTimeout(resolve, 700));
      const pending = readPending();

      if (cancelled) {
        if (acked) return setView({ kind: 'handed-off', paid: false });
        if (pending) return setView({ kind: 'cancelled-pending', pending });
        return setView({ kind: 'cancelled' });
      }

      // Wait for the webhook. Usually a second or two.
      const slow = setTimeout(() => setView((v) => (v.kind === 'confirming' ? { kind: 'slow' } : v)), 20000);
      const status = await getBillingStatus(controller.signal);
      let unlocked = status !== null && !isLocked(status);
      if (!unlocked) {
        const wait = waitForUnlock({ signal: controller.signal, intervalMs: 2000, timeoutMs: 10 * 60 * 1000 });
        poke.current = wait.poke;
        unlocked = await wait.done;
      }
      clearTimeout(slow);
      if (controller.signal.aborted) return;
      if (!unlocked) {
        return setView({ kind: 'unlocked', message: 'Stripe has not confirmed a payment for this account yet. If you completed checkout, it can take a few minutes — you will not be charged twice if you try again from My Aid.' });
      }

      if (acked) {
        // The original tab has the documents and is already continuing.
        setView({ kind: 'handed-off', paid: true });
        window.setTimeout(() => window.close(), 1500);
        return;
      }

      if (pending && analyzer.submit) {
        setView({ kind: 'analyzing', stage: 'checking', documents: pending.documents });
        try {
          const analysis = await analyzer.submit({ pendingId: pending.id }, {
            signal: controller.signal,
            onStage: (stage) => setView({ kind: 'analyzing', stage, documents: pending.documents }),
          });
          if (controller.signal.aborted) return;
          forgetPending();
          onAnalysed(analysis);
        } catch (thrown) {
          if (controller.signal.aborted) return;
          forgetPending();
          const detail = thrown instanceof AnalysisError ? thrown.message : '';
          setView({ kind: 'unlocked', message: `Payment confirmed — your account is unlocked for the beta. ${detail || 'Your prepared documents could not be read.'} Choose your documents again; you will not be charged again.` });
        }
        return;
      }

      setView({ kind: 'unlocked', message: 'Payment confirmed — your account is unlocked for the beta. Choose your aid documents to see your personalized answer. You will not be charged again.' });
    })();

    return () => { controller.abort(); channel.close(); };
  }, [analyzer, cancelled, onAnalysed]);

  function retryCheckout() {
    setPayError(null);
    setPayPhase('starting');
    void startCheckout()
      .then((result) => {
        if (result.url) window.location.assign(result.url);
        else window.location.reload();
      })
      .catch((thrown) => {
        setPayPhase('ready');
        setPayError(thrown instanceof CheckoutError ? thrown.message : 'Payments are not available right now. Please try again in a moment.');
      });
  }

  if (view.kind === 'cancelled-pending') {
    return (
      <FlowShell step={2}>
        <Head eyebrow="My Aid" title="Your aid explanation is ready to unlock" lede="Checkout was cancelled and you have not been charged. Your prepared aid lines are held, encrypted, for a few more minutes if you want to try again." />
        <div className={styles.main}>
          <Paywall
            phase={payPhase}
            documentCount={view.pending.documents}
            withAidLines={null}
            error={payError}
            onUnlock={retryCheckout}
            onChangeDocuments={() => { forgetPending(true); window.location.assign('/beta'); }}
          />
        </div>
      </FlowShell>
    );
  }

  if (view.kind === 'analyzing') {
    return (
      <FlowShell step={2}>
        <Head eyebrow="Payment confirmed" title="Analyzing your aid…" lede="Reading your aid lines and preparing your My Aid dashboard, with your answer, aid breakdown and next steps." />
        <div className={styles.main}>
          <Analyzing stage={view.stage} fileNames={Array.from({ length: view.documents }, (_, i) => `Document ${i + 1}`)} onCancel={() => window.location.assign('/beta')} />
        </div>
      </FlowShell>
    );
  }

  const copy: Record<Exclude<View['kind'], 'cancelled-pending' | 'analyzing'>, { eyebrow: string; title: string; body: string }> = {
    confirming: { eyebrow: 'My Aid', title: 'Confirming your payment…', body: 'Waiting for Stripe to confirm. This usually takes a few seconds.' },
    slow: { eyebrow: 'My Aid', title: 'Still confirming your payment…', body: 'Stripe is taking longer than usual. This page keeps checking — there is no need to pay again.' },
    'handed-off': view.kind === 'handed-off' && view.paid
      ? { eyebrow: 'Payment confirmed', title: 'Your answer is opening in your My Aid tab', body: 'You can close this tab. Your documents never left your other tab, so there is nothing to choose again.' }
      : { eyebrow: 'My Aid', title: 'Checkout cancelled', body: 'You have not been charged. You can close this tab and return to My Aid.' },
    unlocked: { eyebrow: 'My Aid', title: 'Payment confirmed', body: view.kind === 'unlocked' ? view.message : '' },
    cancelled: { eyebrow: 'My Aid', title: 'Checkout cancelled', body: 'You have not been charged. Return to My Aid whenever you are ready.' },
  };
  const c = copy[view.kind];
  const title = view.kind === 'unlocked' && view.message.startsWith('Stripe has not') ? 'Waiting for Stripe' : c.title;

  return (
    <FlowShell step={2}>
      <Head eyebrow={c.eyebrow} title={title} lede={c.body} />
      <div className={styles.main}>
        <Card hero>
          <div className={styles.actions} role="status" aria-live="polite">
            {(view.kind === 'confirming' || view.kind === 'slow') && (
              <button type="button" className={styles.submit} onClick={() => poke.current()}>
                Check again
              </button>
            )}
            {(view.kind === 'unlocked' || view.kind === 'cancelled') && (
              <a className={styles.submit} href="/beta">
                Go to My Aid <span aria-hidden="true">&rarr;</span>
              </a>
            )}
            {view.kind === 'handed-off' && (
              <a className={styles.submit} href="/beta">
                Open My Aid here instead
              </a>
            )}
          </div>
        </Card>
      </div>
    </FlowShell>
  );
}

function Head({ eyebrow, title, lede }: { eyebrow: string; title: string; lede: string }) {
  return (
    <div className={styles.head}>
      <span className={styles.eyebrow}>{eyebrow}</span>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.lede}>{lede}</p>
    </div>
  );
}
