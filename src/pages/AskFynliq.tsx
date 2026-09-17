import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../components/nav/AppShell/AppShell';
import { Skeleton } from '../components/ui';
import { Aurora } from '../components/fx';
import { AskError, createAsker, type AskAnswer } from '../ask/asker';
import { questionById, QUESTIONS, type Question } from '../search/library';
import { useSearchDemand } from '../search/SearchProvider';
import { type AidAnalysis } from '../core';
import styles from './AskFynliq.module.css';

interface AskFynliqProps {
  /** The student's own read, or `null` when they have not uploaded anything. */
  analysis: AidAnalysis | null;
}

/** The prompts offered when the box is empty — the questions most are asking. */
const PROMPT_COUNT = 4;

/**
 * Ask Fynliq.
 *
 * The third tab, and the end of the journey the other two set up: My Aid is
 * where a document goes in, Search is what everybody else is asking, and this
 * is the same question asked about your own money.
 *
 * The distinction the page is built around is `basis`. An answer is either
 * `personal` — computed from figures on the student's own document, and
 * labelled with the fields it read — or `general`, in which case it says so
 * and names what would have to be added to make it personal. There is no
 * third state where an answer sounds personal and is not, and the contract at
 * the seam refuses to let the backend invent one.
 */
export function AskFynliq({ analysis }: AskFynliqProps) {
  const asker = useMemo(() => createAsker(), []);
  const { ranked, record } = useSearchDemand();
  const [mode, setMode] = useState<'general' | 'personal'>(analysis?.reviewed ? 'personal' : 'general');
  const [reviewedToken, setReviewedToken] = useState<string | null>(null);
  const canPersonalize = Boolean(analysis?.summaryToken && (analysis.reviewed || reviewedToken === analysis.summaryToken));
  const personal = mode === 'personal' && canPersonalize;

  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState<string | null>(null);
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abort = useRef<AbortController | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  /** The most-searched questions, offered as a starting point. */
  const prompts = useMemo(
    () =>
      ranked
        .slice(0, PROMPT_COUNT)
        .map((demand) => questionById(demand.id))
        .filter((entry): entry is Question => entry !== undefined),
    [ranked],
  );

  const ask = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length === 0 || abort.current) return;
      if (trimmed.length > 2000) { setError('Please keep your question under 2,000 characters.'); return; }

      const controller = new AbortController();
      abort.current = controller;

      setAsked(trimmed);
      setAnswer(null);
      setError(null);
      setThinking(true);
      const timer = window.setTimeout(() => controller.abort(), 55000);

      // A question put here is demand like any other, and counts toward the
      // same ranking the search page draws.
      record({ query: trimmed, questionId: null, kind: 'search' });

      try {
        const result = await asker.ask(trimmed, personal && analysis ? { ...analysis, reviewed: true } : null, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setAnswer(result);
      } catch (thrown) {
        if (abort.current !== controller) return;
        setError(
          controller.signal.aborted ? 'That took too long. Please try again.' : thrown instanceof AskError
            ? thrown.message
            : 'Something went wrong answering that. Try again in a moment.',
        );
      } finally {
        window.clearTimeout(timer);
        if (abort.current === controller) { setThinking(false); abort.current = null; }
      }
    },
    [analysis, asker, record, personal],
  );

  /*
   * A question arrived from the answer page as `?q=`.
   *
   * Read once, on mount, and then cleared out of the URL — leaving it there
   * would mean a refresh silently re-asks a question the student has already
   * had answered, and a shared link would carry somebody's question with it.
   */
  useEffect(() => {
    const incoming = new URLSearchParams(window.location.search).get('q');
    if (!incoming) return;

    setQuestion(incoming.slice(0, 2000));
    window.history.replaceState({}, '', window.location.pathname);
    // Deliberately once: this is a handoff, not a subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => { abort.current?.abort(); abort.current = null; }, []);

  const related = (answer?.relatedIds ?? [])
    .map((id) => questionById(id))
    .filter((entry): entry is Question => entry !== undefined);

  return (
    <AppShell tab="ask">
      <div className={styles.page}>
        <header className={styles.head}>
          <span className={styles.eyebrow}>Ask Fynliq</span>
          <h1 className={styles.title}>Make sense of your financial aid.</h1>
          <p className={styles.lede}>
            Ask a general question, or use your reviewed documents for an answer about your own aid.
            Missing amounts and dates stay unknown.
          </p>
        </header>

        {/* ---- What it is answering from ---------------------------- */}
        <div className={`${styles.source} ${personal ? styles.sourceOn : ''}`}>
          <span className={styles.sourceGlyph} aria-hidden="true">
            {personal ? '✓' : '○'}
          </span>
          <div className={styles.sourceBody}>
            <p className={styles.sourceTitle}>
              {personal ? 'Using your reviewed documents' : 'General questions are ready'}
            </p>
            <p className={styles.sourceNote}>
              {personal && analysis ? `Using ${analysis.document.fileNames.join(', ')}. Answers include document references.` : 'You can ask now without uploading or reviewing anything. General answers do not use your personal figures.'}
            </p>
          </div>
          {!analysis && (
            <a className={styles.sourceCta} href="/beta">
              Upload <span aria-hidden="true">&rarr;</span>
            </a>
          )}
        </div>
        <fieldset className={styles.modes} disabled={thinking}>
          <legend>Answer using</legend>
          <label><input type="radio" name="answer-mode" checked={!personal} onChange={() => setMode('general')} /> General information</label>
          <label><input type="radio" name="answer-mode" checked={personal} disabled={!canPersonalize} onChange={() => setMode('personal')} /> My documents</label>
        </fieldset>
        {analysis?.summaryToken && !canPersonalize && <details className={styles.review}>
          <summary>Use my uploaded documents — review here</summary>
          <p>Compare these extracted fields with your originals. If anything is incorrect, upload a clearer copy from My Aid.</p>
          <ul>{analysis.summaryFacts?.map(f => <li key={f.id}><strong>{f.label}: {f.value}</strong>{f.estimated ? ' (estimate)' : ''}<p>{f.period} · {analysis.document.fileNames[f.document - 1]} · page {f.page}</p><blockquote>{f.quote}</blockquote></li>)}</ul>
          <label><input type="checkbox" disabled={thinking} onChange={e => { setReviewedToken(e.target.checked ? analysis.summaryToken! : null); if (e.target.checked) setMode('personal'); }} /> I checked these fields against my originals and they match.</label>
        </details>}

        {/* ---- The composer ------------------------------------------ */}
        <form
          className={styles.composer}
          onSubmit={(event) => {
            event.preventDefault();
            void ask(question);
          }}
        >
          <label className="srOnly" htmlFor="ask-box">
            Your question
          </label>
          <textarea
            id="ask-box"
            maxLength={2000}
            ref={box}
            className={styles.box}
            rows={3}
            value={question}
            placeholder="Why is my refund taking so long?"
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends; shift+enter is a new line. A question is one
              // sentence far more often than it is a paragraph.
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void ask(question);
              }
            }}
          />

          <div className={styles.composerFoot}>
            <p className={styles.hint}>
              <kbd className={styles.kbd}>Enter</kbd> to ask &middot;{' '}
              <kbd className={styles.kbd}>Shift</kbd> + <kbd className={styles.kbd}>Enter</kbd> for
              a new line
            </p>
            <button
              type="submit"
              className={styles.send}
              disabled={question.trim().length === 0 || thinking}
            >
              {thinking ? 'Preparing answer…' : 'Ask Fynliq'}
              <span aria-hidden="true">&rarr;</span>
            </button>
          </div>
        </form>

        {/* ---- Starting points --------------------------------------- */}
        {!asked && (
          <section className={styles.prompts} aria-labelledby="prompts-title">
            <h2 id="prompts-title" className={styles.promptsTitle}>
              Questions to get started
            </h2>
            <ul className={styles.promptList}>
              {prompts.map((entry) => {
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className={styles.prompt}
                      onClick={() => {
                        setQuestion(entry.question);
                        void ask(entry.question);
                        box.current?.focus();
                      }}
                    >
                      <span className={styles.promptText}>{entry.question}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className={styles.promptsFoot}>
              Or <a href="/search">browse everything students are searching</a>.
            </p>
          </section>
        )}

        {/* ---- The answer -------------------------------------------- */}
        {asked && (
          <section className={styles.thread} aria-live="polite" aria-busy={thinking}>
            <div className={styles.turn}>
              <span className={styles.who}>You</span>
              <p className={styles.yours}>{asked}</p>
            </div>

            <div className={styles.turn}>
              <span className={styles.who}>Fynliq</span>

              {thinking && (
                <div className={styles.answer}>
                  <span className="srOnly">Preparing your answer</span>
                  <Skeleton height="17px" />
                  <Skeleton height="17px" />
                  <Skeleton height="17px" width="84%" />
                  <Skeleton height="17px" width="52%" />
                </div>
              )}

              {error && (
                <div><p className={styles.error} role="alert">
                  <span aria-hidden="true">&#9888;</span> {error}
                </p><button type="button" className={styles.sourceCta} onClick={() => void ask(asked)}>Try again</button><p className={styles.sourceNote}>If your document read has expired, upload it again in My Aid. You can still switch to General information above.</p></div>
              )}

              {answer && !thinking && (
                <div className={styles.answer}>
                  {/*
                    The label that decides how the whole answer should be
                    read. Personal means it used their figures and names them;
                    general means it is the rule, and says what is missing.
                  */}
                  <p className={`${styles.basis} ${answer.basis === 'personal' ? styles.personal : ''}`}>
                    {answer.basis === 'personal'
                      ? 'Answered from your own documents'
                      : 'General explanation — not a personal determination'}
                  </p>

                  {answer.paragraphs.map((paragraph) => (
                    <p key={paragraph} className={styles.paragraph}>
                      {paragraph.split(/(\*\*[^*]+\*\*)/g).map((part, index) => part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : part)}
                    </p>
                  ))}

                  {answer.grounding.length > 0 && (
                    <details className={styles.references}><summary>Document references</summary><ul>{answer.grounding.map((source, i) => <li key={i}>{source}</li>)}</ul></details>
                  )}

                  {answer.missing && (
                    <p className={styles.missing}>
                      {answer.missing}{' '}
                    </p>
                  )}
                </div>
              )}
            </div>

            {related.length > 0 && !thinking && (
              <div className={styles.related}>
                <h2 className={styles.relatedTitle}>Related questions</h2>
                <ul className={styles.relatedList}>
                  {related.map((entry) => (
                    <li key={entry.id}>
                      <a className={styles.relatedLink} href={`/search/${entry.slug}`}>
                        {entry.question}
                        <span aria-hidden="true">&rarr;</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {/* ---- Back into the loop ------------------------------------ */}
        <section className={styles.loop} aria-labelledby="loop-title">
          <div className={styles.loopGlow} aria-hidden="true">
            <Aurora tone="dark" />
          </div>
          <h2 id="loop-title" className={styles.loopTitle}>
            Explore {QUESTIONS.length} common financial aid questions.
          </h2>
          <p className={styles.loopBody}>
            Browse explanations of grants, loans, bills and refunds.
          </p>
          <a className={styles.loopCta} href="/search">
            Search financial aid <span aria-hidden="true">&rarr;</span>
          </a>
        </section>
      </div>
    </AppShell>
  );
}
