import { describe, expect, it } from 'vitest';
import { DEMO_AWARD, DEMO_SEMESTER } from '../../data/demo';
import { groundInAward, type AskTopic } from '../ask';
import type { AidAnalysis } from '../analysis';

function analysis(over: Partial<AidAnalysis> = {}): AidAnalysis {
  return {
    provenance: 'document',
    document: { fileNames: ['award.pdf'], kind: 'award-letter', readAt: '', confidence: 0.92 },
    student: { firstName: null, school: null },
    sai: 0,
    award: DEMO_AWARD,
    semester: DEMO_SEMESTER,
    unread: [],
    ...over,
  };
}

describe('grounding an answer in somebody’s own award', () => {
  it('states the bill, the gift aid applied, and what is left', () => {
    const grounded = groundInAward('bill', analysis());

    expect(grounded).not.toBeNull();
    expect(grounded!.paragraph).toMatch(/\$[\d,]+/);
    expect(grounded!.fields).toContain('semester.bill');
  });

  it('names the figure to stop at when asked about loans', () => {
    const grounded = groundInAward('loans', analysis());
    expect(grounded!.paragraph).toMatch(/stop at/);
  });

  it('reports the Student Aid Index the document stated', () => {
    const grounded = groundInAward('fafsa', analysis({ sai: 1_200 }));
    expect(grounded!.paragraph).toContain('1200');
    expect(grounded!.fields).toEqual(['sai']);
  });
});

describe('what it refuses to personalise', () => {
  it('returns null rather than inventing a Student Aid Index the document did not state', () => {
    expect(groundInAward('fafsa', analysis({ sai: null }))).toBeNull();
  });

  it('returns null for every topic that needs a bill, when no bill was read', () => {
    const noBill = analysis({ semester: null });

    expect(groundInAward('refunds', noBill)).toBeNull();
    expect(groundInAward('bill', noBill)).toBeNull();
  });

  it('still answers about loans without a bill, but refuses to name an amount to accept', () => {
    const grounded = groundInAward('loans', analysis({ semester: null }));

    expect(grounded).not.toBeNull();
    expect(grounded!.paragraph).toMatch(/did not state this term's bill/);
    expect(grounded!.paragraph).not.toMatch(/stop at/);
  });

  it('never personalises eligibility, which is not printed on an award', () => {
    expect(groundInAward('eligibility', analysis())).toBeNull();
  });
});

describe('every topic', () => {
  const topics: AskTopic[] = ['refunds', 'grants', 'loans', 'fafsa', 'bill', 'eligibility'];

  it.each(topics)('%s either grounds with named fields or returns null', (topic) => {
    const grounded = groundInAward(topic, analysis());

    if (grounded === null) return;
    expect(grounded.paragraph.length).toBeGreaterThan(80);
    expect(grounded.fields.length).toBeGreaterThan(0);
  });

  it('never prints a figure with cents, or a NaN', () => {
    for (const topic of topics) {
      const grounded = groundInAward(topic, analysis());
      if (!grounded) continue;
      expect(grounded.paragraph).not.toMatch(/NaN|\$\d+\.\d/);
    }
  });
});
