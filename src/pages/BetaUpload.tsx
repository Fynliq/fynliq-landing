import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Analyzing } from '../components/beta/Analyzing/Analyzing';
import { Dropzone } from '../components/beta/Dropzone/Dropzone';
import { FlowShell } from '../components/beta/FlowShell/FlowShell';
import { Card } from '../components/ui';
import { Paywall, type PaywallPhase } from '../components/beta/Paywall/Paywall';
import {
  AnalysisError,
  createAnalyzer,
  type AnalyzeStage,
  type PreparedDocuments,
} from '../beta/analyzer';
import {
  CheckoutError,
  checkoutChannel,
  getBillingStatus,
  isLocked,
  openCheckoutTab,
  prefersSameTab,
  savePending,
  startCheckout,
  trackFunnel,
  waitForUnlock,
  type BillingStatus,
} from '../billing/client';
import { triageFiles, type Rejection } from '../beta/files';
import type { AidAnalysis } from '../core';
import styles from './BetaUpload.module.css';
import { useAccount } from '../accounts/AccountProvider';

interface BetaUploadProps {
  /** Handed the finished read. The route change is the caller's business. */
  onAnalysed: (analysis: AidAnalysis) => void;
}

const WHAT_TO_UPLOAD = [
  {
    title: 'Your FAFSA Submission Summary',
    body: 'The one with your Student Aid Index on the first page. Download it from studentaid.gov under “My Aid”.',
  },
  {
    title: 'Your award letter or offer',
    body: 'The page listing your grants, loans and work-study for the year — from your school portal or the letter they emailed.',
  },
  {
    title: 'Your student account statement',
    body: 'Optional, and the one that makes the answer sharpest: it states this term’s bill, which is what the aid is measured against.',
  },
];

const PRIVACY = [
  'Your file is read on your own device and is never uploaded. Names, Social Security numbers, birth dates, addresses, emails, phone numbers and ID or account numbers are blacked out first, and only the Pell Grant, scholarship, loan, SAI and balance lines are sent to OpenAI to be read.',
  'Fynliq is not connected to FAFSA, your school or any lender, and cannot change anything on your account.',
  'Figures the document does not state are left blank. Nothing is estimated to fill a gap.',
];

