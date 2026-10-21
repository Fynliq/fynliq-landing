import { describe, expect, it } from 'vitest';
import type { AnalyzeResult } from '../analyzer';
import { isFreshRead } from '../freshRead';

const started = Date.parse('2026-10-16T12:00:00Z');

const preview = (id: string | null, readAt: string) =>
  ({ locked: true, analysisId: id, readAt, documentKind: 'award', preview: { glance: {}, reviewCount: 0, figures: 0 } }) as unknown as AnalyzeResult;
const full = (id: string | null, readAt: string) =>
  ({ analysisId: id, document: { readAt } }) as unknown as AnalyzeResult;

describe('isFreshRead', () => {
  it('accepts the read this upload produced', () => {
    expect(isFreshRead(preview('b', '2026-10-16T12:00:40Z'), preview('a', '2026-10-10T09:00:00Z'), started)).toBe(true);
    expect(isFreshRead(full('b', '2026-10-16T12:00:40Z'), null, started)).toBe(true);
  });

  it('refuses the read that was already there before the upload', () => {
    expect(isFreshRead(preview('a', '2026-10-16T12:00:40Z'), preview('a', '2026-10-16T12:00:40Z'), started)).toBe(false);
    expect(isFreshRead(full('a', '2026-10-16T12:00:40Z'), preview('a', '2026-10-16T12:00:40Z'), started)).toBe(false);
  });

  it('refuses a read older than the upload, beyond clock room', () => {
    expect(isFreshRead(preview('b', '2026-10-16T11:57:59Z'), null, started)).toBe(false);
    expect(isFreshRead(preview('b', '2026-10-16T11:58:30Z'), null, started)).toBe(true);
  });

  it('refuses nothing, a read without an id, and an unreadable date', () => {
    expect(isFreshRead(null, null, started)).toBe(false);
    expect(isFreshRead(preview(null, '2026-10-16T12:00:40Z'), null, started)).toBe(false);
    expect(isFreshRead(preview('b', 'yesterday'), null, started)).toBe(false);
  });
});
