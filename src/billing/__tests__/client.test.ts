import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isLocked, onUnlockJourney, parseStatus, readBillingStatus, rememberUnlockSurface, startCheckout, takeUnlockSurface, waitForUnlock,
} from '../client';

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

describe('the return from Stripe', () => {
  const ENDPOINT = '/api/billing';
  const reply = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

  it('tells "not logged in here" apart from "could not tell"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(401)));
    expect(await readBillingStatus(undefined, ENDPOINT)).toEqual({ status: null, signedOut: true });
    vi.stubGlobal('fetch', vi.fn(async () => reply(503)));
    expect(await readBillingStatus(undefined, ENDPOINT)).toEqual({ status: null, signedOut: false });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(await readBillingStatus(undefined, ENDPOINT)).toEqual({ status: null, signedOut: false });
  });

  it('stops waiting at once when signed out, instead of polling for ten minutes', async () => {
    const fetchMock = vi.fn(async () => reply(401));
    vi.stubGlobal('fetch', fetchMock);
    const onSignedOut = vi.fn();
    const unlocked = await waitForUnlock({ endpoint: ENDPOINT, intervalMs: 5, timeoutMs: 60000, onSignedOut }).done;
    expect(unlocked).toBe(false);
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps waiting through a server hiccup and resolves once the webhook has unlocked the account', async () => {
    const answers = [reply(503), reply(200, { paywallEnabled: true, access: 'locked' }), reply(200, { paywallEnabled: true, access: 'premium' })];
    vi.stubGlobal('fetch', vi.fn(async () => answers.shift() ?? reply(200, { paywallEnabled: true, access: 'premium' })));
    const onSignedOut = vi.fn();
    expect(await waitForUnlock({ endpoint: ENDPOINT, intervalMs: 5, onSignedOut }).done).toBe(true);
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it('remembers where the unlock was asked for, once, and never trusts an unknown value', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', { sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } } });
    rememberUnlockSurface('ask');
    expect(takeUnlockSurface()).toBe('ask');
    expect(takeUnlockSurface()).toBeNull();
    store.set('fynliq:unlock-from', '/admin');
    expect(takeUnlockSurface()).toBeNull();
  });

  it('works without storage (blocked or private mode): no surface, no error', () => {
    vi.stubGlobal('window', { get sessionStorage() { throw new Error('blocked'); } });
    expect(() => rememberUnlockSurface('search')).not.toThrow();
    expect(takeUnlockSurface()).toBeNull();
  });
});
