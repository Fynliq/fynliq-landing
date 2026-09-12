import { useCallback, useMemo, useRef, useState } from 'react';
import { Analyzing } from '../components/beta/Analyzing/Analyzing';
import { Dropzone } from '../components/beta/Dropzone/Dropzone';
import { FlowShell } from '../components/beta/FlowShell/FlowShell';
import { Card } from '../components/ui';
import {
  AnalysisError,
  createAnalyzer,
  type AnalyzeStage,
} from '../beta/analyzer';
import { triageFiles, type Rejection } from '../beta/files';
import type { AidAnalysis } from '../core';
import styles from './BetaUpload.module.css';

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
  'Your files are read to produce the answer on the next screen, and are not published or sold.',
  'Fynliq is not connected to FAFSA, your school or any lender, and cannot change anything on your account.',
  'Figures the document does not state are left blank. Nothing is estimated to fill a gap.',
];

export function BetaUpload({ onAnalysed }: BetaUploadProps) {
  const analyzer = useMemo(() => createAnalyzer(), []);

  const [files, setFiles] = useState<File[]>([]);
  const [rejections, setRejections] = useState<Rejection[]>([]);
  const [stage, setStage] = useState<AnalyzeStage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abort = useRef<AbortController | null>(null);
  const working = stage !== null;

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
    if (files.length === 0 || working) return;

    const controller = new AbortController();
    abort.current = controller;

    setError(null);
    setRejections([]);
    setStage('reading');

    try {
      const analysis = await analyzer.analyze(files, {
        signal: controller.signal,
        onStage: setStage,
      });
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
          : 'Something went wrong reading your document. Your files were not stored — try again.',
      );
    } finally {
      abort.current = null;
    }
  }

  return (
    <FlowShell step={working ? 2 : 1}>
      <div className={styles.head}>
        <span className={styles.eyebrow}>{working ? 'Analysing' : 'Join the beta'}</span>
        <h1 className={styles.title}>
          {working ? 'Fynliq is reading your document' : 'Upload your aid summary'}
        </h1>
        <p className={styles.lede}>
          {working
            ? 'Hold on a moment. Nothing on the next screen is invented — every figure comes from what you just uploaded, and anything Fynliq cannot read is listed as unread rather than filled in.'
            : 'Add your FAFSA Submission Summary, your award letter, or a screenshot of either. Fynliq reads the figures and tells you, in plain English, what your grants, loans, Student Aid Index and school balance actually mean — and what to do next.'}
        </p>
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
                <button
                  type="button"
                  className={styles.submit}
                  onClick={start}
                  disabled={files.length === 0}
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
              Any one of them produces an answer. All three produce the sharpest one.
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
