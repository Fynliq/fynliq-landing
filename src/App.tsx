import { useCallback, useEffect, useState } from 'react';
import { Answer } from './pages/Answer';
import { AskFynliq } from './pages/AskFynliq';
import { Auth } from './pages/Auth';
import { BetaResults } from './pages/BetaResults';
import { BetaUpload } from './pages/BetaUpload';
import { Gradi } from './pages/Gradi';
import { GradiStart } from './pages/GradiStart';
import { Landing } from './pages/Landing';
import { Search } from './pages/Search';
import { Router, useRouter } from './router/router';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { SearchProvider } from './search/SearchProvider';
import { questionBySlug } from './search/library';
import { analysisFromFacts, type AidAnalysis } from './core';
import { BetaAdmin } from './pages/BetaAdmin';
import { AccountProvider } from './accounts/AccountProvider';

export const ROUTES = {
  landing: '/',
  login: '/login',
  signup: '/signup',
  upload: '/beta',
  results: '/beta/results',
  search: '/search',
  ask: '/ask',
  gradi: '/gradi',
  gradiStart: '/gradi/start',
} as const;

/** `/search/<slug>` — one canonical question, answered in full. */
const ANSWER_PREFIX = `${ROUTES.search}/`;

const TITLES: Record<string, string> = {
  [ROUTES.landing]: 'Fynliq — beta',
  [ROUTES.login]: 'Log in — Fynliq',
  [ROUTES.signup]: 'Create your account — Fynliq',
  [ROUTES.upload]: 'Upload your aid summary — Fynliq',
  [ROUTES.results]: 'Your aid, explained — Fynliq',
  [ROUTES.search]: 'Search financial aid — Fynliq',
  [ROUTES.ask]: 'Ask Fynliq — answers from your own aid',
  [ROUTES.gradi]: 'Earn as a Gradi creator — Fynliq',
  [ROUTES.gradiStart]: 'Make your first $10 — Fynliq',
};

/**
 * The pages behind the account, and what to call each one on the way in.
 *
 * This list is the whole of the rule. Adding a page to the account, or taking
 * one back out to be public, is a line here and nothing else — which is the
 * point: a gate scattered across eight components is a gate with a hole in
 * it. The label is shown on the log-in screen, so somebody who was stopped
 * on the way to Ask Fynliq is told they are going back to Ask Fynliq.
 *
 * `/beta/results` is not listed because `/beta` already covers it, and
 * `/search/<slug>` because `/search` does. The landing page and the Gradi
 * creator page stay public: they are how somebody decides whether to sign up
 * at all, and a marketing page behind a login is a page nobody reads.
 */
const BEHIND_THE_ACCOUNT: readonly { root: string; label: string }[] = [
  { root: ROUTES.upload, label: 'uploading your aid summary' },
  { root: ROUTES.search, label: 'search' },
  { root: ROUTES.ask, label: 'Ask Fynliq' },
];

/**
 * Where somebody who is not logged in is sent.
 *
 * The client asked for the log-in page, and that is what this is. During a
 * beta where almost every arrival is a first-timer, `ROUTES.signup` may read
 * better — it is this one word, and the two screens are the same component.
 */
const GATE_LANDS_ON: string = ROUTES.login;

/** Where somebody lands once they have an account and no particular errand. */
const AFTER_AUTH: string = ROUTES.upload;

function behindTheAccount(path: string) {
  return (
    BEHIND_THE_ACCOUNT.find((page) => path === page.root || path.startsWith(`${page.root}/`)) ??
    null
  );
}

export function App() {
  return (
    <AccountProvider>
      <Router>
        <AuthProvider>
          <Routes />
        </AuthProvider>
      </Router>
    </AccountProvider>
  );
}

