/**
 * The browser side of the FYNQ Beta Unlock.
 *
 * Everything that matters is decided on the server: whether this account is
 * grandfathered, whether it has paid, whether the analysis endpoint will run.
 * This file only asks, and turns the answers into the My Aid flow. Nothing
 * here can unlock anything — a success URL, a query string or a stored flag
 * in this browser is never treated as proof of payment.
 */

export type Access = 'open' | 'grandfathered' | 'premium' | 'test_account' | 'locked';

export interface BillingStatus {
  paywallEnabled: boolean;
  access: Access;
  price?: { amount: number; currency: string; label: string };
}

export type FunnelEvent = 'my_aid_entered' | 'paywall_viewed' | 'preflight_completed'
  | 'my_aid_page_view' | 'aid_upload_started' | 'aid_upload_completed' | 'aid_preview_viewed' | 'unlock_button_clicked' | 'full_analysis_viewed'
  | 'checkout_return_viewed' | 'checkout_cancelled' | 'unlock_confirmed_viewed';

/**
 * Where an unlock was asked for. A label for the funnel and for where to go
 * once Stripe confirms — never proof of anything; the server decides access.
 */
export type UnlockSurface = 'my_aid_preview' | 'my_aid' | 'ask' | 'search' | 'earn';
const SURFACES: readonly UnlockSurface[] = ['my_aid_preview', 'my_aid', 'ask', 'search', 'earn'];
const SURFACE_KEY = 'fynliq:unlock-from';

/** Remembers, for this tab only, which screen sent the student to Stripe. */
export function rememberUnlockSurface(surface: UnlockSurface): void {
  try { window.sessionStorage.setItem(SURFACE_KEY, surface); } catch { /* storage blocked: fall back to My Aid */ }
}

/** The screen that sent the student to Stripe, once. `null` when unknown. */
export function takeUnlockSurface(): UnlockSurface | null {
  try {
    const value = window.sessionStorage.getItem(SURFACE_KEY);
    window.sessionStorage.removeItem(SURFACE_KEY);
    return SURFACES.includes(value as UnlockSurface) ? (value as UnlockSurface) : null;
  } catch {
    return null;
  }
}

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
  return (await readBillingStatus(signal, endpoint)).status;
}

/**
 * The status, plus whether the server said this browser is not logged in.
 * After Stripe, "not logged in" is not worth polling for: the payment is
 * safe, but this browser cannot see it until the student logs in.
 */
export async function readBillingStatus(
  signal?: AbortSignal, endpoint = BILLING_ENDPOINT,
): Promise<{ status: BillingStatus | null; signedOut: boolean }> {
  if (!endpoint) return { status: OPEN, signedOut: false };
  try {
    const response = await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store', signal, headers: { Accept: 'application/json' } });
    if (response.status === 401) return { status: null, signedOut: true };
    if (!response.ok) return { status: null, signedOut: false };
    return { status: parseStatus(await response.json()), signedOut: false };
  } catch {
    return { status: null, signedOut: false };
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
export async function startCheckout(surface?: UnlockSurface): Promise<{ url?: string; unlocked?: boolean }> {
  const result = await post<{ url?: unknown; unlocked?: unknown }>(surface ? { action: 'checkout', surface } : { action: 'checkout' });
  if (result.unlocked === true) return { unlocked: true };
  if (typeof result.url === 'string' && result.url.startsWith('https://checkout.stripe.com/')) return { url: result.url };
  throw new CheckoutError('Payments are not available right now. Please try again in a moment.');
}

/** Content-free funnel step. Never waits, never fails the flow. */
export function trackFunnel(event: FunnelEvent, surface?: UnlockSurface): void {
  if (!BILLING_ENDPOINT) return;
  void post(surface ? { action: 'track', event, surface } : { action: 'track', event }).catch(() => {});
}

/**
 * Polls the server until this account is no longer locked (the Stripe
 * webhook has activated the entitlement). Resolves true when unlocked, false
 * on timeout or abort. `poke` checks again immediately.
 */
export function waitForUnlock(
  { signal, intervalMs = 2000, timeoutMs = 10 * 60 * 1000, onSignedOut, endpoint = BILLING_ENDPOINT }:
    { signal?: AbortSignal; intervalMs?: number; timeoutMs?: number; onSignedOut?: () => void; endpoint?: string } = {},
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
      const { status, signedOut } = await readBillingStatus(signal, endpoint);
      busy = false;
      if (signal?.aborted) return finish(false);
      if (status && !isLocked(status)) return finish(true);
      // Ten minutes of "confirming…" helps nobody who is simply not logged in
      // here (the return opened in another browser, or the session ended).
      if (signedOut) { onSignedOut?.(); return finish(false); }
      if (Date.now() - started > timeoutMs) return finish(false);
      timer = setTimeout(check, intervalMs);
    };
    signal?.addEventListener('abort', () => finish(false), { once: true });
    poke = () => { void check(); };
    void check();
  });
  return { done, poke };
}
