import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckoutError, checkoutFailure, isLocked, onUnlockJourney, parseStatus, startCheckout } from '../client';

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
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ url: 'https://evil.example/pay' }) }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(startCheckout('/api/billing')).rejects.toThrow(CheckoutError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('follows a Stripe-hosted checkout URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' }) })));
    await expect(startCheckout('/api/billing')).resolves.toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
  });

  it('never shows the student what the server sent back on a failure', async () => {
    const page = '<html><body>FUNCTION_INVOCATION_TIMEOUT iad1::abc</body></html>';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 504, text: async () => page })));
    const failure = await startCheckout('/api/billing').then(() => null, (thrown: Error) => thrown);
    expect(failure?.message).toBe(checkoutFailure(504));
    expect(failure?.message).not.toContain('FUNCTION');
  });

  it('chooses its words by status', () => {
    expect(checkoutFailure(401)).toMatch(/log in/);
    expect(checkoutFailure(429)).toMatch(/wait a minute/);
    for (const status of [500, 502, 503]) expect(checkoutFailure(status)).toMatch(/not been charged/);
  });
});
