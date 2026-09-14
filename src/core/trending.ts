/**
 * How a question earns its place on the search page.
 *
 * The client's rule, restated as arithmetic: most-searched questions rise to
 * the top on their own, and near-identical phrasings ("when will my refund
 * come", "why hasn't my refund hit") count toward one canonical question
 * rather than competing with it.
 *
 * Nothing in a component decides a rank, a position change or a trend — the
 * same rule the money layer holds itself to. A ranking computed in three
 * places drifts, and a "Most searched" list that disagrees with its own
 * numbers is worse than no list at all.
 *
 * All of it is arithmetic over counts that arrive from outside. Swapping the
 * sample analytics for real ones changes the inputs and nothing here.
 */

/** One phrasing students actually typed, folded into a canonical question. */
export interface QueryVariant {
  /** The phrasing, as typed. Shown as proof the grouping is real. */
  text: string;
  /** Searches for this phrasing alone, last 30 days. */
  searches30d: number;
}

/**
 * Demand for one canonical question, already grouped.
 *
 * Every count here is the group total — the canonical phrasing plus every
 * variant folded into it. `variants` is the evidence for that total, not an
 * amount to be added to it.
 */
export interface QuestionDemand {
  id: string;
  /** Group total, last 30 days. The figure the social-proof bubble states. */
  searches30d: number;
  /** Group total, last 7 days. */
  searches7d: number;
  /** Group total for the 7 days before those. What "rising" is measured against. */
  searchesPrev7d: number;
  /** Seven daily group totals, oldest first. Drives the sparkline. */
  daily: number[];
  /** The phrasings this question absorbed, largest first. */
  variants: QueryVariant[];
}

export interface RankedQuestion extends QuestionDemand {
  /** 1-based, by 30-day volume. */
  rank: number;
  /**
   * Where it sat a week ago, or `null` when it had no searches then.
   * Computed by sliding the 30-day window back one week, so it moves for the
   * same reason the visible ranking moves.
   */
  previousRank: number | null;
  /** Positive is a climb. `null` when there is no previous position. */
  movement: number | null;
  /**
   * This week against last week. 2 means twice as many searches.
   * `null` when last week had none — new demand, with nothing to divide by.
   */
  momentum: number | null;
}

/* ------------------------------------------------------------------------ *
 *  Grouping
 * ------------------------------------------------------------------------ */

/**
 * The 30-day volume of the same question one week ago.
 *
 * The window slides rather than being stored: drop the most recent seven days
 * off the front and put the seven before them back on. It needs no history
 * table on the backend, and it moves only when real demand moves.
 */
export function previousWindow(demand: QuestionDemand): number {
  return Math.max(0, demand.searches30d - demand.searches7d + demand.searchesPrev7d);
}

/**
 * This week against last week.
 *
 * `null` rather than Infinity when last week was empty: a question with no
 * baseline is new, which is a different statement from "rose infinitely", and
 * the interface says so in those words.
 */
export function momentum(demand: QuestionDemand): number | null {
  if (demand.searchesPrev7d <= 0) return demand.searches7d > 0 ? null : 1;
  return demand.searches7d / demand.searchesPrev7d;
}

/* ------------------------------------------------------------------------ *
 *  Ranking
 * ------------------------------------------------------------------------ */

/** Volume descending, then id, so equal volumes never shuffle between renders. */
function byVolume(volume: (demand: QuestionDemand) => number) {
  return (a: QuestionDemand, b: QuestionDemand) => volume(b) - volume(a) || a.id.localeCompare(b.id);
}

function positions(list: QuestionDemand[], volume: (demand: QuestionDemand) => number) {
  const ordered = [...list].sort(byVolume(volume));
  return new Map(ordered.map((demand, index) => [demand.id, index + 1]));
}

/**
 * Ranks every question by 30-day volume and works out how far each has moved.
 *
 * This is the whole of "most searched rises to the top automatically": there
 * is no editorial order anywhere in the page and no hand-set position to fall
 * out of date. Hand it larger numbers and the list reorders itself.
 */
export function rankQuestions(list: QuestionDemand[]): RankedQuestion[] {
  const now = positions(list, (demand) => demand.searches30d);
  const before = positions(list, previousWindow);

  return [...list].sort(byVolume((demand) => demand.searches30d)).map((demand) => {
    const rank = now.get(demand.id) as number;
    // A question nobody searched last month has no position to have moved from.
    const previousRank = previousWindow(demand) > 0 ? (before.get(demand.id) as number) : null;

    return {
      ...demand,
      rank,
      previousRank,
      movement: previousRank === null ? null : previousRank - rank,
      momentum: momentum(demand),
    };
  });
}

