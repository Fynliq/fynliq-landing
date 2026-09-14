/**
 * The wire format Ask Fynliq expects back, checked at the boundary.
 *
 * The rule this exists to enforce is the one that matters most in the whole
 * product: an answer may only call itself `personal` if it names the fields
 * of the student's own document it was read from. A model that produces a
 * confident paragraph about somebody's refund with nothing behind it is the
 * exact failure this codebase is built to make impossible, and "the backend
 * said it was grounded" is not evidence of grounding.
 *
 * `docs/ASK_API.md` documents this shape with a worked example.
 */

import type { AnswerBasis, AskAnswer } from './asker';

export class AskFormatError extends Error {
  constructor(
    readonly path: string,
    detail: string,
  ) {
    super(`The answer service returned something unexpected at ${path}: ${detail}`);
    this.name = 'AskFormatError';
  }
}

type Json = Record<string, unknown>;

function object(value: unknown, path: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AskFormatError(path, 'expected an object');
  }
  return value as Json;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new AskFormatError(path, 'expected an array');
  return value;
}

function str(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new AskFormatError(path, 'expected a string');
  return value;
}

function strings(value: unknown, path: string): string[] {
  return array(value, path).map((entry, i) => str(entry, `${path}[${i}]`));
}

export function parseAskAnswer(value: unknown): AskAnswer {
  const payload = object(value, 'response');

  const paragraphs = strings(payload.paragraphs, 'response.paragraphs').filter(
    (paragraph) => paragraph.trim().length > 0,
  );
  if (paragraphs.length === 0) {
    throw new AskFormatError('response.paragraphs', 'an answer with no text is not an answer');
  }

  const basis = str(payload.basis, 'response.basis');
  if (basis !== 'personal' && basis !== 'general') {
    throw new AskFormatError('response.basis', `expected "personal" or "general", got "${basis}"`);
  }

  const grounding = strings(payload.grounding, 'response.grounding');

  // The one rule worth failing a response over.
  if (basis === 'personal' && grounding.length === 0) {
    throw new AskFormatError(
      'response.grounding',
      'an answer that claims to be personal must name the fields of the student’s own document it was read from',
    );
  }

  return {
    paragraphs,
    basis: basis as AnswerBasis,
    grounding,
    missing: payload.missing === null || payload.missing === undefined
      ? null
      : str(payload.missing, 'response.missing'),
    relatedIds: strings(payload.relatedIds ?? [], 'response.relatedIds'),
  };
}
