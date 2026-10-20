/**
 * The browser side of the FYNQ Beta Unlock.
 *
 * Everything that matters is decided on the server: whether this account is
 * grandfathered, whether it has paid, whether the analysis endpoint will run.
 * This file only asks, and turns the answers into the My Aid flow. Nothing
 * here can unlock anything — a success URL, a query string or a stored flag
 * in this browser is never treated as proof of payment.
 */

import { trackEvent } from '../analytics/events';

export type Access = 'open' | 'grandfathered' | 'premium' | 'test_account' | 'locked';

export interface BillingStatus {
  paywallEnabled: boolean;
  access: Access;
  price?: { amount: number; currency: string; label: string };
}

export type FunnelEvent = 'my_aid_entered' | 'paywall_viewed' | 'preflight_completed'
  | 'my_aid_page_view' | 'aid_upload_started' | 'aid_upload_completed' | 'aid_preview_viewed' | 'unlock_button_clicked' | 'full_analysis_viewed';

/** Unset in local development: the paywall is simply off there. */
export const BILLING_ENDPOINT: string | undefined =
  import.meta.env.VITE_FYNLIQ_BILLING_URL || (import.meta.env.PROD ? '/api/billing' : undefined);

const OPEN: BillingStatus = { paywallEnabled: false, access: 'open' };

export class CheckoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckoutError';
  }
}

const ACCESS: readonly Access[] = ['open', 'grandfathered', 'premium', 'test_account', 'locked'];

export function parseStatus(value: unknown): BillingStatus | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.paywallEnabled !== 'boolean' || !ACCESS.includes(v.access as Access)) return null;
  return {
    paywallEnabled: v.paywallEnabled,
    access: v.access as Access,
    price: v.price && typeof v.price === 'object' ? (v.price as BillingStatus['price']) : undefined,
  };
}

/** Needs the unlock before premium analysis can run. */
export const isLocked = (status: BillingStatus | null) => status?.paywallEnabled === true && status.access === 'locked';

/**
 * On the unlock journey: an account created after the cutoff, locked or
 * already paid. These accounts see the four-step flow that starts at Unlock;
 * grandfathered and test accounts keep the original three steps.
 */
export const onUnlockJourney = (status: BillingStatus | null) =>
  status?.paywallEnabled === true && (status.access === 'locked' || status.access === 'premium');

/**
 * Where this account stands. `null` means "could not tell" — the flow then
 * behaves as it always did, and the server's 402 is still the backstop.
 */
export async function getBillingStatus(signal?: AbortSignal, endpoint = BILLING_ENDPOINT): Promise<BillingStatus | null> {
  if (!endpoint) return OPEN;
  try {
    const response = await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store', signal, headers: { Accept: 'application/json' } });
    if (!response.ok) return null;
    return parseStatus(await response.json());
  } catch {
    return null;
  }
}

async function post<T>(body: unknown, endpoint = BILLING_ENDPOINT): Promise<T> {
  if (!endpoint) throw new CheckoutError('Payments are not available in this build.');
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new CheckoutError('Fynliq could not reach the payment service. Check your connection and try again.');
  }
  if (!response.ok) {
    const text = (await response.text().catch(() => '')).trim().slice(0, 200);
    throw new CheckoutError(text || 'Payments are not available right now. Please try again in a moment.');
  }
  return (await response.json()) as T;
}

/** A Stripe Checkout URL, or `unlocked` when this account needs no payment. */
export async function startCheckout(): Promise<{ url?: string; unlocked?: boolean }> {
  const result = await post<{ url?: unknown; unlocked?: unknown }>({ action: 'checkout' });
  if (result.unlocked === true) return { unlocked: true };
  if (typeof result.url === 'string' && result.url.startsWith('https://checkout.stripe.com/')) return { url: result.url };
  throw new CheckoutError('Payments are not available right now. Please try again in a moment.');
}

/** The canonical analytics event for each billing funnel step that has one. */
const CANONICAL: Partial<Record<FunnelEvent, () => void>> = {
  my_aid_page_view: () => trackEvent('my_aid_viewed', undefined, { once: 'page' }),
  aid_upload_started: () => trackEvent('upload_started'),
  aid_preview_viewed: () => trackEvent('results_viewed', { view: 'preview' }),
  full_analysis_viewed: () => trackEvent('results_viewed', { view: 'full' }),
  paywall_viewed: () => trackEvent('checkout_viewed', undefined, { once: 'page' }),
};

/**
 * Content-free funnel step. Never waits, never fails the flow.
 * The billing funnel (paywall accounts only) keeps its own record; the
 * canonical event is recorded for everyone (docs/analytics-events.md).
 */
export function trackFunnel(event: FunnelEvent): void {
  CANONICAL[event]?.();
  if (!BILLING_ENDPOINT) return;
  void post({ action: 'track', event }).catch(() => {});
}

/**
 * Polls the server until this account is no longer locked (the Stripe
 * webhook has activated the entitlement). Resolves true when unlocked, false
 * on timeout or abort. `poke` checks again immediately.
 */
export function waitForUnlock(
  { signal, intervalMs = 2000, timeoutMs = 10 * 60 * 1000 }: { signal?: AbortSignal; intervalMs?: number; timeoutMs?: number } = {},
): { done: Promise<boolean>; poke: () => void } {
  let poke = () => {};
  const done = new Promise<boolean>((resolve) => {
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const check = async () => {
      if (busy || settled) return;
      busy = true;
      clearTimeout(timer);
      const status = await getBillingStatus(signal);
      busy = false;
      if (signal?.aborted) return finish(false);
      if (status && !isLocked(status)) return finish(true);
      if (Date.now() - started > timeoutMs) return finish(false);
      timer = setTimeout(check, intervalMs);
    };
    signal?.addEventListener('abort', () => finish(false), { once: true });
    poke = () => { void check(); };
    void check();
  });
  return { done, poke };
}
