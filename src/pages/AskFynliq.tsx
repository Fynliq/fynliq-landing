import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../components/nav/AppShell/AppShell';
import { Skeleton } from '../components/ui';
import { Aurora } from '../components/fx';
import { AskError, createAsker, type AskAnswer } from '../ask/asker';
import { questionById, QUESTIONS, type Question } from '../search/library';
import { useSearchDemand } from '../search/SearchProvider';
import { searchProof, type AidAnalysis } from '../core';
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
  const { ranked, byId, record } = useSearchDemand();

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
      if (trimmed.length === 0 || thinking) return;

      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;

      setAsked(trimmed);
      setAnswer(null);
      setError(null);
      setThinking(true);

      // A question put here is demand like any other, and counts toward the
      // same ranking the search page draws.
      record({ query: trimmed, questionId: null, kind: 'search' });

      try {
        const result = await asker.ask(trimmed, analysis, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setAnswer(result);
      } catch (thrown) {
        if (thrown instanceof AskError && thrown.kind === 'cancelled') return;
        setError(
          thrown instanceof AskError
            ? thrown.message
            : 'Something went wrong answering that. Try again in a moment.',
        );
      } finally {
        if (!controller.signal.aborted) setThinking(false);
        abort.current = null;
      }
    },
    [analysis, asker, record, thinking],
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

    setQuestion(incoming);
    void ask(incoming);
    window.history.replaceState({}, '', window.location.pathname);
    // Deliberately once: this is a handoff, not a subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => abort.current?.abort(), []);

  const related = (answer?.relatedIds ?? [])
    .map((id) => questionById(id))
    .filter((entry): entry is Question => entry !== undefined);

  return (
    <AppShell tab="ask">
      <div className={styles.page}>
        <header className={styles.head}>
          <span className={styles.eyebrow}>Ask Fynliq</span>
          <h1 className={styles.title}>Ask about your own money.</h1>
          <p className={styles.lede}>
            Put it in your own words. Fynliq answers from the aid documents you have added, names
            the lines it read them from, and tells you when your document does not contain what the
            answer needs rather than filling the gap.
          </p>
        </header>

        {/* ---- What it is answering from ---------------------------- */}
        <div className={`${styles.source} ${analysis ? styles.sourceOn : ''}`}>
          <span className={styles.sourceGlyph} aria-hidden="true">
            {analysis ? '✓' : '○'}
          </span>
          <div className={styles.sourceBody}>
            <p className={styles.sourceTitle}>
              {analysis
                ? analysis.summaryToken && !analysis.reviewed ? 'Review your extracted fields first' : `Answering from your ${analysis.document.fileNames.length === 1 ? 'document' : 'documents'}`
                : 'No aid documents added yet'}
            </p>
            <p className={styles.sourceNote}>
              {analysis
                ? `Read from ${analysis.document.fileNames.join(', ')}. Anything Fynliq could not read is left out of the answer rather than estimated.`
                : 'Answers below will be the general rule, the same for everyone. Add your aid summary once and the same questions get answered with your own figures.'}
            </p>
          </div>
          {analysis?.summaryToken && !analysis.reviewed && <a className={styles.sourceCta} href="/beta/results">Review fields →</a>}
          {!analysis && (
            <a className={styles.sourceCta} href="/beta">
              Upload <span aria-hidden="true">&rarr;</span>
            </a>
          )}
        </div>

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
              if (event.key === 'Enter' && !event.shiftKey) {
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
              {thinking ? 'Reading…' : 'Ask Fynliq'}
              <span aria-hidden="true">&rarr;</span>
            </button>
          </div>
        </form>

        {/* ---- Starting points --------------------------------------- */}
        {!asked && (
          <section className={styles.prompts} aria-labelledby="prompts-title">
            <h2 id="prompts-title" className={styles.promptsTitle}>
              What students are asking most
            </h2>
            <ul className={styles.promptList}>
              {prompts.map((entry) => {
                const demand = byId.get(entry.id);
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
                      {demand && demand.searches30d > 0 && (
                        <span className={styles.bubble}>{searchProof(demand.searches30d)}</span>
                      )}
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
                  <span className="srOnly">Reading your aid</span>
                  <Skeleton height="17px" />
                  <Skeleton height="17px" />
                  <Skeleton height="17px" width="84%" />
                  <Skeleton height="17px" width="52%" />
                </div>
              )}

              {error && (
                <p className={styles.error}>
                  <span aria-hidden="true">&#9888;</span> {error}
                </p>
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
                      : 'General rule — not from your documents'}
                  </p>

                  {answer.paragraphs.map((paragraph) => (
                    <p key={paragraph} className={styles.paragraph}>
                      {paragraph}
                    </p>
                  ))}

                  {answer.grounding.length > 0 && (
                    <p className={styles.grounding}>
                      <span aria-hidden="true">&#9679;</span> Read from{' '}
                      {answer.grounding.join(' · ')}
                    </p>
                  )}

                  {answer.missing && (
                    <p className={styles.missing}>
                      To answer this with your own figures, Fynliq needs {answer.missing}.{' '}
                      <a href="/beta">Add it &rarr;</a>
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
            {QUESTIONS.length} questions, ranked by how many students are searching them.
          </h2>
          <p className={styles.loopBody}>
            Before you ask, it is worth seeing whether it is already answered &mdash; and what else
            students in your position are worrying about this week.
          </p>
          <a className={styles.loopCta} href="/search">
            Search financial aid <span aria-hidden="true">&rarr;</span>
          </a>
        </section>
      </div>
    </AppShell>
  );
}
