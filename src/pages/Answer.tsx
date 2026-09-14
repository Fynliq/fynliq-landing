import { AppShell } from '../components/nav/AppShell/AppShell';
import { Aurora } from '../components/fx';
import { formatSearches, searchProof, formatMovement } from '../core';
import { CATEGORY_LABEL, questionById, type Question } from '../search/library';
import { useSearchDemand } from '../search/SearchProvider';
import styles from './Answer.module.css';

interface AnswerProps {
  question: Question;
}

/**
 * One question, answered in full.
 *
 * Conclusion first, then the reasoning, then what to do — the same order as
 * the beta results page, because it is the order somebody worried about money
 * can actually read in.
 *
 * Two things here are not decoration. The phrasings panel shows exactly which
 * searches were folded into this question and how many of each, which is the
 * grouping proving itself rather than asking to be trusted. And the page ends
 * on what only their own school can settle, because every answer above it is
 * a general rule, and a general rule stated without that line reads like a
 * promise about somebody's particular money.
 */
export function Answer({ question }: AnswerProps) {
  const { byId, record } = useSearchDemand();
  const demand = byId.get(question.id);

  const related = question.related
    .map((id) => questionById(id))
    .filter((entry): entry is Question => entry !== undefined);

  return (
    <AppShell tab="search">
      <article className={styles.article}>
        <a className={styles.back} href="/search">
          <span aria-hidden="true">&larr;</span> All questions
        </a>

        <div className={styles.meta}>
          <span className={styles.category}>{CATEGORY_LABEL[question.category]}</span>
          {demand && demand.searches30d > 0 && (
            <>
              <span className={styles.bubble}>{searchProof(demand.searches30d)}</span>
              <span className={styles.rankNote}>
                #{demand.rank} most searched
                {/* Movement is worth a word only when there was some. */}
                {demand.movement !== 0 && <> &middot; {formatMovement(demand.movement)}</>}
              </span>
            </>
          )}
        </div>

        <h1 className={styles.title}>{question.question}</h1>

        {/* The answer, before the explanation of it. */}
        <p className={styles.lead}>{question.answer}</p>

        <div className={styles.body}>
          {question.body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>

        {question.steps && (
          <section className={styles.steps} aria-labelledby={`${question.id}-steps`}>
            <h2 id={`${question.id}-steps`} className={styles.stepsTitle}>
              What to do, in order
            </h2>
            <ol className={styles.stepList}>
              {question.steps.map((step, index) => (
                <li key={step} className={styles.step}>
                  <span className={styles.stepNumber} aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className={styles.stepBody}>{step}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        <aside className={styles.check} aria-label="What only your school can tell you">
          <span className={styles.checkGlyph} aria-hidden="true">
            &#9679;
          </span>
          <div>
            <h2 className={styles.checkTitle}>What only your school can tell you</h2>
            <p className={styles.checkBody}>{question.checkYourself}</p>
          </div>
        </aside>

        {/* ---- The grouping, shown rather than claimed ---------------- */}
        {demand && demand.variants.length > 0 && (
          <section className={styles.grouped} aria-labelledby={`${question.id}-grouped`}>
            <h2 id={`${question.id}-grouped`} className={styles.groupedTitle}>
              Other ways students ask this
            </h2>
            <p className={styles.groupedLede}>
              These searches all mean the same thing, so Fynliq counts them toward one question
              rather than splitting the same worry across five half-answers.
            </p>
            <ul className={styles.phrasings}>
              {demand.variants.map((variant) => (
                <li key={variant.text} className={styles.phrasing}>
                  <span className={styles.phrasingText}>&ldquo;{variant.text}&rdquo;</span>
                  <span className={styles.phrasingCount}>
                    {formatSearches(variant.searches30d)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ---- Ask Fynliq -------------------------------------------- */}
        <section className={styles.ask} aria-labelledby={`${question.id}-ask`}>
          <div className={styles.askGlow} aria-hidden="true">
            <Aurora tone="dark" />
          </div>
          <span className={styles.askEyebrow}>Ask Fynliq</span>
          <h2 id={`${question.id}-ask`} className={styles.askTitle}>
            Now ask it about your aid.
          </h2>
          <p className={styles.askBody}>
            The answer above is the rule. Upload your aid summary and Fynliq answers the same
            question with your own bill, your own gift aid, and the figures your document actually
            states &mdash; leaving blank anything it could not read.
          </p>
          <div className={styles.askActions}>
            <a
              className={styles.askPrimary}
              href={`/ask?q=${encodeURIComponent(question.question)}`}
            >
              Ask this about my aid <span aria-hidden="true">&rarr;</span>
            </a>
            <a className={styles.askSecondary} href="/beta">
              Upload my aid summary
            </a>
          </div>
        </section>

        {/* ---- Related ------------------------------------------------ */}
        {related.length > 0 && (
          <section className={styles.related} aria-labelledby={`${question.id}-related`}>
            <h2 id={`${question.id}-related`} className={styles.relatedTitle}>
              Students who asked this also asked
            </h2>
            <ul className={styles.relatedList}>
              {related.map((entry) => {
                const other = byId.get(entry.id);
                return (
                  <li key={entry.id}>
                    <a
                      className={styles.relatedCard}
                      href={`/search/${entry.slug}`}
                      onClick={() =>
                        record({ query: entry.question, questionId: entry.id, kind: 'open' })
                      }
                    >
                      <span className={styles.relatedQuestion}>{entry.question}</span>
                      <span className={styles.relatedAnswer}>{entry.answer}</span>
                      {other && other.searches30d > 0 && (
                        <span className={styles.bubble}>{searchProof(other.searches30d)}</span>
                      )}
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </article>
    </AppShell>
  );
}
