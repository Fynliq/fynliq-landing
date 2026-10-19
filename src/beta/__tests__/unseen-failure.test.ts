import { describe, expect, it } from 'vitest';
import { AnalysisError, unseenUploadFailure } from '../analyzer';

// The browser reports only upload failures the server never saw; anything the
// reader answered is already recorded server-side (analysis_failed,
// upload_failed with a reason code, or analysis_completed).
describe('unseenUploadFailure', () => {
  it('reports failures on the device and requests that never got an answer', () => {
    expect(unseenUploadFailure(new AnalysisError('x', 'rejected', 'device'))).toBe('device_unreadable');
    expect(unseenUploadFailure(new AnalysisError('x', 'network', 'transit'))).toBe('offline');
    expect(unseenUploadFailure(new TypeError('boom'))).toBe('client');
  });

  it('does not report anything the server answered (no double counting)', () => {
    expect(unseenUploadFailure(new AnalysisError('5xx', 'network'))).toBeNull(); // HTTP 5xx: server recorded analysis_failed
    expect(unseenUploadFailure(new AnalysisError('4xx', 'rejected'))).toBeNull(); // server recorded upload_failed
    expect(unseenUploadFailure(new AnalysisError('bad json', 'format'))).toBeNull(); // server recorded analysis_completed
  });

  it('ignores cancellations and the unlock step', () => {
    expect(unseenUploadFailure(new AnalysisError('x', 'cancelled', 'device'))).toBeNull();
    expect(unseenUploadFailure(new AnalysisError('x', 'unlock_required'))).toBeNull();
  });

  it('server is the default origin, so existing call sites never over-report', () => {
    expect(new AnalysisError('x', 'network').origin).toBe('server');
  });
});
