import { describe, expect, it } from 'vitest';
import { AnalysisError, unseenUploadFailure } from '../analyzer';

// The browser reports only upload failures the server never saw. Answered
// requests are recorded server-side: analysis_failed (reader error 502),
// upload_failed with a reason code (422/400/413/429/503 refusals), or
// analysis_completed. A reply the browser couldn't use is the exception.
describe('unseenUploadFailure', () => {
  it('reports failures on the device and requests that never got an answer', () => {
    expect(unseenUploadFailure(new AnalysisError('x', 'rejected', 'device'))).toBe('device_unreadable');
    expect(unseenUploadFailure(new AnalysisError('x', 'network', 'transit'))).toBe('offline');
    expect(unseenUploadFailure(new TypeError('boom'))).toBe('client');
  });

  it('does not report anything the server answered (no double counting)', () => {
    expect(unseenUploadFailure(new AnalysisError('5xx', 'network'))).toBeNull(); // 502: server recorded analysis_failed
    expect(unseenUploadFailure(new AnalysisError('4xx', 'rejected'))).toBeNull(); // refusal: server recorded upload_failed
  });

  it('reports a reply the browser could not use (the server counted it as read)', () => {
    expect(unseenUploadFailure(new AnalysisError('bad json', 'format'))).toBe('bad_response');
  });

  it('ignores cancellations and the unlock step', () => {
    expect(unseenUploadFailure(new AnalysisError('x', 'cancelled', 'device'))).toBeNull();
    expect(unseenUploadFailure(new AnalysisError('x', 'unlock_required'))).toBeNull();
  });

  it('server is the default origin, so existing call sites never over-report', () => {
    expect(new AnalysisError('x', 'network').origin).toBe('server');
  });
});
