/**
 * Turning what a student typed into the one question that answers it.
 *
 * This is the frontend half of the grouping rule. The backend clusters
 * *historical* queries — that is how "why hasn't my refund hit" ends up
 * counting toward the refund question's volume. This file clusters the query
 * being typed right now, so somebody who phrases it their own way still lands
 * on the canonical answer instead of on an empty results page.
 *
 * Both halves matter and neither replaces the other: the ranking is only
 * honest if variants are folded into it, and the search box is only usable if
 * it recognises those same variants live, before any analytics have loaded.
 *
 * Deliberately not fuzzy. Edit distance on short strings matches things that
 * have nothing to do with each other, and a search page that confidently
 * answers the wrong financial question is worse than one that says it found
 * nothing.
 */

import type { Question } from './library';

/**
 * Words that say nothing about which question is being asked.
 *
 * The interrogatives are in here for a reason that only shows up in testing:
 * leave "what" and "does" as matchable tokens and "what time does the library
 * close" scores a hit against "what does subsidized mean", because two of its
 * five words are shared. Every question on this page starts with one of these
 * words, so none of them distinguishes between any of them.
 */
const NOISE = new Set([
  'a',
  'about',
  'am',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'can',
  'could',
  'did',
  'do',
  'doe',
  'does',
  'for',
  'from',
  'get',
  'got',
  'ha',
  'had',
  'has',
  'have',
  'how',
  'i',
  'if',
  'in',
  'is',
  'it',
  'its',
  'me',
  'my',
  'of',
  'on',
  'or',
  'should',
  'so',
  'that',
  'the',
  'their',
  'them',
  'there',
  'they',
  'this',
  'to',
  'wa',
  'was',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'will',
  'with',
  'would',
  'you',
  'your',
]);

/**
 * Lowercase, unpunctuated, single-spaced.
 *
 * Apostrophes are removed rather than replaced, so "hasn't" and "hasnt" are
 * the same string — students type both and a curly apostrophe from a phone
 * keyboard is a third spelling of the same word.
 */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Crude singular folding — enough for "loans"/"loan", not a stemmer.
 *
 * The length guards keep it off short words, where stripping a letter turns
 * "has" into "ha" and stops meaning anything.
 */
function fold(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/** Checked before and after folding, since folding can produce a noise word. */
export function tokenise(text: string): string[] {
  const kept: string[] = [];

  for (const word of normalise(text).split(' ')) {
    if (word.length === 0 || NOISE.has(word)) continue;
    const folded = fold(word);
    if (NOISE.has(folded)) continue;
    kept.push(folded);
  }

  return kept;
}

/** Above this, a match is worth showing. Below it, it is a coincidence. */
export const MATCH_FLOOR = 20;

/** An exact hit on a canonical question or one of its known phrasings. */
const EXACT = 100;

function scorePhrase(queryTokens: string[], query: string, phrase: string): number {
  const candidate = normalise(phrase);
  if (candidate.length === 0) return 0;
  if (candidate === query) return EXACT;

  const candidateTokens = tokenise(phrase);
  if (candidateTokens.length === 0) return 0;

  // One phrasing wholly inside the other: "refund" inside "when will my
  // refund come". Scored by how much of the longer string it accounts for.
  let score = 0;
  if (candidate.includes(query) || query.includes(candidate)) {
    const [shorter, longer] =
      query.length < candidate.length ? [query, candidate] : [candidate, query];
    score = 55 + 25 * (shorter.length / longer.length);
  }

  const wanted = new Set(candidateTokens);
  const hits = queryTokens.filter((token) => wanted.has(token)).length;
  if (hits === 0) return score;

  // Both directions matter. Covering the query says the answer is on topic;
  // covering the candidate says the query was not merely a word it contains.
  const overlap = 46 * (hits / queryTokens.length) + 16 * (hits / candidateTokens.length);
  return Math.max(score, overlap);
}

export interface Match {
  question: Question;
  score: number;
  /**
   * The phrasing that produced the match, when it was not the canonical one.
   * Shown to the student — "you searched X, this is where X is answered" is
   * the grouping explaining itself rather than silently redirecting them.
   */
  matchedVariant: string | null;
}

export interface MatchOptions {
  /**
   * Extra phrasings per question id, as clustered by the backend. Merged with
   * the seed phrasings in the library rather than replacing them.
   */
  clustered?: Map<string, string[]>;
  floor?: number;
}

/** Scores one question, taking the best of its canonical phrasing and variants. */
export function scoreQuestion(
  rawQuery: string,
  question: Question,
  clustered?: Map<string, string[]>,
): Match {
  const query = normalise(rawQuery);
  const queryTokens = tokenise(rawQuery);

  let score = scorePhrase(queryTokens, query, question.question);
  let matchedVariant: string | null = null;

  const phrasings = [...question.variants, ...(clustered?.get(question.id) ?? [])];
  for (const variant of phrasings) {
    const candidate = scorePhrase(queryTokens, query, variant);
    if (candidate > score) {
      score = candidate;
      matchedVariant = variant;
    }
  }

  /*
   * Last, the question's own answer, at a discount.
   *
   * Students search for the thing they want to know, not for the shape of the
   * question — "loan interest while in school" is nobody's phrasing of
   * anything, and no seed list will ever contain it. The one-line answer does
   * contain those words, because it is what the answer is about.
   *
   * Discounted so it can never outrank a real phrasing: a question whose
   * answer merely mentions the subject must not beat the question that is
   * about it.
   */
  const contextual = Math.max(
    scorePhrase(queryTokens, query, question.answer) * 0.7,
    // A question is also findable by its subject area.
    scorePhrase(queryTokens, query, question.category) * 0.5,
  );
  if (contextual > score) {
    score = contextual;
    matchedVariant = null;
  }

  return { question, score, matchedVariant };
}

/**
 * Every question that plausibly answers the query, best first.
 *
 * An empty query returns nothing rather than everything: the caller shows the
 * ranked browse view in that case, and that view is ordered by real demand,
 * not by relevance to a blank string.
 */
export function searchQuestions(
  rawQuery: string,
  questions: Question[],
  { clustered, floor = MATCH_FLOOR }: MatchOptions = {},
): Match[] {
  if (normalise(rawQuery).length === 0) return [];

  return questions
    .map((question) => scoreQuestion(rawQuery, question, clustered))
    .filter((match) => match.score >= floor)
    .sort((a, b) => b.score - a.score || a.question.id.localeCompare(b.question.id));
}

/**
 * The typeahead list.
 *
 * Shows the canonical question in every row — a student typing their own
 * phrasing should see the question they are about to be taken to, not their
 * own words echoed back at them.
 */
export function suggest(
  rawQuery: string,
  questions: Question[],
  options: MatchOptions & { limit?: number } = {},
): Match[] {
  const { limit = 6, ...rest } = options;
  return searchQuestions(rawQuery, questions, rest).slice(0, limit);
}
