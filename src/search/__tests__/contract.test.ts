import { describe, expect, it } from 'vitest';
import { SearchFormatError, parseSearchDemand } from '../contract';
import { reconcile, zeroDemand } from '../analytics';
import { sampleAnalytics } from '../sampleAnalytics';
import { QUESTIONS } from '../library';
import { rankQuestions, selectTrending } from '../../core';

/**
 * A minimal valid payload. Each test below changes one thing about it, so
 * what is being asserted is always the difference.
 */
const VALID = {
  provenance: 'live',
  generatedAt: '2026-09-14T09:00:00.000Z',
  questions: [
    {
      id: 'refund-arrival',
      searches30d: 3184,
      searches7d: 70,
      searchesPrev7d: 812,
      daily: [10, 10, 10, 10, 10, 10, 10],
      variants: [
        { text: 'when will my refund come', searches30d: 668 },
        { text: "why hasn't my refund hit", searches30d: 414 },
      ],
    },
  ],
};

const payload = (over: Record<string, unknown> = {}) => ({ ...VALID, ...over });
const withQuestion = (over: Record<string, unknown>) =>
  payload({ questions: [{ ...VALID.questions[0], ...over }] });

describe('a well-formed payload', () => {
  it('is accepted, and sorts grouped phrasings largest first', () => {
    const parsed = parseSearchDemand(
      withQuestion({
        variants: [
          { text: 'small', searches30d: 12 },
          { text: 'large', searches30d: 900 },
        ],
      }),
    );

    expect(parsed.provenance).toBe('live');
    expect(parsed.questions[0].variants.map((variant) => variant.text)).toEqual(['large', 'small']);
  });

  it('accepts a question nobody has searched yet', () => {
    const parsed = parseSearchDemand(
      withQuestion({
        searches30d: 0,
        searches7d: 0,
        searchesPrev7d: 0,
        daily: [0, 0, 0, 0, 0, 0, 0],
        variants: [],
      }),
    );

    expect(parsed.questions[0].searches30d).toBe(0);
  });
});

describe('what it refuses, and where it says the fault is', () => {
  it('rejects a count that is not a number', () => {
    expect(() => parseSearchDemand(withQuestion({ searches30d: '3184' }))).toThrow(
      /questions\[0\]\.searches30d.*expected a finite number/,
    );
  });

  it('rejects a negative count', () => {
    expect(() => parseSearchDemand(withQuestion({ searches7d: -1 }))).toThrow(
      /cannot be negative/,
    );
  });

  it('rejects a fractional count, which means something upstream averaged', () => {
    expect(() => parseSearchDemand(withQuestion({ searchesPrev7d: 12.5 }))).toThrow(
      /whole number of searches/,
    );
  });

  it('rejects a week that is not seven days long', () => {
    expect(() => parseSearchDemand(withQuestion({ daily: [1, 2, 3] }))).toThrow(
      /expected 7 days, got 3/,
    );
  });

  it('rejects daily counts that disagree with the weekly total they are drawn beside', () => {
    expect(() =>
      parseSearchDemand(withQuestion({ daily: [1, 1, 1, 1, 1, 1, 1], searches7d: 70 })),
    ).toThrow(/total 7, but searches7d is 70/);
  });

  it('rejects two weeks holding more searches than the thirty days containing them', () => {
    expect(() =>
      parseSearchDemand(
        withQuestion({
          searches30d: 100,
          searches7d: 70,
          searchesPrev7d: 60,
          daily: [10, 10, 10, 10, 10, 10, 10],
        }),
      ),
    ).toThrow(/exceeds the 30-day total/);
  });

  it('rejects a group whose parts exceed the whole', () => {
    expect(() =>
      parseSearchDemand(
        withQuestion({ variants: [{ text: 'a', searches30d: 99999 }] }),
      ),
    ).toThrow(/more than the question's own 30-day total/);
  });

  it('rejects an empty phrasing', () => {
    expect(() =>
      parseSearchDemand(withQuestion({ variants: [{ text: '   ', searches30d: 4 }] })),
    ).toThrow(/cannot be empty/);
  });

  it('rejects the same canonical question appearing twice', () => {
    expect(() =>
      parseSearchDemand(payload({ questions: [VALID.questions[0], VALID.questions[0]] })),
    ).toThrow(/appears twice/);
  });

  it('rejects a provenance it does not recognise', () => {
    expect(() => parseSearchDemand(payload({ provenance: 'probably-fine' }))).toThrow(
      /expected "live" or "sample"/,
    );
  });

  it('throws a typed error carrying the path, for anything that reads the failure', () => {
    try {
      parseSearchDemand(withQuestion({ searches30d: null }));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(SearchFormatError);
      expect((error as SearchFormatError).path).toBe('response.questions[0].searches30d');
    }
  });
});

describe('reconciling live analytics against the questions this build has', () => {
  it('ranks an unmentioned question at zero rather than dropping it from the page', () => {
    const reconciled = reconcile([], ['a', 'b']);
    expect(reconciled).toEqual([zeroDemand('a'), zeroDemand('b')]);
  });

  it('ignores a question the backend knows about and this build does not', () => {
    const reconciled = reconcile(
      [{ ...zeroDemand('shipped-later'), searches30d: 5000 }, zeroDemand('a')],
      ['a'],
    );

    expect(reconciled.map((question) => question.id)).toEqual(['a']);
  });
});

describe('the sample source', () => {
  it('obeys every rule the real backend has to obey', async () => {
    const { questions, provenance, generatedAt } = await sampleAnalytics().demand();

    // Round-trips through the same validator the HTTP source runs.
    expect(() => parseSearchDemand({ provenance, generatedAt, questions })).not.toThrow();
  });

  it('covers every question in the library', async () => {
    const { questions } = await sampleAnalytics().demand();
    expect(questions.map((question) => question.id).sort()).toEqual(
      QUESTIONS.map((question) => question.id).sort(),
    );
  });

  it('moves a question up when it is searched, through the same path the backend will drive', async () => {
    const analytics = sampleAnalytics();

    const before = rankQuestions((await analytics.demand()).questions);
    const climber = before[before.length - 1];

    // Enough searches to overtake everything above it.
    for (let i = 0; i < 4000; i += 1) {
      analytics.record({ query: 'x', questionId: climber.id, kind: 'search', at: '' });
    }

    const after = rankQuestions((await analytics.demand()).questions);
    expect(after[0].id).toBe(climber.id);
  });

  it('produces a trending rail that disagrees with the top of the ranking', async () => {
    const { questions } = await sampleAnalytics().demand();
    const ranked = rankQuestions(questions);
    const trending = selectTrending(questions);

    expect(trending.length).toBeGreaterThan(0);
    // Trending is "what moved", not "what is biggest" — if they were the same
    // list, one of the two sections would not be worth showing.
    expect(trending.map((q) => q.id)).not.toEqual(ranked.slice(0, trending.length).map((q) => q.id));
  });

  it('keeps a steep but tiny riser out of the trending rail', async () => {
    const { questions } = await sampleAnalytics().demand();
    const summer = questions.find((question) => question.id === 'summer-aid');

    // Nearly tripled week on week, and still too small to promote.
    expect(summer!.searches7d).toBeGreaterThan(summer!.searchesPrev7d * 2);
    expect(selectTrending(questions).map((q) => q.id)).not.toContain('summer-aid');
  });
});
