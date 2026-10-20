import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTIVITY_ENDPOINT, flushEvents, installErrorTracking, pendingEventsForTest, resetEventsForTest, trackEvent } from '../events';

afterEach(() => {
  resetEventsForTest();
  vi.useRealTimers();
});

describe('trackEvent', () => {
  it('does nothing unless enabled (previews and local development never send)', () => {
    trackEvent('my_aid_viewed', undefined, { enabled: false });
    expect(pendingEventsForTest()).toHaveLength(0);
  });

  it('fires a "once" event at most once per page, however often a component renders', () => {
    for (let i = 0; i < 5; i++) trackEvent('my_aid_viewed', undefined, { once: 'page', enabled: true });
    expect(pendingEventsForTest()).toHaveLength(1);
  });

  it('batches events and sends them same-origin with keepalive; each has its own id for de-duplication', () => {
    const send = vi.fn(async () => new Response('{}'));
    trackEvent('upload_started', undefined, { enabled: true });
    trackEvent('results_viewed', { view: 'preview' }, { enabled: true });
    flushEvents(send as unknown as typeof fetch);
    expect(send).toHaveBeenCalledTimes(1);
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(ACTIVITY_ENDPOINT);
    expect(init.keepalive).toBe(true);
    expect(init.credentials).toBe('same-origin');
    const body = JSON.parse(String(init.body));
    expect(body.events.map((e: { name: string }) => e.name)).toEqual(['upload_started', 'results_viewed']);
    expect(new Set(body.events.map((e: { id: string }) => e.id)).size).toBe(2);
    expect(pendingEventsForTest()).toHaveLength(0);
  });

  it('never throws, even when the network does', () => {
    const send = vi.fn(() => { throw new Error('offline'); });
    trackEvent('upload_failed', { reason: 'network' }, { enabled: true });
    expect(() => flushEvents(send as unknown as typeof fetch)).not.toThrow();
    const rejecting = vi.fn(async () => { throw new Error('offline'); });
    trackEvent('upload_failed', { reason: 'network' }, { enabled: true });
    expect(() => flushEvents(rejecting as unknown as typeof fetch)).not.toThrow();
  });
});

describe('installErrorTracking', () => {
  function fakeWindow(pathname: string) {
    const listeners: Record<string, (e: unknown) => void> = {};
    const target = { location: { pathname }, addEventListener: (type: string, fn: (e: unknown) => void) => { listeners[type] = fn; } } as unknown as Window;
    return { target, listeners };
  }

  it('reports the error type, our bundle file and an allow-listed route; never the message', () => {
    const sent: unknown[] = [];
    const { target, listeners } = fakeWindow('/beta');
    installErrorTracking(target, (p) => (p === '/beta' ? '/beta' : null), (_n, m) => sent.push(m));
    listeners.error({ error: new TypeError('Cannot read Jordan Testcase SSN 123-45-6789'), filename: 'https://www.fynliq.com/assets/index-Ab12.js?v=1' });
    expect(sent).toEqual([{ error_name: 'TypeError', source_file: 'index-Ab12.js', path: '/beta' }]);
    expect(JSON.stringify(sent)).not.toMatch(/Jordan|123-45/);
  });

  it('ignores third-party script files and unknown routes, and caps reports per page', () => {
    const sent: unknown[] = [];
    const { target, listeners } = fakeWindow('/search/some-private-question');
    installErrorTracking(target, () => null, (_n, m) => sent.push(m));
    for (let i = 0; i < 20; i++) listeners.unhandledrejection({ reason: { name: 'Weird Name!' } });
    listeners.error({ error: new Error('x'), filename: 'https://evil.example/tracker.js' });
    expect(sent).toHaveLength(5);
    expect(sent[0]).toEqual({ error_name: 'Error' });
  });
});
