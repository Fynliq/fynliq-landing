import { describe, expect, it } from 'vitest';
import { QUESTIONS, questionById } from '../library';
import { normalise, scoreQuestion, searchQuestions, suggest, tokenise } from '../match';

const top = (query: string) => searchQuestions(query, QUESTIONS)[0];

describe('normalising what somebody typed', () => {
  it('folds the three ways a phone spells an apostrophe into one string', () => {
    expect(normalise("why hasn't my refund hit")).toBe('why hasnt my refund hit');
    expect(normalise('why hasn’t my refund hit')).toBe('why hasnt my refund hit');
    expect(normalise('  Why   HASNT my  refund hit?? ')).toBe('why hasnt my refund hit');
  });

  it('drops words that say nothing about which question is being asked', () => {
    expect(tokenise('where is my financial aid refund')).toEqual(['financial', 'aid', 'refund']);
  });

  it('drops interrogatives, which every question on the page starts with', () => {
    expect(tokenise('what does subsidized mean')).toEqual(['subsidized', 'mean']);
    expect(tokenise('how do i get my loans')).toEqual(['loan']);
  });

  it('folds plurals without mangling short words', () => {
    expect(tokenise('loans grants classes')).toEqual(['loan', 'grant', 'class']);
  });
});

describe('the grouping the client asked for', () => {
  // The client's own example, verbatim: three phrasings, one canonical answer.
  const phrasings = [
    'When will my refund come?',
    'Where is my financial aid refund?',
    "Why hasn't my refund hit?",
  ];

  it.each(phrasings)('sends %s to the canonical refund question', (phrasing) => {
    expect(top(phrasing)?.question.id).toBe('refund-arrival');
  });

  it('names the phrasing it matched, so the student is not silently redirected', () => {
    const match = top("why hasn't my refund hit");
    expect(match.matchedVariant).toBe("why hasn't my refund hit");
    expect(match.question.question).toBe('When will my financial aid refund arrive?');
  });

  it('matches the canonical wording without claiming a variant produced it', () => {
    const match = top('When will my financial aid refund arrive?');
    expect(match.question.id).toBe('refund-arrival');
    expect(match.matchedVariant).toBeNull();
  });

  it('still finds the question from words that are on no list at all', () => {
    expect(top('refund late')?.question.id).toBe('refund-arrival');
  });
});

describe('finding the right question', () => {
  const cases: [string, string][] = [
    ['subsidized vs unsubsidized', 'sub-vs-unsub'],
    ['do i have to accept all my loans', 'loan-accept-amount'],
    ['why was i selected for verification', 'verification'],
    ['what is sai', 'sai-meaning'],
    ['my financial aid went down', 'why-less-aid'],
    ['lost my financial aid because of grades', 'sap'],
    ['summer pell grant', 'summer-aid'],
    ['can i file fafsa without my parents', 'dependency'],
    ['work study not on my bill', 'work-study'],
    ['scholarship displacement', 'outside-scholarship'],
  ];

  it.each(cases)('%s → %s', (query, id) => {
    expect(top(query)?.question.id).toBe(id);
  });

  it('returns nothing for a query about something else entirely', () => {
    expect(searchQuestions('cheap flights to chicago', QUESTIONS)).toEqual([]);
  });

  it('returns nothing for an empty query, so the caller shows the ranked view instead', () => {
    expect(searchQuestions('   ', QUESTIONS)).toEqual([]);
  });

  it('finds a question from words that appear in its answer rather than its title', () => {
    // Nobody's phrasing, on no seed list. It is findable because it is what
    // the subsidized/unsubsidized answer is actually about.
    expect(top('loan interest while in school')?.question.id).toBe('sub-vs-unsub');
  });

  it('orders by score, best first', () => {
    const results = searchQuestions('loan', QUESTIONS);
    expect(results.length).toBeGreaterThan(1);
    for (let i = 1; i < results.length; i += 1) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('is deterministic when two questions score the same', () => {
    const once = searchQuestions('financial aid', QUESTIONS).map((m) => m.question.id);
    const twice = searchQuestions('financial aid', [...QUESTIONS].reverse()).map(
      (m) => m.question.id,
    );
    expect(twice).toEqual(once);
  });
});

describe('phrasings the backend clustered', () => {
  it('matches a phrasing that is in no seed list, supplied at runtime', () => {
    const clustered = new Map([['refund-arrival', ['did my bursar send my money yet']]]);
    const match = scoreQuestion('did my bursar send my money yet', questionById('refund-arrival')!, clustered);

    expect(match.score).toBe(100);
    expect(match.matchedVariant).toBe('did my bursar send my money yet');
  });
});

describe('the typeahead', () => {
  it('honours its limit', () => {
    expect(suggest('aid', QUESTIONS, { limit: 3 }).length).toBeLessThanOrEqual(3);
  });

  it('shows the canonical question, not the phrasing typed', () => {
    const [first] = suggest('when will my refund come', QUESTIONS);
    expect(first.question.question).toBe('When will my financial aid refund arrive?');
  });
});

describe('the library itself', () => {
  it('has unique ids and unique slugs', () => {
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(QUESTIONS.length);
    expect(new Set(QUESTIONS.map((q) => q.slug)).size).toBe(QUESTIONS.length);
  });

  it('only relates questions that exist, and never relates one to itself', () => {
    for (const question of QUESTIONS) {
      for (const id of question.related) {
        expect(questionById(id), `${question.id} → ${id}`).toBeDefined();
        expect(id).not.toBe(question.id);
      }
    }
  });

  it('always says what only the student’s own school can settle', () => {
    for (const question of QUESTIONS) {
      expect(question.checkYourself.length, question.id).toBeGreaterThan(40);
      expect(question.body.length, question.id).toBeGreaterThan(0);
    }
  });
});
