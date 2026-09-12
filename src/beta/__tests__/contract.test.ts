import { describe, expect, it } from 'vitest';
import { AnalysisFormatError, parseAnalysis } from '../contract';

/** The worked example from docs/ANALYSIS_API.md, kept honest by these tests. */
const valid = () => ({
  document: {
    fileNames: ['fafsa-summary.pdf'],
    kind: 'fafsa-submission-summary',
    readAt: '2026-09-12T09:30:00.000Z',
    confidence: 0.94,
  },
  student: { firstName: 'Sam', school: 'State University' },
  sai: 1_200,
  award: {
    year: '2026-27',
    source: 'FAFSA Submission Summary',
    costOfAttendance: 26_600,
    lines: [
      {
        id: 'pell',
        label: 'Federal Pell Grant',
        meaning: 'Free money, never repaid',
        kind: 'grant',
        amount: 7_395,
        verified: true,
      },
    ],
  },
  semester: {
    bill: 8_200,
    grantsApplied: 6_400,
    subsidizedAvailable: 2_750,
    unsubsidizedAvailable: 1_000,
  },
  unread: [{ field: 'Next disbursement date', where: 'Your student account.' }],
});

/** Replaces one nested key, so each test states only what it broke. */
function withField(path: [string, string], value: unknown) {
  const payload = valid() as unknown as Record<string, Record<string, unknown>>;
  payload[path[0]] = { ...payload[path[0]], [path[1]]: value };
  return payload;
}

describe('parseAnalysis', () => {
  it('accepts a well-formed response', () => {
    const analysis = parseAnalysis(valid());

    expect(analysis.sai).toBe(1_200);
    expect(analysis.award.lines[0].kind).toBe('grant');
    expect(analysis.semester?.bill).toBe(8_200);
    expect(analysis.unread).toHaveLength(1);
  });

  it('marks anything that arrived over the wire as read from a document', () => {
    // A backend cannot label its own output as demo figures, whatever it sends.
    const analysis = parseAnalysis({ ...valid(), provenance: 'demo' });

    expect(analysis.provenance).toBe('document');
  });

  it('keeps null as "the document did not state it"', () => {
    const analysis = parseAnalysis({ ...valid(), sai: null, semester: null });

    expect(analysis.sai).toBeNull();
    expect(analysis.semester).toBeNull();
  });

  it('defaults only the genuinely optional lists', () => {
    const payload = valid() as Record<string, unknown>;
    delete payload.unread;
    delete payload.semester;

    const analysis = parseAnalysis(payload);
    expect(analysis.unread).toEqual([]);
    expect(analysis.semester).toBeNull();
  });

  it('rejects a missing cost of attendance rather than treating it as unknown', () => {
    const payload = valid();
    delete (payload.award as Partial<typeof payload.award>).costOfAttendance;

    expect(() => parseAnalysis(payload)).toThrow(AnalysisFormatError);
  });

  it('names the exact path that was wrong', () => {
    expect(() => parseAnalysis(withField(['document', 'confidence'], '0.9'))).toThrow(
      /document\.confidence/,
    );
  });

  it('rejects a confidence outside 0 to 1', () => {
    expect(() => parseAnalysis(withField(['document', 'confidence'], 1.4))).toThrow(
      /between 0 and 1/,
    );
  });

  it('rejects an unknown award kind instead of rendering it as nothing', () => {
    const payload = valid();
    payload.award.lines[0].kind = 'scholarship';

    expect(() => parseAnalysis(payload)).toThrow(/award\.lines\[0\]\.kind/);
  });

  it('rejects a dollar figure that is not a finite number', () => {
    const payload = valid();
    payload.award.lines[0].amount = Number.NaN;

    expect(() => parseAnalysis(payload)).toThrow(/award\.lines\[0\]\.amount/);
  });

  it('rejects an award with no lines', () => {
    const payload = valid();
    payload.award.lines = [];

    expect(() => parseAnalysis(payload)).toThrow(/award\.lines/);
  });

  it('rejects a body that is not an object at all', () => {
    expect(() => parseAnalysis('server error')).toThrow(AnalysisFormatError);
    expect(() => parseAnalysis(null)).toThrow(AnalysisFormatError);
  });
});
