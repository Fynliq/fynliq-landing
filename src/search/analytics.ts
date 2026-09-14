/**
 * The seam between the search page and whatever counts searches.
 *
 * The page depends on this interface and nothing else. Point
 * `VITE_FYNLIQ_SEARCH_URL` at an endpoint and the ranking runs on what
 * students are really searching; leave it unset and it runs on the sample
 * figures in `sampleAnalytics.ts`, which the page labels as sample figures on
 * screen rather than passing them off as live demand.
 *
 * Connecting the backend is one environment variable. No component changes.
 */

import type { QuestionDemand } from '../core';
import { httpAnalytics } from './httpAnalytics';
import { sampleAnalytics } from './sampleAnalytics';
import type { DemandProvenance } from './contract';

/** What the page needs in order to draw the ranking. */
export interface SearchDemand {
  provenance: DemandProvenance;
  generatedAt: string;
  questions: QuestionDemand[];
  /**
   * The phrasings the backend actually clustered, by question id.
   *
   * Used on top of the seed phrasings in `library.ts` when matching what
   * somebody types. The backend learns phrasings nobody thought to write down;
   * the library keeps working when the backend is unreachable. Neither is
   * authoritative over the other.
   */
  clustered: Map<string, string[]>;
}

/**
 * One thing a student did, reported back so the ranking can learn from it.
 *
 * `query` is the whole payload of interest: it is the raw phrasing, and
 * clustering raw phrasings into canonical questions is the backend's job.
 * Nothing about the student's own aid, documents or figures is ever attached
 * to one of these — the search page has no access to any of that, by design.
 */
export interface SearchEvent {
  /** Exactly what was typed, or the canonical question when it was clicked. */
  query: string;
  /** The canonical question it resolved to, or `null` when nothing matched. */
  questionId: string | null;
  /** Typed into the box, or opened from one of the ranked lists. */
  kind: 'search' | 'open';
  /** ISO-8601, set by the client. The backend should not trust it for ordering. */
  at: string;
}

export interface SearchAnalytics {
  /** False while running on sample figures, which the page states on screen. */
  readonly connected: boolean;
  demand(signal?: AbortSignal): Promise<SearchDemand>;
  /**
   * Fire and forget. A failed report must never interrupt a student who is
   * reading an answer, so this returns nothing and throws nothing.
   */
  record(event: SearchEvent): void;
}

/**
 * Picks the analytics source from the environment.
 *
 * Kept as a function rather than a module-level constant so a test — or a
 * future settings screen — can construct one against any endpoint.
 */
export function createAnalytics(
  endpoint = import.meta.env.VITE_FYNLIQ_SEARCH_URL,
): SearchAnalytics {
  return endpoint ? httpAnalytics(endpoint) : sampleAnalytics();
}

/**
 * Demand for questions the analytics source did not mention.
 *
 * The question library ships with the frontend build; the analytics are live.
 * The two will drift — a question added in a deploy has no history behind it,
 * and a backend that knows a question this build has never heard of sends a
 * row nobody can render. Both cases are normal, and neither is an error:
 * unknown ids are ignored, and unmentioned questions rank at zero rather than
 * disappearing from the page.
 */
export function zeroDemand(id: string): QuestionDemand {
  return {
    id,
    searches30d: 0,
    searches7d: 0,
    searchesPrev7d: 0,
    daily: [0, 0, 0, 0, 0, 0, 0],
    variants: [],
  };
}

/**
 * Lines the live demand up against the questions this build actually has.
 *
 * Returns one row per known question, in library order — the ranking decides
 * the order that gets displayed, and it needs the full set to do it.
 */
export function reconcile(demand: QuestionDemand[], knownIds: string[]): QuestionDemand[] {
  const byId = new Map(demand.map((question) => [question.id, question]));
  return knownIds.map((id) => byId.get(id) ?? zeroDemand(id));
}
