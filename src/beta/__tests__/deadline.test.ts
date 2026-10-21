import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deadline } from '../deadline';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('deadline', () => {
  it('aborts once the time is up, and says so', () => {
    const d = deadline(1000);
    vi.advanceTimersByTime(999);
    expect(d.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(d.signal.aborted).toBe(true);
    expect(d.timedOut()).toBe(true);
  });

  it('follows a cancel, which is not a timeout', () => {
    const outer = new AbortController();
    const d = deadline(1000, outer.signal);
    outer.abort();
    expect(d.signal.aborted).toBe(true);
    expect(d.timedOut()).toBe(false);
  });

  it('is a cancel, not a timeout, when the student cancelled first', () => {
    const outer = new AbortController();
    const d = deadline(1000, outer.signal);
    outer.abort();
    vi.advanceTimersByTime(1000);
    expect(d.timedOut()).toBe(false);
  });

  it('starts aborted when the caller already gave up', () => {
    const outer = new AbortController();
    outer.abort();
    expect(deadline(1000, outer.signal).signal.aborted).toBe(true);
  });

  it('never fires after it is cleared', () => {
    const d = deadline(1000);
    d.clear();
    vi.advanceTimersByTime(5000);
    expect(d.signal.aborted).toBe(false);
    expect(d.timedOut()).toBe(false);
  });
});
