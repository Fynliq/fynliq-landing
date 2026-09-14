import type { SearchAnalytics, SearchDemand, SearchEvent } from './analytics';
import { parseSearchDemand } from './contract';

/**
 * Real search demand, from the analytics backend.
 *
 * Two calls, and they are deliberately not symmetrical.
 *
 * `demand` is load-bearing: the whole page is drawn from it, so the response
 * is validated before anything downstream sees it and a failure is a failure.
 *
 * `record` is not: it reports one search so tomorrow's ranking is a little
 * more accurate. A student reading about their refund must never see an error
 * — or a delay — because a counter could not be incremented, so it is sent
 * with `keepalive` and every failure is swallowed.
 */
export function httpAnalytics(endpoint: string): SearchAnalytics {
  /** `POST /events` alongside `GET` on the endpoint itself. */
  const eventsUrl = `${endpoint.replace(/\/+$/, '')}/events`;

  return {
    connected: true,

    async demand(signal?: AbortSignal): Promise<SearchDemand> {
      const response = await fetch(endpoint, {
        method: 'GET',
        signal,
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`The search analytics answered ${response.status}.`);
      }

      const payload = parseSearchDemand(await response.json());

      return {
        provenance: payload.provenance,
        generatedAt: payload.generatedAt,
        questions: payload.questions,
        clustered: new Map(
          payload.questions.map((question) => [
            question.id,
            question.variants.map((variant) => variant.text),
          ]),
        ),
      };
    },

    record(event: SearchEvent) {
      // `keepalive` so the report survives the navigation that usually
      // follows it — a student who searches and immediately opens an answer
      // would otherwise have the request cancelled underneath them.
      void fetch(eventsUrl, {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      }).catch(() => {
        /* Counting is best-effort. Never surfaced, never retried. */
      });
    },
  };
}
