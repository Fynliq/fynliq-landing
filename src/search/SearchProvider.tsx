import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  addSearch,
  rankQuestions,
  selectTrending,
  type QuestionDemand,
  type RankedQuestion,
} from '../core';
import { createAnalytics, reconcile, type SearchEvent } from './analytics';
import type { DemandProvenance } from './contract';
import { QUESTIONS } from './library';

/**
 * Search demand, loaded once and shared by every page that shows a number.
 *
 * It lives above the routes rather than inside the search page because the
 * answer page prints the same social-proof figure, and two pages fetching the
 * same ranking independently is how they end up disagreeing about it in front
 * of the student.
 */

type Status = 'loading' | 'ready' | 'failed';

interface SearchValue {
  status: Status;
  /** False while running on sample figures. The page says so on screen. */
  connected: boolean;
  provenance: DemandProvenance | null;
  /** Every known question, ranked by 30-day volume. */
  ranked: RankedQuestion[];
  /** What is rising fastest — a different list, deliberately. */
  trending: RankedQuestion[];
  byId: Map<string, RankedQuestion>;
  /** Phrasings the backend clustered, for matching what is typed now. */
  clustered: Map<string, string[]>;
  /** How many searches this session has contributed. Drives the live note. */
  sessionSearches: number;
  /** Counts a search, locally and at the backend. */
  record: (event: Omit<SearchEvent, 'at'>) => void;
}

const SearchContext = createContext<SearchValue | null>(null);

const KNOWN_IDS = QUESTIONS.map((question) => question.id);

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const analytics = useMemo(() => createAnalytics(), []);

  const [status, setStatus] = useState<Status>('loading');
  const [provenance, setProvenance] = useState<DemandProvenance | null>(null);
  const [questions, setQuestions] = useState<QuestionDemand[]>([]);
  const [clustered, setClustered] = useState<Map<string, string[]>>(new Map());
  const [sessionSearches, setSessionSearches] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    analytics
      .demand(controller.signal)
      .then((demand) => {
        if (controller.signal.aborted) return;
        setQuestions(reconcile(demand.questions, KNOWN_IDS));
        setClustered(demand.clustered);
        setProvenance(demand.provenance);
        setStatus('ready');
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        /*
         * A ranking that will not load is not a broken page. Every question
         * and every answer ships in the build, so the page falls back to the
         * library with no figures attached rather than to an error — and the
         * social-proof bubbles simply do not appear.
         */
        setQuestions(reconcile([], KNOWN_IDS));
        setStatus('failed');
      });

    return () => controller.abort();
  }, [analytics]);

  const record = useCallback(
    (event: Omit<SearchEvent, 'at'>) => {
      analytics.record({ ...event, at: new Date().toISOString() });
      if (!event.questionId) return;

      // Counted here and now, not at the next refresh. `addSearch` is the
      // tested function that keeps the day, week and month in step.
      setQuestions((current) => addSearch(current, event.questionId as string));
      setSessionSearches((current) => current + 1);
    },
    [analytics],
  );

  const value = useMemo<SearchValue>(() => {
    const ranked = rankQuestions(questions);
    return {
      status,
      connected: analytics.connected,
      provenance,
      ranked,
      trending: selectTrending(questions),
      byId: new Map(ranked.map((question) => [question.id, question])),
      clustered,
      sessionSearches,
      record,
    };
  }, [analytics.connected, clustered, provenance, questions, record, sessionSearches, status]);

  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

export function useSearchDemand(): SearchValue {
  const value = useContext(SearchContext);
  if (!value) throw new Error('useSearchDemand must be used inside <SearchProvider>');
  return value;
}
