import { useCallback, useEffect, useState } from 'react';
import { Answer } from './pages/Answer';
import { AskFynliq } from './pages/AskFynliq';
import { BetaResults } from './pages/BetaResults';
import { BetaUpload } from './pages/BetaUpload';
import { Gradi } from './pages/Gradi';
import { Landing } from './pages/Landing';
import { Search } from './pages/Search';
import { Router, useRouter } from './router/router';
import { SearchProvider } from './search/SearchProvider';
import { questionBySlug } from './search/library';
import type { AidAnalysis } from './core';

export const ROUTES = {
  landing: '/',
  upload: '/beta',
  results: '/beta/results',
  search: '/search',
  ask: '/ask',
  gradi: '/gradi',
} as const;

/** `/search/<slug>` — one canonical question, answered in full. */
const ANSWER_PREFIX = `${ROUTES.search}/`;

const TITLES: Record<string, string> = {
  [ROUTES.landing]: 'Fynliq — beta',
  [ROUTES.upload]: 'Upload your aid summary — Fynliq',
  [ROUTES.results]: 'Your aid, explained — Fynliq',
  [ROUTES.search]: 'Search financial aid — Fynliq',
  [ROUTES.ask]: 'Ask Fynliq — answers from your own aid',
  [ROUTES.gradi]: 'Earn as a Gradi creator — Fynliq',
};

export function App() {
  return (
    <Router>
      <Routes />
    </Router>
  );
}

function Routes() {
  const { path, navigate } = useRouter();

  /**
   * The result lives here and nowhere else.
   *
   * Not in sessionStorage, not in a URL, not in a cache: it is somebody's
   * financial aid position, and the only copy of it belongs in the tab they
   * are looking at. The cost of that choice is that reloading the results URL
   * has nothing to show — which is handled below by sending them back to the
   * upload step rather than to an empty page.
   *
   * Ask Fynliq reads the same value. That is the whole of what makes an
   * answer there personal rather than general, and it is also why Ask is
   * honest about having nothing when somebody lands on it first.
   */
  const [analysis, setAnalysis] = useState<AidAnalysis | null>(null);

  const onAnalysed = useCallback(
    (result: AidAnalysis) => {
      setAnalysis(result);
      navigate(ROUTES.results);
    },
    [navigate],
  );

  const onRestart = useCallback(() => {
    setAnalysis(null);
    navigate(ROUTES.upload);
  }, [navigate]);

  const orphaned = path === ROUTES.results && analysis === null;

  // A slug nobody recognises is a dead link, a typo or a question that has
  // been retired. All three belong back on the search page, not on a 404.
  const answerSlug = path.startsWith(ANSWER_PREFIX) ? path.slice(ANSWER_PREFIX.length) : null;
  const question = answerSlug ? questionBySlug(answerSlug) : undefined;
  const unknownAnswer = answerSlug !== null && question === undefined;

  useEffect(() => {
    if (orphaned) navigate(ROUTES.upload, { replace: true });
  }, [orphaned, navigate]);

  useEffect(() => {
    if (unknownAnswer) navigate(ROUTES.search, { replace: true });
  }, [unknownAnswer, navigate]);

  useEffect(() => {
    document.title = question
      ? `${question.question} — Fynliq`
      : (TITLES[path] ?? TITLES[ROUTES.landing]);
  }, [path, question]);

  if (path === ROUTES.upload || orphaned) {
    return <BetaUpload onAnalysed={onAnalysed} />;
  }

  if (path === ROUTES.results && analysis) {
    return <BetaResults analysis={analysis} onRestart={onRestart} />;
  }

  /*
   * The three tabbed pages share one ranking.
   *
   * The provider is here rather than inside each page so the search figures
   * are fetched once and stay consistent across the tabs — and so a search
   * made on one page still counts on the next. It deliberately does not wrap
   * the landing page, which shows no search figures and should not pay for
   * the request.
   */
  if (path === ROUTES.search || question) {
    return (
      <SearchProvider>{question ? <Answer question={question} /> : <Search />}</SearchProvider>
    );
  }

  if (path === ROUTES.ask) {
    return (
      <SearchProvider>
        <AskFynliq analysis={analysis} />
      </SearchProvider>
    );
  }

  if (path === ROUTES.gradi) {
    return <Gradi />;
  }

  return <Landing />;
}
