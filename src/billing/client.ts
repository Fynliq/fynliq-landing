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
  /** The server can hold the redacted read while this tab visits Stripe. */
  sameTabCheckout?: boolean;
}

export type FunnelEvent = 'my_aid_entered' | 'preflight_completed' | 'paywall_viewed';

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
    sameTabCheckout: v.sameTabCheckout === true,
    price: v.price && typeof v.price === 'object' ? (v.price as BillingStatus['price']) : undefined,
  };
}

/** Needs the unlock before premium analysis can run. */
export const isLocked = (status: BillingStatus | null) => status?.paywallEnabled === true && status.access === 'locked';

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

/** Content-free funnel step. Never waits, never fails the flow. */
export function trackFunnel(event: FunnelEvent): void {
  if (!BILLING_ENDPOINT) return;
  void post({ action: 'track', event }).catch(() => {});
}

// ------------------------------------------------------------- waiting

/**
 * Polls the server until this account is no longer locked (the Stripe
 * webhook has activated the entitlement). Resolves true when unlocked, false
 * on timeout or abort. `poke` checks immediately, e.g. when the Stripe tab
 * reports back or this tab regains focus.
 */
export function waitForUnlock(
  { signal, intervalMs = 3000, timeoutMs = 35 * 60 * 1000 }: { signal?: AbortSignal; intervalMs?: number; timeoutMs?: number } = {},
): { done: Promise<boolean>; poke: () => void } {
  let poke = () => {};
  const done = new Promise<boolean>((resolve) => {
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    const finish = (value: boolean) => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      resolve(value);
    };
    const check = async () => {
      if (busy) return;
      busy = true;
      clearTimeout(timer);
      if (signal?.aborted) return finish(false);
      const status = await getBillingStatus(signal);
      busy = false;
      if (signal?.aborted) return finish(false);
      if (status && !isLocked(status)) return finish(true);
      if (Date.now() - started > timeoutMs) return finish(false);
      timer = setTimeout(check, document.visibilityState === 'visible' ? intervalMs : intervalMs * 3);
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', onVisible);
    signal?.addEventListener('abort', () => finish(false), { once: true });
    poke = () => { void check(); };
    timer = setTimeout(check, intervalMs);
  });
  return { done, poke };
}

// ---------------------------------------------------- Checkout windows

/**
 * Phones and tablets go to Stripe in this tab (the server keeps the redacted
 * read for up to 30 minutes); a desktop opens Stripe in a new tab and this
 * page keeps the read in memory.
 */
export function prefersSameTab(): boolean {
  try {
    const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
    return (
      window.matchMedia('(pointer: coarse)').matches ||
      window.matchMedia('(hover: none)').matches ||
      nav.userAgentData?.mobile === true ||
      /Mobi|Android|iPhone|iPad|iPod/i.test(nav.userAgent)
    );
  } catch {
    return false;
  }
}

/**
 * Must run synchronously inside the click handler, or the browser blocks it.
 * The new tab is cut off from this page (`opener = null`) before it is sent to
 * Stripe, so the payment page can never script or redirect this one.
 */
export function openCheckoutTab(): Window | null {
  let tab: Window | null = null;
  try {
    tab = window.open('', 'fynq-checkout');
  } catch {
    return null;
  }
  if (!tab) return null;
  try {
    tab.opener = null;
    tab.document.title = 'Opening secure checkout — Fynliq';
    tab.document.body.style.cssText = 'font:16px system-ui,sans-serif;padding:40px;color:#1c1d1b;background:#fbfaf8';
    tab.document.body.textContent = 'Opening Stripe’s secure checkout…';
  } catch {
    /* cosmetic only */
  }
  return tab;
}

// ----------------------------------------------------- tab messaging

export type CheckoutMessage = { type: 'returned' } | { type: 'cancelled' } | { type: 'ack' };
const CHANNEL = 'fynq-checkout';

/** Messages between the My Aid tab and the tab Stripe returns to. Same origin only. */
export function checkoutChannel(onMessage: (message: CheckoutMessage) => void): { post: (m: CheckoutMessage) => void; close: () => void } {
  if (typeof BroadcastChannel === 'undefined') return { post: () => {}, close: () => {} };
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (event: MessageEvent) => {
    const type = (event.data as { type?: unknown } | null)?.type;
    if (type === 'returned' || type === 'cancelled' || type === 'ack') onMessage({ type });
  };
  return { post: (m) => channel.postMessage(m), close: () => channel.close() };
}

// ------------------------------------------------- same-tab fallback

/**
 * Option B: the redacted aid lines go to the server's encrypted, 30-minute
 * pending store (never a file, never a file name) so this tab can go to
 * Stripe and come back. The id is kept in this tab's sessionStorage — not in
 * a URL — and is useless without this account's session cookie.
 */
const PENDING_KEY = 'fynq.pending-analysis';

export interface PendingRef {
  id: string;
  expiresAt: string;
  documents: number;
}

export async function savePending(documents: { pages: string[] }[]): Promise<PendingRef> {
  const result = await post<{ pendingId?: unknown; expiresAt?: unknown; unlocked?: unknown }>({
    action: 'pending-save',
    consent: true,
    documents: documents.map((d) => ({ pages: d.pages })),
  });
  if (typeof result.pendingId !== 'string' || typeof result.expiresAt !== 'string') {
    throw new CheckoutError('Fynliq could not prepare checkout on this device. Please try again.');
  }
  const ref = { id: result.pendingId, expiresAt: result.expiresAt, documents: documents.length };
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(ref)); } catch { /* checked on return */ }
  return ref;
}

export function readPending(now = Date.now()): PendingRef | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const ref = JSON.parse(raw) as PendingRef;
    if (typeof ref?.id !== 'string' || !(Date.parse(ref.expiresAt) > now)) {
      sessionStorage.removeItem(PENDING_KEY);
      return null;
    }
    return ref;
  } catch {
    return null;
  }
}

export function forgetPending(discard = false): void {
  let ref: PendingRef | null = null;
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    ref = raw ? (JSON.parse(raw) as PendingRef) : null;
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* nothing stored */
  }
  if (discard && ref?.id) void post({ action: 'pending-discard', pendingId: ref.id }).catch(() => {});
}
