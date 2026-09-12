import type {
  AidAnalysis,
  Award,
  AwardKind,
  AwardLine,
  DocumentKind,
  Semester,
  UnreadField,
} from '../core';

/**
 * The wire format the document reader must return, checked at the boundary.
 *
 * The results page runs entirely on tested pure functions, and those functions
 * are only as honest as what they are handed. So nothing crosses into the app
 * unchecked: a backend that returns a string where a dollar figure belongs, or
 * omits `costOfAttendance` rather than sending `null` for it, fails here with
 * the exact path — not four screens later as `$NaN`.
 *
 * `docs/ANALYSIS_API.md` documents this shape with a worked example.
 */

export class AnalysisFormatError extends Error {
  constructor(readonly path: string, detail: string) {
    super(`The document reader returned something unexpected at ${path}: ${detail}`);
    this.name = 'AnalysisFormatError';
  }
}

type Json = Record<string, unknown>;

function object(value: unknown, path: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AnalysisFormatError(path, 'expected an object');
  }
  return value as Json;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new AnalysisFormatError(path, 'expected an array');
  return value;
}

function str(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new AnalysisFormatError(path, 'expected a string');
  return value;
}

function nullableStr(value: unknown, path: string): string | null {
  return value === null ? null : str(value, path);
}

/** Rejects NaN and Infinity, which `typeof` alone waves through as numbers. */
function num(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AnalysisFormatError(path, 'expected a finite number');
  }
  return value;
}

function nullableNum(value: unknown, path: string): number | null {
  return value === null ? null : num(value, path);
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new AnalysisFormatError(path, 'expected true or false');
  return value;
}

function oneOf<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  const text = str(value, path);
  if (!(allowed as readonly string[]).includes(text)) {
    throw new AnalysisFormatError(path, `expected one of ${allowed.join(', ')}, got "${text}"`);
  }
  return text as T;
}

const AWARD_KINDS: readonly AwardKind[] = [
  'grant',
  'subsidized-loan',
  'unsubsidized-loan',
  'work-study',
];

const DOCUMENT_KINDS: readonly DocumentKind[] = [
  'fafsa-submission-summary',
  'award-letter',
  'account-statement',
  'unknown',
];

function parseLine(value: unknown, path: string): AwardLine {
  const line = object(value, path);
  return {
    id: str(line.id, `${path}.id`),
    label: str(line.label, `${path}.label`),
    meaning: str(line.meaning, `${path}.meaning`),
    kind: oneOf(line.kind, `${path}.kind`, AWARD_KINDS),
    amount: num(line.amount, `${path}.amount`),
    verified: bool(line.verified, `${path}.verified`),
  };
}

function parseAward(value: unknown, path: string): Award {
  const award = object(value, path);
  const lines = array(award.lines, `${path}.lines`);

  if (lines.length === 0) {
    throw new AnalysisFormatError(`${path}.lines`, 'an award with no lines is not a result');
  }

  return {
    year: str(award.year, `${path}.year`),
    source: str(award.source, `${path}.source`),
    // `null` means "the document did not state it". Omitting the key is a bug,
    // not a shorthand, so it is not accepted as one.
    costOfAttendance: nullableNum(award.costOfAttendance, `${path}.costOfAttendance`),
    lines: lines.map((line, i) => parseLine(line, `${path}.lines[${i}]`)),
  };
}

function parseSemester(value: unknown, path: string): Semester | null {
  if (value === null) return null;
  const semester = object(value, path);
  return {
    bill: num(semester.bill, `${path}.bill`),
    grantsApplied: num(semester.grantsApplied, `${path}.grantsApplied`),
    subsidizedAvailable: num(semester.subsidizedAvailable, `${path}.subsidizedAvailable`),
    unsubsidizedAvailable: num(semester.unsubsidizedAvailable, `${path}.unsubsidizedAvailable`),
  };
}

function parseUnread(value: unknown, path: string): UnreadField {
  const entry = object(value, path);
  return {
    field: str(entry.field, `${path}.field`),
    where: str(entry.where, `${path}.where`),
  };
}

/**
 * Validates a decoded JSON response into an `AidAnalysis`.
 *
 * `provenance` is forced to `'document'`: a response arriving over the wire is
 * by definition a read of something the student uploaded, and only the local
 * stub is ever allowed to mark itself as demo figures.
 */
export function parseAnalysis(value: unknown): AidAnalysis {
  const root = object(value, 'the response body');
  const document = object(root.document, 'document');
  const student = object(root.student, 'student');

  const confidence = num(document.confidence, 'document.confidence');
  if (confidence < 0 || confidence > 1) {
    throw new AnalysisFormatError('document.confidence', 'expected a value between 0 and 1');
  }

  return {
    provenance: 'document',
    document: {
      fileNames: array(document.fileNames, 'document.fileNames').map((name, i) =>
        str(name, `document.fileNames[${i}]`),
      ),
      kind: oneOf(document.kind, 'document.kind', DOCUMENT_KINDS),
      readAt: str(document.readAt, 'document.readAt'),
      confidence,
    },
    student: {
      firstName: nullableStr(student.firstName, 'student.firstName'),
      school: nullableStr(student.school, 'student.school'),
    },
    sai: nullableNum(root.sai, 'sai'),
    award: parseAward(root.award, 'award'),
    semester: parseSemester(root.semester ?? null, 'semester'),
    unread: array(root.unread ?? [], 'unread').map((entry, i) =>
      parseUnread(entry, `unread[${i}]`),
    ),
  };
}
