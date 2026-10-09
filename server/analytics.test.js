import { describe, expect, it } from 'vitest';
import { EVENTS, CLIENT_EVENT_NAMES, buildEvent, classifyUserAgent, recordEvents, sanitizeMetadata } from './analytics.js';

const USER = '11111111-1111-4111-8111-111111111111';
const GUEST = '22222222-2222-4222-8222-222222222222';
const NOW = Date.parse('2026-10-08T12:00:00Z');

describe('canonical event names', () => {
  it('browsers may only send browser-side events: never sign-ups, logins, analyses or payments', () => {
    for (const serverOnly of ['signup_completed', 'login_completed', 'login_failed', 'upload_completed', 'analysis_started',
      'analysis_completed', 'analysis_failed', 'checkout_started', 'payment_completed', 'payment_failed', 'unlock_verified',
      'landing_view', 'return_session']) {
      expect(CLIENT_EVENT_NAMES).not.toContain(serverOnly);
    }
    expect(buildEvent('payment_completed', { userId: USER, side: 'client', key: 'cs_test_x' })).toBeNull();
    expect(buildEvent('not_an_event', { userId: USER })).toBeNull();
  });

  it('every event the funnel needs exists', () => {
    for (const name of ['landing_view', 'signup_started', 'signup_completed', 'login_completed', 'upload_started', 'upload_completed',
      'upload_failed', 'analysis_started', 'analysis_completed', 'analysis_failed', 'results_viewed', 'checkout_viewed',
      'checkout_started', 'payment_completed', 'payment_failed', 'unlock_verified', 'return_session']) {
      expect(EVENTS[name], name).toBeTruthy();
    }
  });
});

describe('de-duplication keys', () => {
  it('signup is once per account, and impossible without one', () => {
    expect(buildEvent('signup_completed', { userId: USER }).dedupe_key).toBe(`u:${USER}`);
    expect(buildEvent('signup_completed', { guestId: GUEST })).toBeNull();
  });
  it('landing is once per person per UTC day', () => {
    const a = buildEvent('landing_view', { guestId: GUEST, now: NOW });
    const b = buildEvent('landing_view', { guestId: GUEST, now: NOW + 3600_000 });
    const c = buildEvent('landing_view', { guestId: GUEST, now: NOW + 86_400_000 });
    expect(a.dedupe_key).toBe(b.dedupe_key);
    expect(a.dedupe_key).not.toBe(c.dedupe_key);
  });
  it('money events are once per Stripe Checkout Session and need a valid key', () => {
    expect(buildEvent('payment_completed', { userId: USER, key: 'cs_test_abc123' }).dedupe_key).toBe('cs_test_abc123');
    expect(buildEvent('payment_completed', { userId: USER })).toBeNull();
    expect(buildEvent('payment_completed', { userId: USER, key: "x'; drop table" })).toBeNull();
  });
  it('a client event id is kept for retries; anything malformed gets a fresh id', () => {
    const id = '33333333-3333-4333-8333-333333333333';
    expect(buildEvent('upload_started', { guestId: GUEST, eventId: id, side: 'client' }).event_id).toBe(id);
    expect(buildEvent('upload_started', { guestId: GUEST, eventId: 'nope', side: 'client' }).event_id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('privacy', () => {
  it('metadata keeps only allow-listed keys and shapes', () => {
    expect(sanitizeMetadata({ view: 'preview', email: 'a@b.c', text: 'Pell $3,698', files: 9, ai_ms: 1234.6, reason: 'Has Spaces', second_pass: 'yes' }))
      .toEqual({ view: 'preview', files: 3, ai_ms: 1235 });
    expect(sanitizeMetadata(null)).toEqual({});
    expect(sanitizeMetadata(['x'])).toEqual({});
  });
  it('identity must be a UUID; the raw user agent is never kept', () => {
    const ev = buildEvent('upload_started', { userId: 'not-a-uuid', guestId: GUEST, userAgent: 'Mozilla/5.0 (iPhone) secret-build-123', side: 'client' });
    expect(ev.user_id).toBeNull();
    expect(JSON.stringify(ev)).not.toContain('secret-build');
  });
  it('test accounts are flagged so they never count', () => {
    expect(buildEvent('login_completed', { userId: USER, env: { FYNQ_BILLING_TEST_ACCOUNT_IDS: USER } }).is_test).toBe(true);
    expect(buildEvent('login_completed', { userId: USER, env: {} }).is_test).toBe(false);
  });
});

describe('device and browser buckets', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 musical_ly_36.0', 'mobile', 'tiktok'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Instagram 300.0', 'mobile', 'instagram'],
    ['Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36', 'mobile', 'chrome'],
    ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Safari/604.1', 'tablet', 'safari'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0', 'desktop', 'edge'],
    ['', 'unknown', 'other'],
  ])('%s', (ua, device, browser) => {
    expect(classifyUserAgent(ua)).toEqual({ device_type: device, browser });
  });
});

describe('failure is silent', () => {
  it('a failing, missing or hanging store stores nothing and never throws', async () => {
    const ev = buildEvent('landing_view', { guestId: GUEST });
    expect(await recordEvents(null, [ev])).toBe(0);
    expect(await recordEvents({ rpc: async () => ({ data: null, error: { message: 'down' } }) }, [ev])).toBe(0);
    expect(await recordEvents({ rpc: () => { throw new Error('boom'); } }, [ev])).toBe(0);
    const started = Date.now();
    expect(await recordEvents({ rpc: () => new Promise(() => {}) }, [ev], { timeoutMs: 50 })).toBe(0);
    expect(Date.now() - started).toBeLessThan(1000);
  });
  it('null events (not allowed) are skipped and at most 25 are sent', async () => {
    let sent;
    await recordEvents({ rpc: async (_n, args) => { sent = args.p_events; return { data: sent.length, error: null }; } },
      [null, ...Array.from({ length: 40 }, () => buildEvent('landing_view', { guestId: GUEST }))]);
    expect(sent.length).toBe(25);
  });
});
