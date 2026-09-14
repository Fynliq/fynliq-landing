/**
 * The wire format the search analytics backend must return, checked at the
 * boundary.
 *
 * Same reasoning as `beta/contract.ts`: the ranking downstream of this is pure
 * arithmetic, and pure arithmetic is only as honest as what it is handed. A
 * backend that sends a string where a count belongs, or seven daily figures
 * that do not add up to the weekly total it also sent, fails here with the
 * exact path — not four sections later as a sparkline that contradicts the
 * badge printed beside it.
 *
 * `docs/SEARCH_ANALYTICS_API.md` documents this shape with a worked example.
 */

import type { QuestionDemand, QueryVariant } from '../core';

export class SearchFormatError extends Error {
  constructor(
    readonly path: string,
    detail: string,
  ) {
    super(`The search analytics returned something unexpected at ${path}: ${detail}`);
    this.name = 'SearchFormatError';
  }
}

type Json = Record<string, unknown>;

function object(value: unknown, path: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SearchFormatError(path, 'expected an object');
  }
  return value as Json;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new SearchFormatError(path, 'expected an array');
  return value;
}

function str(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new SearchFormatError(path, 'expected a string');
  return value;
}

/** Search counts are whole events. A fractional one means something upstream averaged. */
function count(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SearchFormatError(path, 'expected a finite number');
  }
  if (value < 0) throw new SearchFormatError(path, 'a search count cannot be negative');
  if (!Number.isInteger(value)) {
    throw new SearchFormatError(path, 'expected a whole number of searches');
  }
  return value;
}

function parseVariant(value: unknown, path: string): QueryVariant {
  const variant = object(value, path);
  const text = str(variant.text, `${path}.text`);
  if (text.trim().length === 0) {
    throw new SearchFormatError(`${path}.text`, 'a phrasing cannot be empty');
  }
  return { text, searches30d: count(variant.searches30d, `${path}.searches30d`) };
}

function parseQuestion(value: unknown, path: string): QuestionDemand {
  const demand = object(value, path);

  const id = str(demand.id, `${path}.id`);
  const searches30d = count(demand.searches30d, `${path}.searches30d`);
  const searches7d = count(demand.searches7d, `${path}.searches7d`);
  const searchesPrev7d = count(demand.searchesPrev7d, `${path}.searchesPrev7d`);

  const daily = array(demand.daily, `${path}.daily`).map((entry, i) =>
    count(entry, `${path}.daily[${i}]`),
  );
  if (daily.length !== 7) {
    throw new SearchFormatError(`${path}.daily`, `expected 7 days, got ${daily.length}`);
  }

  /*
   * The three consistency rules. Each of them is a statement the interface
   * makes on screen, so a payload that breaks one makes the page lie.
   */

  // The sparkline and the weekly badge are drawn from these two.
  const dailyTotal = daily.reduce((sum, day) => sum + day, 0);
  if (dailyTotal !== searches7d) {
    throw new SearchFormatError(
      `${path}.daily`,
      `the seven daily counts total ${dailyTotal}, but searches7d is ${searches7d}`,
    );
  }

  // Fourteen days cannot hold more searches than the thirty containing them.
  if (searches7d + searchesPrev7d > searches30d) {
    throw new SearchFormatError(
      `${path}.searches30d`,
      `${searches7d} + ${searchesPrev7d} searches in the last two weeks exceeds the 30-day total of ${searches30d}`,
    );
  }

  const variants = array(demand.variants, `${path}.variants`).map((entry, i) =>
    parseVariant(entry, `${path}.variants[${i}]`),
  );

  // Variants are folded into the total, not added to it. A group whose parts
  // exceed the whole means the clustering double-counted somewhere.
  const variantTotal = variants.reduce((sum, variant) => sum + variant.searches30d, 0);
  if (variantTotal > searches30d) {
    throw new SearchFormatError(
      `${path}.variants`,
      `the grouped phrasings total ${variantTotal}, which is more than the question's own 30-day total of ${searches30d}`,
    );
  }

  return {
    id,
    searches30d,
    searches7d,
    searchesPrev7d,
    daily,
    // Largest first, so the interface never has to decide an order.
    variants: [...variants].sort((a, b) => b.searches30d - a.searches30d),
  };
}

/** Where the numbers came from. `sample` is stated on screen, never dressed up as live. */
export type DemandProvenance = 'live' | 'sample';

export interface SearchDemandPayload {
  provenance: DemandProvenance;
  /** ISO-8601. When the backend last recomputed the ranking. */
  generatedAt: string;
  questions: QuestionDemand[];
}

export function parseSearchDemand(value: unknown): SearchDemandPayload {
  const payload = object(value, 'response');

  const provenance = str(payload.provenance, 'response.provenance');
  if (provenance !== 'live' && provenance !== 'sample') {
    throw new SearchFormatError('response.provenance', `expected "live" or "sample", got "${provenance}"`);
  }

  const questions = array(payload.questions, 'response.questions').map((entry, i) =>
    parseQuestion(entry, `response.questions[${i}]`),
  );

  const seen = new Set<string>();
  for (const question of questions) {
    if (seen.has(question.id)) {
      throw new SearchFormatError(
        'response.questions',
        `"${question.id}" appears twice — a canonical question has one row`,
      );
    }
    seen.add(question.id);
  }

  return {
    provenance,
    generatedAt: str(payload.generatedAt, 'response.generatedAt'),
    questions,
  };
}
