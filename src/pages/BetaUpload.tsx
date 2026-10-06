import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Analyzing } from '../components/beta/Analyzing/Analyzing';
import { Dropzone } from '../components/beta/Dropzone/Dropzone';
import { FlowShell } from '../components/beta/FlowShell/FlowShell';
import { Card } from '../components/ui';
import {
  AnalysisError,
  createAnalyzer,
  type AnalyzeResult,
  type AnalyzeStage,
} from '../beta/analyzer';
import { triageFiles, type Rejection } from '../beta/files';
import styles from './BetaUpload.module.css';
import { useAccount } from '../accounts/AccountProvider';
import { useBilling } from '../billing/BillingProvider';
import { isLocked, onUnlockJourney, trackFunnel } from '../billing/client';
import { useRouter } from '../router/router';
import { trackEvent } from '../analytics/events';

interface BetaUploadProps {
  /** Handed the finished read (full answer, or a preview before the $1 unlock). */
  onAnalysed: (result: AnalyzeResult) => void;
}

const WHAT_TO_UPLOAD = [
  {
    title: 'Best: your award letter or offer',
    body: 'A screenshot of the page in your school portal that lists your grants, loans and work-study, or the letter they emailed.',
  },
  {
    title: 'Or: your FAFSA Submission Summary',
    body: 'The one with your Student Aid Index on the first page. Download it from studentaid.gov under “My Aid”.',
  },
  {
    title: 'Optional: your student account statement',
    body: 'It shows this term’s bill, so Fynliq can tell you exactly what is left to pay.',
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
   * Preview before pay. Every logged-in account can upload; one that has not
   * unlocked gets a free preview from the server and is asked for the $1
   * after it has seen what Fynliq found. Paid, grandfathered and test
   * accounts get the full answer straight away.
   */
  const billing = useBilling();
  const { navigate } = useRouter();
  const locked = isLocked(billing.status);
  const entered = useRef(false);
  useEffect(() => {
    if (billing.loading || entered.current) return;
    entered.current = true;
    trackFunnel('my_aid_page_view');
    if (locked) trackFunnel('my_aid_entered');
  }, [billing.loading, locked]);

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
    trackFunnel('aid_upload_started');
    if (onUnlockJourney(billing.status)) trackFunnel('preflight_completed');

    try {
      const result = await analyzer.analyze(files, {
        signal: controller.signal,
        onStage: setStage,
      });
      if (controller.signal.aborted) return;
      trackFunnel('aid_upload_completed');
      if (!('locked' in result)) await account.capture(result, files);
      if (controller.signal.aborted) return;
      onAnalysed(result);
    } catch (thrown) {
      // Cancelling is something the student chose. It is not an error, and it
      // does not get an apology or a red box.
      if (thrown instanceof AnalysisError && thrown.kind === 'cancelled') {
        setStage(null);
        return;
      }

      // The server says this account has not unlocked yet: back to step 1.
      if (thrown instanceof AnalysisError && thrown.kind === 'unlock_required') {
        setStage(null);
        const next = await billing.refresh();
        if (!isLocked(next)) setError(thrown.message);
        return;
      }

      setStage(null);
      // Failures the server never saw (it records its own): network or format trouble.
      if (!(thrown instanceof AnalysisError) || thrown.kind === 'network' || thrown.kind === 'format') {
        trackEvent('upload_failed', { reason: thrown instanceof AnalysisError ? thrown.kind : 'client', files: files.length });
      }
      setError(
        thrown instanceof AnalysisError
          ? thrown.message
          : 'Something went wrong reading your document. Please try again.',
      );
    } finally {
      abort.current = null;
    }
  }

  // Nothing to draw until we know which steps this account sees.
  if (billing.loading) return <FlowShell step={1}>{null}</FlowShell>;

  return (
    <FlowShell step={working ? 2 : 1}>
      <div className={styles.head}>
        <span className={styles.eyebrow}>{working ? 'Analyzing' : 'My Aid'}</span>
        <h1 className={styles.title}>
          {working ? 'Fynliq is reading your document' : 'Know what you’re getting — and what you’ll actually owe.'}
        </h1>
        <p className={styles.lede}>
          {working
            ? 'Reading your documents and preparing your answer: your aid breakdown, what you may owe, and next steps.'
            : 'Upload your financial aid offer and Fynliq separates your grants, scholarships, loans, remaining cost, and next steps.'}
        </p>
        {!working && (
          <button type="button" className={styles.example} onClick={() => navigate('/example')}>
            See an example <span aria-hidden="true">&rarr;</span>
          </button>
        )}
      </div>

      <div className={styles.split}>
        <div className={styles.main}>
          {stage !== null ? (
            <Analyzing
              stage={stage}
              fileNames={files.map((file) => file.name)}
              onCancel={() => abort.current?.abort()}
            />
          ) : (
            <>
              <Card hero>
                <Dropzone files={files} onAdd={handleAdd} onRemove={handleRemove} />
                {/* The privacy promise, where the decision to upload is made,
                    not in a side panel below the button. */}
                <ul className={styles.trust} aria-label="What happens to your file">
                  <li>Your file stays on your device. Fynliq reads it there.</li>
                  <li>Names, Social Security, student and account numbers are blacked out before anything is sent.</li>
                  <li>Fynliq can’t see or change anything with your school or FAFSA.</li>
                </ul>
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
                {analyzer.connected && <label><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /> Send only the aid amounts to be read by AI (OpenAI). Personal details are removed on this device first, but automated removal can miss something. <a href="https://openai.com/policies/privacy-policy/" target="_blank" rel="noreferrer">Privacy information</a></label>}
                <button
                  type="button"
                  className={styles.submit}
                  onClick={start}
                  disabled={files.length === 0 || (analyzer.connected && !consent)}
                >
                  {locked ? 'Analyze my aid — free' : 'Analyze my aid'}
                  <span aria-hidden="true">&rarr;</span>
                </button>
                <p className={styles.actionNote}>
                  {files.length === 0
                    ? 'Add one screenshot to continue. One is enough.'
                    : locked
                      ? 'Takes about 10 seconds. You see your totals before you’re asked to pay anything.'
                      : `${files.length} file${files.length === 1 ? '' : 's'} ready. This takes a few seconds.`}
                </p>
              </div>
            </>
          )}
        </div>

        <aside className={styles.aside}>
          <Card>
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
              One screenshot is enough. Adding more makes the answer sharper.
            </p>
          </Card>

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
