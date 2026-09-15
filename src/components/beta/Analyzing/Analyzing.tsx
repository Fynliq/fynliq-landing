import { ANALYZE_STAGES, STAGE_LABEL, type AnalyzeStage } from '../../../beta/analyzer';
import { Card, Skeleton } from '../../ui';
import styles from './Analyzing.module.css';

interface AnalyzingProps {
  stage: AnalyzeStage;
  /** Echoed back so the student can see it is working on the right files. */
  fileNames: string[];
  onCancel: () => void;
}

/**
 * The wait.
 *
 * Skeletons rather than a spinner, shaped like the answer that replaces them,
 * because the useful thing to communicate during a wait is what is coming —
 * and because a spinner is the same picture whether the work takes one second
 * or thirty.
 *
 * The page owns the heading; this card starts at the sentence under it, so
 * the flow never has two competing titles on screen at once.
 */
export function Analyzing({ stage, fileNames, onCancel }: AnalyzingProps) {
  const position = ANALYZE_STAGES.indexOf(stage);

  return (
    <Card hero className={styles.card}>
      <p className={styles.lede}>
        {fileNames.length === 1 ? (
          <>
            Reading <span className={styles.file}>{fileNames[0]}</span>. This usually takes a few
            seconds.
          </>
        ) : (
          <>Reading {fileNames.length} files. This usually takes a few seconds.</>
        )}
      </p>

      <ol className={styles.stages}>
        {ANALYZE_STAGES.map((entry, index) => {
          const state = index < position ? 'done' : index === position ? 'current' : 'todo';

          return (
            <li key={entry} className={`${styles.stage} ${styles[state]}`}>
              <span className={styles.mark} aria-hidden="true">
                {state === 'done' ? '✓' : state === 'current' ? '' : '·'}
              </span>
              {STAGE_LABEL[entry]}
            </li>
          );
        })}
      </ol>

      {/* One announcement per stage, rather than a live region over the whole
          list that would re-read every line each time one of them changes. */}
      <p className="srOnly" role="status">
        {STAGE_LABEL[stage]}. Step {position + 1} of {ANALYZE_STAGES.length}.
      </p>

      <div className={styles.preview} aria-hidden="true">
        <Skeleton width="58%" height="32px" />
        <Skeleton width="86%" height="17px" />
        <div className={styles.previewRow}>
          <Skeleton width="100%" height="72px" radius="var(--r-input)" />
          <Skeleton width="100%" height="72px" radius="var(--r-input)" />
          <Skeleton width="100%" height="72px" radius="var(--r-input)" />
        </div>
        <Skeleton width="100%" height="12px" radius="var(--r-pill)" />
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.cancel} onClick={onCancel}>
          Cancel
        </button>
        <p className={styles.note}>
          Cancelling stops this page from waiting. Files already sent for AI processing may continue to be processed.
        </p>
      </div>
    </Card>
  );
}
