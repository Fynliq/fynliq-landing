import { afterEach, describe, expect, it, vi } from 'vitest';
import { isLocked, parseStatus, readPending, startCheckout } from '../client';
import { httpAnalyzer } from '../../beta/httpAnalyzer';
import { AnalysisError } from '../../beta/analyzer';
import { aidLinesLine } from '../../components/beta/Paywall/Paywall';

afterEach(() => { vi.unstubAllGlobals(); });

describe('billing status', () => {
  it('accepts only the documented shape', () => {
    expect(parseStatus({ paywallEnabled: true, access: 'locked', sameTabCheckout: true })).toEqual({ paywallEnabled: true, access: 'locked', sameTabCheckout: true, price: undefined });
    expect(parseStatus({ paywallEnabled: true, access: 'paid' })).toBeNull();
    expect(parseStatus(null)).toBeNull();
  });

  it('is locked only when the paywall is on and the server says locked', () => {
    expect(isLocked({ paywallEnabled: true, access: 'locked' })).toBe(true);
    for (const access of ['open', 'grandfathered', 'premium', 'test_account'] as const) expect(isLocked({ paywallEnabled: true, access })).toBe(false);
    expect(isLocked({ paywallEnabled: false, access: 'locked' })).toBe(false);
    expect(isLocked(null)).toBe(false);
  });
});

describe('pending reference', () => {
  it('is forgotten once expired', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
    store.set('fynq.pending-analysis', JSON.stringify({ id: 'a', expiresAt: new Date(Date.now() + 60000).toISOString(), documents: 2 }));
    expect(readPending()?.documents).toBe(2);
    expect(readPending(Date.now() + 120000)).toBeNull();
    expect(store.size).toBe(0);
  });
});

describe('checkout', () => {
  it('only follows Stripe-hosted checkout URLs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ url: 'https://evil.example/pay' }) })));
    await expect(startCheckout()).rejects.toThrow();
  });
});

describe('document reader 402', () => {
  it('turns the server paywall answer into an unlock_required error, without retrying', async () => {
    const call = vi.fn(async () => ({ ok: false, status: 402, json: async () => ({ code: 'beta_unlock_required', message: 'Unlock My Aid to continue.' }) }));
    vi.stubGlobal('fetch', call);
    const analyzer = httpAnalyzer('/api/analyze');
    const error = await analyzer.submit!({ prepared: { documents: [{ name: 'a.png', pages: ['Pell Grant $1,000'] }], withAidLines: 1 } }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AnalysisError);
    expect((error as AnalysisError).kind).toBe('unlock_required');
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('sends only a pending id after a same-tab checkout', async () => {
    const call = vi.fn(async () => ({ ok: false, status: 410, text: async () => 'expired' }));
    vi.stubGlobal('fetch', call);
    await httpAnalyzer('/api/analyze').submit!({ pendingId: 'abc' }).catch(() => {});
    const calls = call.mock.calls as unknown as [string, { body: string }][];
    expect(JSON.parse(calls[0][1].body)).toEqual({ consent: true, pendingId: 'abc' });
  });
});

describe('paywall copy', () => {
  it('describes what was found without figures', () => {
    expect(aidLinesLine(1, 1)).toBe('Financial-aid lines found in your document');
    expect(aidLinesLine(3, 3)).toBe('Financial-aid lines found in all 3 documents');
    expect(aidLinesLine(2, 3)).toBe('Financial-aid lines found in 2 of 3 documents');
  });
});
