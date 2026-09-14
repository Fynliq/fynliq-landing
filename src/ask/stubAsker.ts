import { MISSING_FOR_TOPIC, groundInAward, type AidAnalysis, type AskTopic } from '../core';
import { QUESTIONS, questionById } from '../search/library';
import { searchQuestions } from '../search/match';
import { AskError, type AskAnswer, type Asker, type AskOptions } from './asker';

/**
 * The answer used until the answer service is connected.
 *
 * It is not a mock and it invents nothing. It does two real things:
 *
 *   1. Matches the question against the same canonical library the search
 *      page uses, and returns that answer — which is a genuinely useful
 *      response to most questions a student types.
 *   2. If they have uploaded their own aid, adds one paragraph computed from
 *      it by `groundInAward`, and names the fields that paragraph was read
 *      from.
 *
 * Where the document does not contain what a topic needs, it returns a
 * general answer and says what is missing, rather than a personal-sounding
 * one with nothing behind it. That is the behaviour the real service has to
 * match, and the contract enforces it on both.
 */

/** Long enough for the thinking state to register, short enough not to annoy. */
const THINKING_MS = 620;

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AskError('Cancelled.', 'cancelled'));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(new AskError('Cancelled.', 'cancelled'));
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const NO_MATCH: string[] = [
  'Fynliq does not have an answer to that one yet.',
  'The library behind this page covers the questions students search for most — refunds and disbursement, what to accept on a loan, verification, the Student Aid Index, grades and eligibility. Try one of those, or put the question to your aid office, who can see your file.',
];

export function stubAsker(): Asker {
  return {
    connected: false,

    async ask(
      question: string,
      analysis: AidAnalysis | null,
      options: AskOptions = {},
    ): Promise<AskAnswer> {
      await wait(THINKING_MS, options.signal);

      const [match] = searchQuestions(question, QUESTIONS);

      if (!match) {
        return {
          paragraphs: NO_MATCH,
          basis: 'general',
          grounding: [],
          missing: null,
          relatedIds: ['refund-arrival', 'bill-gap', 'loan-accept-amount'],
        };
      }

      const topic = match.question.category as AskTopic;
      const general = [match.question.answer, ...match.question.body];
      const related = match.question.related.filter((id) => questionById(id) !== undefined);

      if (analysis === null) {
        return {
          paragraphs: general,
          basis: 'general',
          grounding: [],
          missing: MISSING_FOR_TOPIC[topic],
          relatedIds: related,
        };
      }

      const grounded = groundInAward(topic, analysis);

      if (grounded === null) {
        return {
          paragraphs: general,
          basis: 'general',
          grounding: [],
          missing: MISSING_FOR_TOPIC[topic],
          relatedIds: related,
        };
      }

      // The student's own figures first — they are why they came here rather
      // than reading the same answer on the search page.
      return {
        paragraphs: [grounded.paragraph, ...general],
        basis: 'personal',
        grounding: grounded.fields,
        missing: null,
        relatedIds: related,
      };
    },
  };
}
