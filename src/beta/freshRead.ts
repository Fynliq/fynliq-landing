import type { AnalyzeResult } from './analyzer';

/**
 * After an upload timed out, is the analysis the server has saved the one
 * from *this* upload?
 *
 * The read can finish on the server after the browser stopped waiting, and
 * reading it again would pay for the same AI call twice. But showing the
 * previous document's figures as if they were this one's would be worse than
 * asking for a retry, so a saved read only counts when it is not the one that
 * was there before the upload started, and is not older than the upload
 * (with a little room for the server's clock).
 */
const CLOCK_ROOM_MS = 2 * 60 * 1000;

function identity(result: AnalyzeResult): { id: string | null; readAt: string } {
  return 'locked' in result
    ? { id: result.analysisId, readAt: result.readAt }
    : { id: result.analysisId ?? null, readAt: result.document.readAt };
}

export function isFreshRead(saved: AnalyzeResult | null, before: AnalyzeResult | null, startedAt: number): boolean {
  if (!saved) return false;
  const now = identity(saved);
  if (now.id === null) return false;
  if (before && identity(before).id === now.id) return false;
  const readAt = Date.parse(now.readAt);
  return Number.isFinite(readAt) && readAt >= startedAt - CLOCK_ROOM_MS;
}
