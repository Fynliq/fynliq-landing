import { afterEach, describe, expect, it, vi } from 'vitest';
import { isLocked, onUnlockJourney, parseStatus, startCheckout } from '../client';

afterEach(() => { vi.unstubAllGlobals(); });

describe('billing status', () => {
  it('accepts only the documented shape', () => {
    expect(parseStatus({ paywallEnabled: true, access: 'locked' })).toEqual({ paywallEnabled: true, access: 'locked', price: undefined });
    expect(parseStatus({ paywallEnabled: true, access: 'paid' })).toBeNull();
    expect(parseStatus(null)).toBeNull();
  });

  it('is locked only when the paywall is on and the server says locked', () => {
    expect(isLocked({ paywallEnabled: true, access: 'locked' })).toBe(true);
    for (const access of ['open', 'grandfathered', 'premium', 'test_account'] as const) expect(isLocked({ paywallEnabled: true, access })).toBe(false);
    expect(isLocked({ paywallEnabled: false, access: 'locked' })).toBe(false);
    expect(isLocked(null)).toBe(false);
  });

  it('shows the four-step Unlock flow only to post-cutoff accounts', () => {
    expect(onUnlockJourney({ paywallEnabled: true, access: 'locked' })).toBe(true);
    expect(onUnlockJourney({ paywallEnabled: true, access: 'premium' })).toBe(true);
    for (const access of ['open', 'grandfathered', 'test_account'] as const) expect(onUnlockJourney({ paywallEnabled: true, access })).toBe(false);
    expect(onUnlockJourney({ paywallEnabled: false, access: 'premium' })).toBe(false);
    expect(onUnlockJourney(null)).toBe(false);
  });
});

describe('checkout', () => {
  it('only follows Stripe-hosted checkout URLs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ url: 'https://evil.example/pay' }) })));
    await expect(startCheckout()).rejects.toThrow();
  });
});
