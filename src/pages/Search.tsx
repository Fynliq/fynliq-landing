import { useMemo, useState } from 'react';
import { AppShell } from '../components/nav/AppShell/AppShell';
import { RankRow } from '../components/search/RankRow/RankRow';
import { SearchField } from '../components/search/SearchField/SearchField';
import { TrendCard } from '../components/search/TrendCard/TrendCard';
import { Skeleton } from '../components/ui';
import { Aurora, Grain } from '../components/fx';
import { formatSearches, searchProof, totalSearches } from '../core';
import { CATEGORIES, QUESTIONS, questionById, type CategoryId } from '../search/library';
import { searchQuestions, suggest, type Match } from '../search/match';
import { useSearchDemand } from '../search/SearchProvider';
import { useRouter } from '../router/router';
import styles from './Search.module.css';
import type { AidAnalysis } from '../core';
import { PersonalizedAnswer } from '../components/PersonalizedAnswer';

/**
 * Search financial aid.
 *
 * The page answers one question before the student asks anything: what is
 * everybody else worried about? Two lists do that, and they are deliberately
 * different lists. **Trending this week** is what moved. **Most searched** is
 * what is settled. A page that showed the same five questions under both
 * headings would be a page with one list and two headings.
 *
 * Nothing on it is ordered editorially. Every position, every movement arrow
 * and every bar length is computed in `core/trending.ts` from counts that
 * arrive through the analytics seam, which is why the ranking can change
 * daily without anyone touching this file — and why searching here moves a
 * question up while you watch.
 */