function Routes() {
  const { path, navigate } = useRouter();
  const { session, restoring } = useAuth();

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
  useEffect(() => {
    const clear = () => { setAnalysis(null); navigate('/'); };
    const load = (event: Event) => { setAnalysis(analysisFromFacts((event as CustomEvent<AidAnalysis>).detail)); navigate('/beta/results'); };
    window.addEventListener('fynliq:clear-private', clear);
    window.addEventListener('fynliq:load-document', load);
    return () => { window.removeEventListener('fynliq:clear-private', clear); window.removeEventListener('fynliq:load-document', load); };
  }, [navigate]);

  /**
   * Where they were heading when the gate stopped them.
   *
   * Held in React state rather than a `?next=` parameter, for two reasons: a
   * destination in the URL is a destination a stranger can set, and this
   * router deals in paths rather than query strings. Losing it on a reload is
   * the cost, and the fallback is the upload page either way.
   */
  const [intended, setIntended] = useState<string | null>(null);

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

  /**
   * Logging out empties the tab.
   *
   * Nothing else would: the analysis is in memory here, and a page that still
   * shows somebody's award after they pressed "log out" has not logged them
   * out. This also covers a session that simply expired.
   */
  useEffect(() => {
    if (session === null) setAnalysis(null);
  }, [session]);

  const orphaned = path === ROUTES.results && analysis === null;

  // A slug nobody recognises is a dead link, a typo or a question that has
  // been retired. All three belong back on the search page, not on a 404.
  const answerSlug = path.startsWith(ANSWER_PREFIX) ? path.slice(ANSWER_PREFIX.length) : null;
  const question = answerSlug ? questionBySlug(answerSlug) : undefined;
  const unknownAnswer = answerSlug !== null && question === undefined;

  const onAccount = path === ROUTES.login || path === ROUTES.signup;
  const gated = behindTheAccount(path);

  // Nothing is decided while the stored session is still being checked: a
  // reload of a page behind the account must not flash the log-in screen.
  const locked = gated !== null && !restoring && session === null;

  useEffect(() => {
    if (!locked) return;
    setIntended(path);
    // Replace, so the back button from the log-in page goes where they came
    // from rather than bouncing them straight back into the gate.
    navigate(GATE_LANDS_ON, { replace: true });
  }, [locked, path, navigate]);

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

  const onAuthenticated = useCallback(() => {
    const destination = intended ?? AFTER_AUTH;
    setIntended(null);
    navigate(destination, { replace: true });
  }, [intended, navigate]);

  /*
   * The account screens.
   *
   * Somebody who is already logged in has no business on them — they got here
   * from a stale tab or a bookmark — so they are moved along to wherever they
   * were going instead of being shown a form they do not need.
   */
  if (onAccount) {
    // Not even for a frame: showing a log-in form to somebody who is already
    // logged in, and snatching it away once the stored session resolves, is
    // how a reload comes to look like being signed out.
    if (restoring) return <Holding />;
    if (session) return <Resuming onResume={onAuthenticated} />;

    return (
      <Auth
        mode={path === ROUTES.signup ? 'signup' : 'login'}
        destination={intended ? (behindTheAccount(intended)?.label ?? undefined) : undefined}
        onAuthenticated={onAuthenticated}
      />
    );
  }

  // Locked, or still finding out. Either way there is nothing safe to draw
  // yet, and the redirect above is one effect away.
  if (gated && (locked || restoring)) return <Holding />;

  if ((path === ROUTES.upload && !analysis) || orphaned) {
    return <BetaUpload onAnalysed={onAnalysed} />;
  }

  if ((path === ROUTES.results || path === ROUTES.upload) && analysis) {
    if (analysis.summaryToken) return <BetaResults analysis={analysis} onRestart={onRestart} onConfirm={() => { setAnalysis({ ...analysis, reviewed: true }); }} />;
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
        <SearchProvider>{question ? <Answer key={question.id} question={question} analysis={analysis} /> : <Search analysis={analysis} />}</SearchProvider>
    );
  }

  if (path === ROUTES.ask) {
    return (
      <SearchProvider>
        <AskFynliq analysis={analysis} />
      </SearchProvider>
    );
  }

  /*
   * Before `/gradi`, because the argument page owns the shorter path and a
   * `startsWith` test on it would otherwise swallow the walkthrough.
   */
  if (path === ROUTES.gradiStart) {
    return <GradiStart />;
  }

  if (path === ROUTES.gradi) {
    return <Gradi />;
  }

  if (path === '/admin') return <BetaAdmin />;
  return <Landing />;
}

/**
 * The half-second before a route resolves.
 *
 * Blank rather than a spinner: on the local store this is one frame, and a
 * spinner that flashes for one frame is worse than nothing. The live region
 * is there so a screen reader is told the page is working rather than left
 * on silence.
 */
function Holding() {
  return (
    <div role="status" aria-live="polite" className="srOnly">
      Checking your account…
    </div>
  );
}

/** Already logged in, standing on the log-in page. Move along. */
function Resuming({ onResume }: { onResume: () => void }) {
  useEffect(() => {
    onResume();
  }, [onResume]);

  return <Holding />;
}
