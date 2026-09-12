import { useCallback, useEffect, useState } from 'react';
import { BetaResults } from './pages/BetaResults';
import { BetaUpload } from './pages/BetaUpload';
import { Landing } from './pages/Landing';
import { Router, useRouter } from './router/router';
import type { AidAnalysis } from './core';

export const ROUTES = {
  landing: '/',
  upload: '/beta',
  results: '/beta/results',
} as const;

const TITLES: Record<string, string> = {
  [ROUTES.landing]: 'Fynliq — beta',
  [ROUTES.upload]: 'Upload your aid summary — Fynliq',
  [ROUTES.results]: 'Your aid, explained — Fynliq',
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

  useEffect(() => {
    if (orphaned) navigate(ROUTES.upload, { replace: true });
  }, [orphaned, navigate]);

  useEffect(() => {
    document.title = TITLES[path] ?? TITLES[ROUTES.landing];
  }, [path]);

  if (path === ROUTES.upload || orphaned) {
    return <BetaUpload onAnalysed={onAnalysed} />;
  }

  if (path === ROUTES.results && analysis) {
    return <BetaResults analysis={analysis} onRestart={onRestart} />;
  }

  return <Landing />;
}
