import { describe, expect, it } from 'vitest';
import {
  TREND_FLOOR,
  addSearch,
  formatMomentum,
  formatMovement,
  groupedNote,
  momentum,
  previousWindow,
  rankQuestions,
  searchProof,
  selectTrending,
  volumeShare,
  type QuestionDemand,
} from '../trending';

/** A question with sane defaults, so each test states only what it is about. */
function demand(id: string, over: Partial<QuestionDemand> = {}): QuestionDemand {
  return {
    id,
    searches30d: 400,
    searches7d: 100,
    searchesPrev7d: 100,
    daily: [14, 14, 14, 14, 15, 14, 15],
    variants: [],
    ...over,
  };
}

describe('ranking by volume', () => {
  it('puts the most searched question first, whatever order it arrives in', () => {
    const ranked = rankQuestions([
      demand('middle', { searches30d: 500 }),
      demand('small', { searches30d: 90 }),
      demand('big', { searches30d: 1200 }),
    ]);

    expect(ranked.map((question) => question.id)).toEqual(['big', 'middle', 'small']);
    expect(ranked.map((question) => question.rank)).toEqual([1, 2, 3]);
  });

  it('breaks ties by id, so equal volumes never shuffle between renders', () => {
    const first = rankQuestions([demand('b'), demand('a')]).map((q) => q.id);
    const second = rankQuestions([demand('a'), demand('b')]).map((q) => q.id);

    expect(first).toEqual(['a', 'b']);
    expect(second).toEqual(first);
  });

  it('reorders itself when demand changes, with no editorial position anywhere', () => {
    const before = rankQuestions([demand('a', { searches30d: 900 }), demand('b', { searches30d: 400 })]);
    const after = rankQuestions([demand('a', { searches30d: 900 }), demand('b', { searches30d: 1500 })]);

    expect(before[0].id).toBe('a');
    expect(after[0].id).toBe('b');
  });
});

describe('position changes', () => {
  it('reports a climb when a question was quieter a week ago', () => {
    // `climber` took 300 of its 400 searches in the last seven days, so the
    // window one week back holds far less of it than `steady` holds of its own.
    const ranked = rankQuestions([
      demand('climber', { searches30d: 400, searches7d: 300, searchesPrev7d: 20 }),
      demand('steady', { searches30d: 380, searches7d: 95, searchesPrev7d: 95 }),
    ]);

    const climber = ranked.find((question) => question.id === 'climber');
    expect(climber?.rank).toBe(1);
    expect(climber?.previousRank).toBe(2);
    expect(climber?.movement).toBe(1);
  });

  it('calls a question with no previous searches new rather than giving it a movement', () => {
    const [fresh] = rankQuestions([
      demand('fresh', { searches30d: 120, searches7d: 120, searchesPrev7d: 0 }),
    ]);

    expect(previousWindow(fresh)).toBe(0);
    expect(fresh.previousRank).toBeNull();
    expect(fresh.movement).toBeNull();
    expect(formatMovement(fresh.movement)).toBe('New');
  });

  it('holds position when the two windows are identical', () => {
    const [held] = rankQuestions([demand('held')]);
    expect(held.movement).toBe(0);
    expect(formatMovement(held.movement)).toBe('Holding');
  });
});

describe('momentum', () => {
  it('is this week over last week', () => {
    expect(momentum(demand('x', { searches7d: 300, searchesPrev7d: 100 }))).toBe(3);
  });

  it('is null — not Infinity — when last week had nothing to divide by', () => {
    expect(momentum(demand('x', { searches7d: 300, searchesPrev7d: 0 }))).toBeNull();
    expect(formatMomentum(null)).toBe('New this week');
  });

  it('treats two silent weeks as flat, not as new', () => {
    expect(momentum(demand('x', { searches7d: 0, searchesPrev7d: 0 }))).toBe(1);
  });
});