/* ------------------------------------------------------------------------ *
 *  Trending
 * ------------------------------------------------------------------------ */

/**
 * Below this many searches in a week, a question is not trending — it is
 * noise. Three people and a typo can double a count of two, and a Trending
 * rail that promotes that is a rail students learn to ignore.
 */
export const TREND_FLOOR = 40;

/**
 * How fast a question is rising, as one comparable number.
 *
 * New demand has no ratio to report, so it is scored on volume against the
 * floor instead — the same statement ("this many people, from a standing
 * start") in the same units.
 */
export function trendScore(demand: QuestionDemand): number {
  const ratio = momentum(demand);
  return ratio === null ? demand.searches7d / TREND_FLOOR : ratio;
}

export interface TrendOptions {
  limit?: number;
  floor?: number;
}

/**
 * Trending is a different question from most-searched, and is allowed to
 * disagree with it: the top of the ranking is settled demand, this is the
 * demand that moved. A question can be rising fast and still sit tenth.
 */
export function selectTrending(
  list: QuestionDemand[],
  { limit = 4, floor = TREND_FLOOR }: TrendOptions = {},
): RankedQuestion[] {
  return rankQuestions(list)
    .filter((demand) => demand.searches7d >= floor && trendScore(demand) > 1)
    .sort(
      (a, b) =>
        trendScore(b) - trendScore(a) || b.searches7d - a.searches7d || a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}

/* ------------------------------------------------------------------------ *
 *  Counting a search as it happens
 * ------------------------------------------------------------------------ */

/**
 * One more search for `id`, returned as a new list.
 *
 * The search a student just made counts immediately rather than at the next
 * refresh. That is not decoration: "most searched rises to the top
 * automatically" is only demonstrably true if you can watch it happen, and
 * the alternative — a ranking that ignores you until a backend job runs
 * overnight — is exactly the dead page the client asked us not to build.
 *
 * It is an optimistic increment. The report goes to the analytics backend
 * too, and the next load replaces this with whatever the backend actually
 * counted. Every invariant the contract enforces survives: the day and the
 * week and the month all move together, so the sparkline still totals the
 * badge beside it.
 */
export function addSearch(list: QuestionDemand[], id: string): QuestionDemand[] {
  return list.map((demand) => {
    if (demand.id !== id) return demand;

    const daily = [...demand.daily];
    daily[daily.length - 1] += 1;

    return {
      ...demand,
      searches30d: demand.searches30d + 1,
      searches7d: demand.searches7d + 1,
      daily,
    };
  });
}

/* ------------------------------------------------------------------------ *
 *  Saying it in words
 * ------------------------------------------------------------------------ */

const count = new Intl.NumberFormat('en-US');

export function formatSearches(searches: number): string {
  return count.format(Math.round(searches));
}

/** The social-proof bubble. Singular is worth getting right; students notice. */
export function searchProof(searches: number): string {
  const rounded = Math.round(searches);
  return `${count.format(rounded)} ${rounded === 1 ? 'search' : 'searches'} in the past 30 days`;
}

/**
 * The trend badge. Deliberately says "new this week" rather than inventing a
 * multiplier against a week that had nothing in it.
 */
export function formatMomentum(ratio: number | null): string {
  if (ratio === null) return 'New this week';
  if (ratio >= 10) return 'Up sharply this week';
  return `${ratio.toFixed(1)}× this week`;
}

/** The rank-movement chip: climbed, slipped, new, or holding. */
export function formatMovement(movement: number | null): string {
  if (movement === null) return 'New';
  if (movement > 0) return `↑ ${movement}`;
  if (movement < 0) return `↓ ${Math.abs(movement)}`;
  return 'Holding';
}

/** Every search across a set of questions, for a headline or a category chip. */
export function totalSearches(list: QuestionDemand[]): number {
  return list.reduce((sum, demand) => sum + demand.searches30d, 0);
}

/**
 * This question's volume against the most-searched one, 0 to 1.
 *
 * The length of the bar drawn beside each row. It is here rather than in the
 * component for the same reason the rank is: it is arithmetic over demand,
 * and a bar whose length disagrees with the number printed next to it is the
 * bug this separation exists to prevent.
 */
export function volumeShare(searches: number, top: number): number {
  if (top <= 0) return 0;
  return Math.min(1, Math.max(0, searches / top));
}

/** How many phrasings this question absorbed, stated only when it absorbed any. */
export function groupedNote(variants: QueryVariant[]): string | null {
  if (variants.length === 0) return null;
  return `Grouped from ${variants.length + 1} ways students ask it`;
}
