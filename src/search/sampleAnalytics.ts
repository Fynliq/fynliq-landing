/**
 * Sample search demand, for running the page before the analytics exist.
 *
 * The client asked for mock popularity numbers, structured so real ones can
 * replace them. These are that — and they are labelled as sample figures on
 * screen, in a line under the ranking, for the same reason the beta results
 * page says when it is showing the demo student. A ranking that presents
 * invented demand as if it were real is a small lie that gets repeated to
 * every student who opens the page.
 *
 * The shape of the data is chosen to exercise the ranking rather than to
 * flatter it: something big and flat at the top, something mid-table rising
 * hard, something falling, and something below the trend floor that must not
 * be promoted however steep its curve.
 *
 * Every rule the real backend has to obey is obeyed here too — the seven
 * daily counts add up to the weekly total, two weeks never exceed thirty
 * days, and grouped phrasings never exceed the group. The same validator runs
 * over both.
 */

import type { QuestionDemand, QueryVariant } from '../core';
import type { SearchAnalytics, SearchDemand, SearchEvent } from './analytics';
import { QUESTIONS } from './library';

/** 30-day, 7-day and previous-7-day totals per question. Sample figures. */
const SAMPLE: Record<string, [number, number, number]> = {
  // Settled demand. The biggest question students have, all year round.
  'refund-arrival': [3184, 1042, 812],
  'bill-gap': [2190, 560, 544],
  'loan-accept-amount': [1876, 470, 438],
  // September: verification holds aid up exactly when the first bill lands.
  verification: [1544, 612, 268],
  'why-less-aid': [1402, 330, 356],
  'sai-meaning': [1188, 296, 301],
  // The drop deadline is the reason this one moves.
  'pell-drop-class': [964, 388, 142],
  'sub-vs-unsub': [902, 214, 232],
  'refund-spend': [842, 236, 190],
  sap: [788, 176, 210],
  'work-study': [651, 198, 124],
  // Quieter this week than last, which is enough to have slipped a place.
  dependency: [533, 100, 180],
  'outside-scholarship': [417, 96, 104],
  appeal: [392, 148, 61],
  // Rising fast in relative terms, and still too small to be trending.
  'summer-aid': [148, 33, 12],
};

/** A week's worth of weights. Midweek is busier; the weekend is not. */
const WEEK = [0.13, 0.16, 0.16, 0.15, 0.15, 0.12, 0.13];

/**
 * Splits a weekly total across seven days so that it adds back up exactly.
 *
 * The remainder is handed to the busiest days rather than dropped, because
 * the contract requires these to total the weekly figure and "close enough"
 * is how a sparkline ends up disagreeing with the badge printed beside it.
 */
function spread(total: number): number[] {
  const raw = WEEK.map((weight) => Math.floor(total * weight));
  let remainder = total - raw.reduce((sum, day) => sum + day, 0);

  const busiest = WEEK.map((weight, index) => ({ weight, index }))
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
    .map((entry) => entry.index);

  for (let i = 0; remainder > 0; i += 1, remainder -= 1) {
    raw[busiest[i % busiest.length]] += 1;
  }
  return raw;
}

/**
 * The share of a question's volume each seed phrasing accounts for.
 *
 * Decaying, and deliberately summing to well under 1 — most people do type
 * the question more or less the way it is written, and a grouping that
 * claimed otherwise would be making a stronger claim than the data supports.
 */
const VARIANT_SHARE = [0.21, 0.13, 0.09, 0.06, 0.04, 0.03];

function variantsFor(id: string, searches30d: number): QueryVariant[] {
  const question = QUESTIONS.find((entry) => entry.id === id);
  if (!question) return [];

  return question.variants
    .slice(0, VARIANT_SHARE.length)
    .map((text, index) => ({
      text,
      searches30d: Math.round(searches30d * VARIANT_SHARE[index]),
    }))
    .filter((variant) => variant.searches30d > 0);
}

function build(): QuestionDemand[] {
  return QUESTIONS.map((question) => {
    const [searches30d, searches7d, searchesPrev7d] = SAMPLE[question.id] ?? [0, 0, 0];
    return {
      id: question.id,
      searches30d,
      searches7d,
      searchesPrev7d,
      daily: spread(searches7d),
      variants: variantsFor(question.id, searches30d),
    };
  });
}

/** How long the sample source pretends to take, so loading states are real. */
const LATENCY_MS = 260;

/**
 * Sample analytics that count the searches made in this session.
 *
 * The counting is the point. The client's brief asks for a page that feels
 * alive and reorders itself as students search — searching here really does
 * move a question up, using the same code path the real backend will drive.
 * It is a demonstration of the mechanism rather than a simulation of traffic:
 * one search is worth one search, and nothing is inflated to make the page
 * look busier than it is.
 */
export function sampleAnalytics(): SearchAnalytics {
  const questions = build();
  const byId = new Map(questions.map((question) => [question.id, question]));
  const generatedAt = new Date().toISOString();

  return {
    connected: false,

    async demand(signal?: AbortSignal): Promise<SearchDemand> {
      await new Promise<void>((resolve) => setTimeout(resolve, LATENCY_MS));
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      return {
        provenance: 'sample',
        generatedAt,
        questions: questions.map((question) => ({ ...question, daily: [...question.daily] })),
        // The sample source has clustered nothing: every phrasing it knows is
        // a seed phrasing the library already carries.
        clustered: new Map(),
      };
    },

    record(event: SearchEvent) {
      if (event.questionId === null) return;
      const question = byId.get(event.questionId);
      if (!question) return;

      question.searches30d += 1;
      question.searches7d += 1;
      question.daily[question.daily.length - 1] += 1;
    },
  };
}