describe('trending', () => {
  it('picks what is rising, not what is biggest', () => {
    const trending = selectTrending([
      demand('huge-but-flat', { searches30d: 5000, searches7d: 1200, searchesPrev7d: 1200 }),
      demand('smaller-but-rising', { searches30d: 600, searches7d: 300, searchesPrev7d: 60 }),
    ]);

    expect(trending.map((question) => question.id)).toEqual(['smaller-but-rising']);
  });

  it('refuses to promote noise below the floor, however steep the rise', () => {
    const trending = selectTrending([
      demand('noise', { searches30d: 8, searches7d: TREND_FLOOR - 1, searchesPrev7d: 1 }),
    ]);

    expect(trending).toEqual([]);
  });

  it('lets new demand trend on volume when there is no ratio to report', () => {
    const [top] = selectTrending([
      demand('brand-new', { searches30d: 400, searches7d: 400, searchesPrev7d: 0 }),
      demand('flat', { searches30d: 900, searches7d: 220, searchesPrev7d: 220 }),
    ]);

    expect(top.id).toBe('brand-new');
    expect(top.momentum).toBeNull();
  });

  it('never returns a question that is falling', () => {
    const trending = selectTrending([
      demand('falling', { searches30d: 900, searches7d: 60, searchesPrev7d: 400 }),
    ]);

    expect(trending).toEqual([]);
  });

  it('honours the limit', () => {
    const rising = Array.from({ length: 9 }, (_, i) =>
      demand(`q${i}`, { searches30d: 800, searches7d: 200 + i, searchesPrev7d: 50 }),
    );

    expect(selectTrending(rising, { limit: 3 })).toHaveLength(3);
  });
});

describe('counting a search as it happens', () => {
  it('moves the day, the week and the month together', () => {
    const [counted] = addSearch([demand('x', { searches30d: 400, searches7d: 100 })], 'x');

    expect(counted.searches30d).toBe(401);
    expect(counted.searches7d).toBe(101);
    expect(counted.daily.reduce((sum, day) => sum + day, 0)).toBe(101);
  });

  it('leaves last week alone, so a search counts as a rise', () => {
    const before = demand('x', { searchesPrev7d: 100 });
    const [after] = addSearch([before], 'x');

    expect(after.searchesPrev7d).toBe(100);
    expect(momentum(after)! > momentum(before)!).toBe(true);
  });

  it('does not mutate what it was given', () => {
    const original = demand('x');
    const snapshot = JSON.stringify(original);
    addSearch([original], 'x');

    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it('ignores an id that is not in the list', () => {
    const list = [demand('x')];
    expect(addSearch(list, 'nobody')).toEqual(list);
  });

  it('lifts a question past the one above it once enough people search it', () => {
    let list = [demand('top', { searches30d: 500 }), demand('second', { searches30d: 498 })];
    expect(rankQuestions(list)[0].id).toBe('top');

    for (let i = 0; i < 3; i += 1) list = addSearch(list, 'second');
    expect(rankQuestions(list)[0].id).toBe('second');
  });
});

describe('what the page says out loud', () => {
  it('states the social-proof bubble in whole searches', () => {
    expect(searchProof(842)).toBe('842 searches in the past 30 days');
    expect(searchProof(1240)).toBe('1,240 searches in the past 30 days');
  });

  it('gets the singular right', () => {
    expect(searchProof(1)).toBe('1 search in the past 30 days');
  });

  it('avoids printing an absurd multiplier', () => {
    expect(formatMomentum(2.35)).toBe('2.4× this week');
    expect(formatMomentum(48)).toBe('Up sharply this week');
  });

  it('scales the volume bar against the top question, and clamps at both ends', () => {
    expect(volumeShare(500, 1000)).toBe(0.5);
    expect(volumeShare(0, 1000)).toBe(0);
    expect(volumeShare(1200, 1000)).toBe(1);
    // An empty ranking has no top to divide by, and draws no bar.
    expect(volumeShare(0, 0)).toBe(0);
  });

  it('counts the canonical phrasing in the grouped note, and says nothing when there is no group', () => {
    expect(groupedNote([{ text: 'a', searches30d: 10 }, { text: 'b', searches30d: 4 }])).toBe(
      'Grouped from 3 ways students ask it',
    );
    expect(groupedNote([])).toBeNull();
  });
});