export function Search({ analysis }: { analysis: AidAnalysis | null }) {
  const { navigate } = useRouter();
  const { status, ranked, trending, byId, clustered, provenance, sessionSearches, record } =
    useSearchDemand();

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryId | null>(null);

  const searching = query.trim().length > 0;

  const suggestions = useMemo(
    () => (searching ? suggest(query, QUESTIONS, { clustered, limit: 6 }) : []),
    [clustered, query, searching],
  );

  const results = useMemo(
    () =>
      searching
        ? searchQuestions(query, QUESTIONS, { clustered }).filter(
            (match) => category === null || match.question.category === category,
          )
        : [],
    [category, clustered, query, searching],
  );

  /** The ranked browse view, filtered to the chosen category. */
  const browse = useMemo(() => {
    if (category === null) return ranked;
    return ranked.filter((demand) => questionById(demand.id)?.category === category);
  }, [category, ranked]);

  // The bar on every row is drawn against the most-searched question overall,
  // not against the top of the current filter — so filtering to a quiet
  // category shows a quiet category rather than redrawing it as a busy one.
  const top = ranked[0]?.searches30d ?? 0;
  const total = useMemo(() => totalSearches(ranked), [ranked]);

  /** Opening a question counts as a search for it, here and at the backend. */
  const open = (questionId: string, kind: 'search' | 'open', text: string) => () =>
    record({ query: text, questionId, kind });

  const pick = (match: Match) => {
    record({ query, questionId: match.question.id, kind: 'search' });
    setQuery('');
    // Chosen from the keyboard or the list rather than through an anchor, so
    // this is the one navigation the delegated click listener never sees.
    navigate(`/search/${match.question.slug}`);
  };

  const submit = () => {
    const [best] = searchQuestions(query, QUESTIONS, { clustered });
    // A query that matched nothing is still worth reporting: an unanswered
    // question students keep typing is the most useful thing this page can
    // tell whoever writes the next answer.
    record({ query, questionId: best?.question.id ?? null, kind: 'search' });
  };

  const banner = (
    <section className={styles.hero}>
      <div className={styles.glow} aria-hidden="true">
        <Aurora tone="dark" />
      </div>
      <Grain />

      <div className={styles.heroInner}>
        <span className={styles.eyebrow}>Search financial aid</span>
        <h1 className={styles.title}>
          Someone has already asked{' '}
          <br />
          the question you are about to.
        </h1>
        <p className={styles.lede}>
          Every question below is one students are searching for right now, ranked by how many of
          them. Ask it however you would say it out loud &mdash; Fynliq groups the phrasings that
          mean the same thing.
        </p>

        <div className={styles.field}>
          <SearchField
            value={query}
            onChange={setQuery}
            suggestions={suggestions}
            onPick={pick}
            onSubmit={submit}
          />
        </div>

        <p className={styles.stats}>
          <span className={styles.stat}>{QUESTIONS.length} questions</span>
          {total > 0 && (
            <span className={styles.stat}>{formatSearches(total)} searches in 30 days</span>
          )}
          <span className={styles.stat}>
            {sessionSearches === 0
              ? 'The ranking moves as students search'
              : `${sessionSearches} ${sessionSearches === 1 ? 'search' : 'searches'} counted from you`}
          </span>
        </p>
      </div>
    </section>
  );

  return (
    <AppShell tab="search" banner={banner}>
      {query.trim() && <PersonalizedAnswer key={query.trim()} analysis={analysis} question={query.trim()} />}
      {/* ---- Categories --------------------------------------------- */}
      <nav className={styles.rail} aria-label="Filter by category">
        <ul className={styles.chips}>
          <li>
            <button
              type="button"
              className={`${styles.chip} ${category === null ? styles.chipOn : ''}`}
              aria-pressed={category === null}
              onClick={() => setCategory(null)}
            >
              Everything
            </button>
          </li>
          {CATEGORIES.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className={`${styles.chip} ${category === entry.id ? styles.chipOn : ''}`}
                aria-pressed={category === entry.id}
                onClick={() => setCategory(category === entry.id ? null : entry.id)}
              >
                {entry.label}
              </button>
            </li>
          ))}
        </ul>
        {category !== null && (
          <p className={styles.railNote}>
            {CATEGORIES.find((entry) => entry.id === category)?.blurb}
          </p>
        )}
      </nav>

      {searching ? (
        /* ---- Results ------------------------------------------------ */
        <section className={styles.block} aria-labelledby="results-title">
          <header className={styles.blockHead}>
            <h2 id="results-title" className={styles.blockTitle}>
              {results.length === 0
                ? 'Nothing matches that yet'
                : `${results.length} ${results.length === 1 ? 'question' : 'questions'} match`}
            </h2>
            <p className={styles.blockLede}>
              {results.length === 0
                ? 'Fynliq only answers what it can answer straight. Try different words, or put it to Ask Fynliq, which can read your own aid documents.'
                : 'Ranked by how closely each one answers what you typed.'}
            </p>
          </header>

          <ul className={styles.results}>
            {results.map((match) => {
              const demand = byId.get(match.question.id);
              return (
                <li key={match.question.id}>
                  <a
                    className={styles.result}
                    href={`/search/${match.question.slug}`}
                    onClick={open(match.question.id, 'search', query)}
                  >
                    <span className={styles.resultQuestion}>{match.question.question}</span>
                    {match.matchedVariant && (
                      <span className={styles.resultVia}>
                        You searched &ldquo;{match.matchedVariant}&rdquo; &mdash; it is answered
                        here
                      </span>
                    )}
                    <span className={styles.resultAnswer}>{match.question.answer}</span>
                    {demand && demand.searches30d > 0 && (
                      <span className={styles.bubble}>{searchProof(demand.searches30d)}</span>
                    )}
                  </a>
                </li>
              );
            })}
          </ul>

          {results.length === 0 && (
            <a className={styles.askCta} href="/ask">
              Ask Fynliq instead <span aria-hidden="true">&rarr;</span>
            </a>
          )}
        </section>
      ) : (
        <>
          {/* ---- Trending ------------------------------------------- */}
          {trending.length > 0 && (
            <section className={styles.block} aria-labelledby="trending-title">
              <header className={styles.blockHead}>
                <h2 id="trending-title" className={styles.blockTitle}>
                  Trending this week
                </h2>
                <p className={styles.blockLede}>
                  Not the biggest questions &mdash; the ones rising fastest against last week.
                  Usually something on a calendar just moved.
                </p>
              </header>

              <div className={styles.trending}>
                {trending.map((demand) => {
                  const question = questionById(demand.id);
                  if (!question) return null;
                  return (
                    <TrendCard
                      key={demand.id}
                      question={question}
                      demand={demand}
                      onOpen={open(demand.id, 'open', question.question)}
                    />
                  );
                })}
              </div>
            </section>
          )}

          {/* ---- Most searched -------------------------------------- */}
          <section className={styles.block} aria-labelledby="ranked-title">
            <header className={styles.blockHead}>
              <h2 id="ranked-title" className={styles.blockTitle}>
                Most searched
              </h2>
              <p className={styles.blockLede}>
                Ranked by searches over the last 30 days, with every phrasing of the same question
                counted together. Nothing here is positioned by hand.
              </p>
            </header>

            {status === 'loading' ? (
              <ul className={styles.ranked}>
                {Array.from({ length: 6 }, (_, i) => (
                  <li key={i} className={styles.skeletonRow}>
                    <Skeleton height="21px" width="28px" />
                    <div className={styles.skeletonBody}>
                      <Skeleton height="17px" width="72%" />
                      <Skeleton height="4px" radius="var(--r-pill)" />
                      <Skeleton height="13px" width="46%" radius="var(--r-pill)" />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <ul className={styles.ranked}>
                {browse.map((demand) => {
                  const question = questionById(demand.id);
                  if (!question) return null;
                  return (
                    <RankRow
                      key={demand.id}
                      question={question}
                      demand={demand}
                      top={top}
                      onOpen={open(demand.id, 'open', question.question)}
                    />
                  );
                })}
              </ul>
            )}

            {browse.length === 0 && status === 'ready' && (
              <p className={styles.empty}>No questions in this category yet.</p>
            )}

            {/*
              Where the numbers came from, stated on the page rather than in a
              commit message. The same discipline as the demo banner on the
              results page: sample demand must never read as real demand.
            */}
            <p className={styles.provenance}>
              {status === 'failed'
                ? 'Search figures could not be loaded, so the ranking is unavailable. Every question and answer above is still here.'
                : provenance === 'sample'
                  ? 'Search volumes on this page are sample figures. They are replaced by real student searches as soon as the analytics endpoint is connected — no other change is needed.'
                  : 'Search volumes are counted over the last 30 days across all Fynliq students.'}
            </p>
          </section>
        </>
      )}

      {/* ---- Ask Fynliq --------------------------------------------- */}
      <section className={styles.ask} aria-labelledby="ask-title">
        <div className={styles.askGlow} aria-hidden="true">
          <Aurora tone="dark" />
        </div>

        <span className={styles.askEyebrow}>Ask Fynliq</span>
        <h2 id="ask-title" className={styles.askTitle}>
          None of these are about your money.
        </h2>
        <p className={styles.askBody}>
          Every answer on this page is the general rule, because it has to be the same answer for
          everyone. Add your own aid summary and the same questions get answered with your bill,
          your gift aid and the figure you should actually stop at.
        </p>
        <div className={styles.askActions}>
          <a className={styles.askPrimary} href="/ask">
            Ask about your own aid <span aria-hidden="true">&rarr;</span>
          </a>
          <a className={styles.askSecondary} href="/beta">
            Upload your aid summary
          </a>
        </div>
      </section>
    </AppShell>
  );
}
