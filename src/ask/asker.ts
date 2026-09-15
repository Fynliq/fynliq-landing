/**
 * The seam between Ask Fynliq and whatever answers a question.
 *
 * Same shape as the document reader in `beta/`, on purpose: the backend
 * developer learns one pattern and gets two integrations. Point
 * `VITE_FYNLIQ_ASK_URL` at an endpoint and answers come from it; leave it
 * unset and they come from `stubAsker`, which composes the general answer
 * already in the build with a paragraph grounded in the student's own award
 * by the tested functions in `core/ask.ts`.
 *
 * Connecting the backend is one environment variable. No component changes.
 */

import type { AidAnalysis } from '../core';
import { httpAsker } from './httpAsker';
import { stubAsker } from './stubAsker';

/**
 * Whether the answer used the student's own figures.
 *
 * This is not a presentational detail. An answer labelled `personal` is
 * making claims about somebody's money; one labelled `general` is stating a
 * rule that applies to everyone. The interface has to say which it is looking
 * at, so the type makes it impossible to return an answer that does not.
 */
export type AnswerBasis = 'personal' | 'general';

export interface AskAnswer {
  /** The answer, in paragraphs, conclusion first. */
  paragraphs: string[];
  basis: AnswerBasis;
  /**
   * The fields of the student's own award this was read from, named as the
   * contract names them. Empty for a general answer.
   */
  grounding: string[];
  /**
   * What the student would need to add for this to become personal.
   * Present only when the answer is general and could have been personal.
   */
  missing: string | null;
  /** Canonical questions worth reading next, by id. */
  relatedIds: string[];
}

export type AskErrorKind = 'network' | 'format' | 'rejected' | 'cancelled';

export class AskError extends Error {
  constructor(
    message: string,
    readonly kind: AskErrorKind,
  ) {
    super(message);
    this.name = 'AskError';
  }
}

export interface AskOptions {
  signal?: AbortSignal;
}

export interface Asker {
  /** False while running on the local composer, which the page states on screen. */
  readonly connected: boolean;
  /**
   * `analysis` is the student's own read, or `null` when they have not
   * uploaded anything. A `null` here must never produce a personal answer.
   */
  ask(question: string, analysis: AidAnalysis | null, options?: AskOptions): Promise<AskAnswer>;
}

export function createAsker(endpoint = import.meta.env.VITE_FYNLIQ_ASK_URL ?? (import.meta.env.PROD ? '/api/ask' : undefined)): Asker {
  return endpoint ? httpAsker(endpoint) : stubAsker();
}