export function BetaUpload({ onAnalysed }: BetaUploadProps) {
  const account = useAccount();
  const analyzer = useMemo(() => createAnalyzer(), []);

  const [files, setFiles] = useState<File[]>([]);
  const [rejections, setRejections] = useState<Rejection[]>([]);
  const [stage, setStage] = useState<AnalyzeStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);

  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => { abort.current?.abort(); }, []);
  const working = stage !== null;

  /*
   * FYNQ Beta Unlock.
   *
   * For an account created after the cutoff, the files are read and redacted
   * on this device first; only once FYNQ knows it can work with them is the
   * one-time $1 unlock shown, with the redacted read held in memory here. On
   * a desktop Stripe opens in a new tab and this page carries on by itself
   * once the webhook has confirmed payment; on a phone the redacted lines go
   * to the server's encrypted 30-minute store and this tab goes to Stripe.
   * Grandfathered, paid and test accounts never see any of it, and the
   * server's 402 is the real gate either way.
   */
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [prepared, setPrepared] = useState<PreparedDocuments | null>(null);
  const [payPhase, setPayPhase] = useState<PaywallPhase>('ready');
  const [notice, setNotice] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [afterPayment, setAfterPayment] = useState(false);
  const preparedRef = useRef<PreparedDocuments | null>(null);
  const checkoutUrl = useRef<string | null>(null);
  const waiter = useRef<AbortController | null>(null);
  const poke = useRef<() => void>(() => {});
  const entered = useRef(false);
  preparedRef.current = prepared;

  useEffect(() => {
    const controller = new AbortController();
    void getBillingStatus(controller.signal).then((status) => {
      if (controller.signal.aborted) return;
      setBilling(status);
      if (isLocked(status) && !entered.current) {
        entered.current = true;
        trackFunnel('my_aid_entered');
      }
    });
    return () => { controller.abort(); waiter.current?.abort(); };
  }, []);

  // One view per paywall shown.
  useEffect(() => { if (prepared) trackFunnel('paywall_viewed'); }, [prepared]);

  const showPaywall = useCallback((ready: PreparedDocuments) => {
    trackFunnel('preflight_completed');
    setPrepared(ready);
    setPayPhase('ready');
    setNotice(null);
    setPayError(null);
    setStage(null);
  }, []);

  const leavePaywall = useCallback(() => {
    waiter.current?.abort();
    checkoutUrl.current = null;
    setPrepared(null);
    setPayPhase('ready');
    setNotice(null);
    setPayError(null);
  }, []);

  /** Payment is confirmed server-side: send the read this page is holding. */
  const continueAfterUnlock = useCallback(async () => {
    const ready = preparedRef.current;
    waiter.current?.abort();
    if (!ready || !analyzer.submit) return;
    setPayPhase('confirmed');
    await new Promise((resolve) => setTimeout(resolve, 900));

    const controller = new AbortController();
    abort.current = controller;
    setAfterPayment(true);
    setStage('checking');
    try {
      const analysis = await analyzer.submit({ prepared: ready }, { signal: controller.signal, onStage: setStage });
      if (controller.signal.aborted) return;
      await account.capture(analysis, files);
      if (controller.signal.aborted) return;
      setPrepared(null);
      onAnalysed(analysis);
    } catch (thrown) {
      setStage(null);
      setAfterPayment(false);
      if (thrown instanceof AnalysisError && thrown.kind === 'cancelled') return;
      if (thrown instanceof AnalysisError && thrown.kind === 'unlock_required') {
        setPayPhase('ready');
        setPayError('Stripe has not confirmed a payment for this account yet. If you paid, wait a moment and press Unlock again — you will not be charged twice.');
        return;
      }
      // Paid and unlocked: a failed read goes back to the file list, where
      // "Analyse my aid" now runs without asking to pay again.
      setPrepared(null);
      setError(thrown instanceof AnalysisError ? thrown.message : 'Something went wrong reading your document. Please try again.');
    } finally {
      abort.current = null;
    }
  }, [account, analyzer, files, onAnalysed]);

  const beginWaiting = useCallback(() => {
    setPayPhase('waiting');
    waiter.current?.abort();
    const controller = new AbortController();
    waiter.current = controller;
    const wait = waitForUnlock({ signal: controller.signal });
    poke.current = wait.poke;
    void wait.done.then((unlocked) => {
      if (controller.signal.aborted) return;
      if (unlocked) void continueAfterUnlock();
      else {
        setPayPhase('ready');
        setNotice('FYNQ has not heard back from Stripe yet. If you paid, press Unlock again — you will not be charged twice.');
      }
    });
  }, [continueAfterUnlock]);

  // The tab Stripe returns to tells this one what happened.
  useEffect(() => {
    if (!prepared) return;
    const channel = checkoutChannel((message) => {
      if (message.type === 'ack' || !preparedRef.current) return;
      channel.post({ type: 'ack' });
      if (message.type === 'returned') poke.current();
      if (message.type === 'cancelled') {
        waiter.current?.abort();
        setPayPhase('ready');
        setNotice('Checkout was cancelled. You have not been charged.');
      }
    });
    return () => channel.close();
  }, [prepared]);

  function unlock() {
    const ready = preparedRef.current;
    if (!ready || payPhase === 'starting') return;
    setPayError(null);
    setNotice(null);
    // Opened now, inside the click, or the browser blocks it.
    const sameTab = billing?.sameTabCheckout === true && prefersSameTab();
    const tab = sameTab ? null : openCheckoutTab();
    setPayPhase('starting');
    void (async () => {
      try {
        const result = await startCheckout();
        if (result.unlocked || !result.url) {
          tab?.close();
          await continueAfterUnlock();
          return;
        }
        checkoutUrl.current = result.url;
        if (tab && !tab.closed) {
          tab.location.href = result.url;
          beginWaiting();
          return;
        }
        if (billing?.sameTabCheckout !== true) {
          setPayPhase('ready');
          setPayError('Your browser blocked the checkout tab. Allow pop-ups for this site, then press Unlock again.');
          return;
        }
        // Same-tab checkout: keep only the redacted aid lines, encrypted, for
        // up to 30 minutes, then go to Stripe.
        await savePending(ready.documents);
        window.location.assign(result.url);
      } catch (thrown) {
        tab?.close();
        setPayPhase('ready');
        setPayError(thrown instanceof CheckoutError ? thrown.message : 'Payments are not available right now. Please try again in a moment.');
      }
    })();
  }

  function reopenCheckout() {
    const url = checkoutUrl.current;
    if (!url) return;
    const tab = openCheckoutTab();
    if (tab) tab.location.href = url;
  }

  const handleAdd = useCallback(
    (incoming: File[]) => {
      if (incoming.length === 0) return;

      const { accepted, rejected } = triageFiles(files, incoming);
      setRejections(rejected);
      if (accepted.length > 0) setFiles((current) => [...current, ...accepted]);
      setError(null);
    },
    [files],
  );

  const handleRemove = useCallback((index: number) => {
    setFiles((current) => current.filter((_, i) => i !== index));
    setRejections([]);
  }, []);

  async function start() {
    if (files.length === 0 || working || (analyzer.connected && !consent)) return;

    const controller = new AbortController();
    abort.current = controller;

    setError(null);
    setRejections([]);
    setStage('reading');

    try {
      let analysis;
      if (analyzer.prepare && analyzer.submit) {
        const ready = await analyzer.prepare(files, { signal: controller.signal, onStage: setStage });
        if (controller.signal.aborted) return;
        // Locked accounts stop here, before anything leaves the device.
        if (isLocked(billing)) { showPaywall(ready); return; }
        try {
          analysis = await analyzer.submit({ prepared: ready }, { signal: controller.signal, onStage: setStage });
        } catch (thrown) {
          if (thrown instanceof AnalysisError && thrown.kind === 'unlock_required') { showPaywall(ready); return; }
          throw thrown;
        }
      } else {
        analysis = await analyzer.analyze(files, {
          signal: controller.signal,
          onStage: setStage,
        });
      }
      if (controller.signal.aborted) return;
      await account.capture(analysis, files);
      if (controller.signal.aborted) return;
      onAnalysed(analysis);
    } catch (thrown) {
      // Cancelling is something the student chose. It is not an error, and it
      // does not get an apology or a red box.
      if (thrown instanceof AnalysisError && thrown.kind === 'cancelled') {
        setStage(null);
        return;
      }

      setStage(null);
      setError(
        thrown instanceof AnalysisError
          ? thrown.message
          : 'Something went wrong reading your document. Please try again.',
      );
    } finally {
      abort.current = null;
    }
  }

  const paywall = prepared !== null && stage === null;

  return (
    <FlowShell step={working || paywall ? 2 : 1}>
      <div className={styles.head}>
        <span className={styles.eyebrow}>{afterPayment ? 'Payment confirmed' : working ? 'Analysing' : paywall ? 'My Aid' : 'Join the beta'}</span>
        <h1 className={styles.title}>
          {afterPayment ? 'Analyzing your aid…' : working ? 'Fynliq is reading your document' : paywall ? 'Your aid explanation is ready to unlock' : 'Upload your aid summary'}
        </h1>
        <p className={styles.lede}>
          {working
            ? 'Reading your documents and preparing your My Aid dashboard, with your answer, aid breakdown and next steps.'
            : paywall
              ? 'See what your grants cover, what you may have to repay, and what you could still owe.'
              : 'Add your FAFSA Submission Summary, school award letter, and account statement. Use current documents for the same student and period. AI can make mistakes, so check the extracted fields against your originals.'}
        </p>
      </div>

      <div className={styles.split}>
        <div className={styles.main}>
          {paywall && prepared ? (
            <Paywall
              phase={payPhase}
              documentCount={prepared.documents.length}
              withAidLines={prepared.withAidLines}
              notice={notice}
              error={payError}
              onUnlock={unlock}
              onCheckNow={() => poke.current()}
              onReopen={checkoutUrl.current ? reopenCheckout : undefined}
              onChangeDocuments={leavePaywall}
            />
          ) : stage !== null ? (
            <Analyzing
              stage={stage}
              fileNames={files.map((file) => file.name)}
              onCancel={() => abort.current?.abort()}
            />
          ) : (
            <>
              <Card hero>
                <Dropzone files={files} onAdd={handleAdd} onRemove={handleRemove} />
              </Card>

              {/* Refusals and failures are announced, because a student who
                  dropped a file and saw nothing happen assumes it worked. */}
              <div aria-live="polite" className={styles.messages}>
                {rejections.map((rejection) => (
                  <p key={`${rejection.name}:${rejection.reason}`} className={styles.rejection}>
                    <span className={styles.glyph} aria-hidden="true">
                      ⚠
                    </span>
                    {rejection.message}
                  </p>
                ))}

                {error && (
                  <p className={styles.error}>
                    <span className={styles.glyph} aria-hidden="true">
                      ⚠
                    </span>
                    {error}
                  </p>
                )}
              </div>

              <div className={styles.actions}>
                {analyzer.connected && <label><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /> I agree to send the aid lines from these documents to OpenAI for AI processing. Personal details are removed on this device first, but automated removal can miss something. <a href="https://openai.com/policies/privacy-policy/" target="_blank" rel="noreferrer">Privacy information</a></label>}
                <button
                  type="button"
                  className={styles.submit}
                  onClick={start}
                  disabled={files.length === 0 || (analyzer.connected && !consent)}
                >
                  Analyse my aid
                  <span aria-hidden="true">&rarr;</span>
                </button>
                <p className={styles.actionNote}>
                  {files.length === 0
                    ? 'Add at least one file to continue.'
                    : `${files.length} file${files.length === 1 ? '' : 's'} ready. This takes a few seconds.`}
                </p>
              </div>
            </>
          )}
        </div>

        <aside className={styles.aside}>
          {!paywall && <Card>
            <h2 className={styles.asideTitle}>What to upload</h2>
            <ul className={styles.list}>
              {WHAT_TO_UPLOAD.map((item) => (
                <li key={item.title} className={styles.item}>
                  <span className={styles.itemTitle}>{item.title}</span>
                  <span className={styles.itemBody}>{item.body}</span>
                </li>
              ))}
            </ul>
            <p className={styles.foot}>
              Any one of them produces an answer. All three produce the sharpest one.
            </p>
          </Card>}

          <Card>
            <h2 className={styles.asideTitle}>What happens to it</h2>
            <ul className={styles.rules}>
              {PRIVACY.map((rule) => (
                <li key={rule} className={styles.rule}>
                  <span className={styles.tick} aria-hidden="true">
                    ✓
                  </span>
                  {rule}
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <h2 className={styles.asideTitle}>If the read is poor</h2>
            <p className={styles.itemBody}>
              A photograph of a screen at an angle, a scan with the page cut off, or handwriting
              will read badly. Fynliq will say which figures it could not find rather than guessing
              at them — and a screenshot taken straight from your portal almost always reads
              cleanly.
            </p>
          </Card>
        </aside>
      </div>
    </FlowShell>
  );
}
