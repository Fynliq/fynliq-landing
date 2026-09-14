import { describe, expect, it } from 'vitest';
import { AskFormatError, parseAskAnswer } from '../contract';
import { stubAsker } from '../stubAsker';
import { DEMO_AWARD, DEMO_SEMESTER } from '../../data/demo';
import type { AidAnalysis } from '../../core';

const VALID = {
  paragraphs: ['Your bill this term is $8,200.', 'Here is why that matters.'],
  basis: 'personal',
  grounding: ['semester.bill'],
  missing: null,
  relatedIds: ['refund-arrival'],
};

const payload = (over: Record<string, unknown> = {}) => ({ ...VALID, ...over });

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

describe('the rule the contract exists to enforce', () => {
  it('refuses a personal answer that names no field it was read from', () => {
    expect(() => parseAskAnswer(payload({ grounding: [] }))).toThrow(
      /must name the fields of the student/,
    );
  });

  it('accepts a general answer with no grounding, which is what general means', () => {
    const parsed = parseAskAnswer(payload({ basis: 'general', grounding: [] }));
    expect(parsed.basis).toBe('general');
  });

  it('carries the path on the error, for anything that reads the failure', () => {
    try {
      parseAskAnswer(payload({ paragraphs: [] }));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AskFormatError);
      expect((error as AskFormatError).path).toBe('response.paragraphs');
    }
  });

  it('refuses an answer with no text', () => {
    expect(() => parseAskAnswer(payload({ paragraphs: ['   ', ''] }))).toThrow(
      /an answer with no text/,
    );
  });

  it('refuses a basis it does not recognise', () => {
    expect(() => parseAskAnswer(payload({ basis: 'probably' }))).toThrow(
      /expected "personal" or "general"/,
    );
  });

  it('treats a missing relatedIds as none, not as a failure', () => {
    const { relatedIds } = parseAskAnswer({ ...VALID, relatedIds: undefined });
    expect(relatedIds).toEqual([]);
  });
});

describe('the local composer', () => {
  it('answers generally, and says what is missing, when nothing has been uploaded', async () => {
    const answer = await stubAsker().ask('when will my refund come', null);

    expect(answer.basis).toBe('general');
    expect(answer.grounding).toEqual([]);
    expect(answer.missing).toMatch(/student account statement/);
  });

  it('answers personally, and names its fields, once an award has been read', async () => {
    const answer = await stubAsker().ask('when will my refund come', analysis());

    expect(answer.basis).toBe('personal');
    expect(answer.grounding).toContain('semester.bill');
    expect(answer.missing).toBeNull();
  });

  it('falls back to general when the document lacks what the topic needs', async () => {
    const answer = await stubAsker().ask('when will my refund come', analysis({ semester: null }));

    expect(answer.basis).toBe('general');
    expect(answer.missing).toMatch(/student account statement/);
  });

  it('produces answers the contract accepts', async () => {
    const asker = stubAsker();

    for (const question of ['when will my refund come', 'subsidized vs unsubsidized', 'what is sai']) {
      const answer = await asker.ask(question, analysis());
      expect(() => parseAskAnswer(answer), question).not.toThrow();
    }
  });

  it('says it does not know rather than producing something for a question it cannot place', async () => {
    const answer = await stubAsker().ask('what time does the library close', null);

    expect(answer.paragraphs[0]).toMatch(/does not have an answer to that one yet/);
    expect(answer.basis).toBe('general');
  });

  it('can be cancelled', async () => {
    const controller = new AbortController();
    const pending = stubAsker().ask('refund', null, { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toThrow(/Cancelled/);
  });
});
