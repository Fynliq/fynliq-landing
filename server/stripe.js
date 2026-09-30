// Minimal Stripe client for the FYNQ Beta Unlock.
//
// Two things only: create a Checkout Session over Stripe's REST API, and
// verify a webhook signature. Written against the documented HTTP contract
// rather than the `stripe` npm package so the billing surface is small,
// dependency-free and fully readable in review:
//   https://docs.stripe.com/api/checkout/sessions/create
//   https://docs.stripe.com/webhooks#verify-manually
//
// Nothing here ever sees document text or aid figures. Secrets stay on the
// server: this file is imported only by /api functions.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const STRIPE_API = 'https://api.stripe.com/v1';

export class StripeError extends Error {
  constructor(message, status = 502) { super(message); this.name = 'StripeError'; this.status = status; }
}
export class StripeSignatureError extends Error {
  constructor(message) { super(message); this.name = 'StripeSignatureError'; }
}

/** 'test' | 'live' | null, from a secret or restricted key's prefix. */
export function keyMode(key) {
  if (typeof key !== 'string') return null;
  if (/^(sk|rk)_test_[A-Za-z0-9]+$/.test(key)) return 'test';
  if (/^(sk|rk)_live_[A-Za-z0-9]+$/.test(key)) return 'live';
  return null;
}

/** Stripe's form encoding: nested objects become `a[b][c]=v`, arrays `a[0]`. */
export function formEncode(params, prefix = '') {
  const pairs = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === 'object') pairs.push(formEncode(value, name));
    else pairs.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
  }
  return pairs.filter(Boolean).join('&');
}

export async function stripeRequest({ secretKey, method = 'POST', path, params, idempotencyKey, fetchImpl = fetch }) {
  const headers = {
    Authorization: `Bearer ${secretKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Stripe-Version': '2024-06-20',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  let response;
  try {
    response = await fetchImpl(`${STRIPE_API}${path}`, {
      method, headers, body: params ? formEncode(params) : undefined, signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new StripeError('Stripe could not be reached.');
  }
  let body = null;
  try { body = await response.json(); } catch { /* handled below */ }
  if (!response.ok || !body) {
    // Stripe error bodies never contain student content, but keep the log to
    // the type/code anyway.
    console.error('Stripe request failed:', JSON.stringify({ status: response.status, type: body?.error?.type ?? null, code: body?.error?.code ?? null }));
    throw new StripeError('Stripe did not accept the request.');
  }
  return body;
}

/**
 * Verifies a `Stripe-Signature` header against the RAW request body.
 * Throws StripeSignatureError on anything wrong; returns the parsed event.
 */
export function verifyStripeEvent(rawBody, header, secret, { toleranceSeconds = 300, now = Date.now() } = {}) {
  if (typeof secret !== 'string' || !secret.startsWith('whsec_')) throw new StripeSignatureError('Webhook secret is not configured.');
  if (typeof header !== 'string' || header.length > 2000) throw new StripeSignatureError('Missing signature.');
  const payload = Buffer.isBuffer(rawBody) ? rawBody : typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : null;
  if (!payload || payload.length > 512 * 1024) throw new StripeSignatureError('Invalid payload.');

  let timestamp = null;
  const signatures = [];
  for (const part of header.split(',')) {
    const [k, v] = part.split('=');
    if (k === 't' && /^\d{1,12}$/.test(v || '')) timestamp = Number(v);
    if (k === 'v1' && /^[a-f0-9]{64}$/.test(v || '')) signatures.push(Buffer.from(v, 'hex'));
  }
  if (timestamp === null || !signatures.length) throw new StripeSignatureError('Malformed signature.');
  if (Math.abs(now / 1000 - timestamp) > toleranceSeconds) throw new StripeSignatureError('Signature timestamp outside tolerance.');

  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(payload).digest();
  if (!signatures.some((s) => s.length === expected.length && timingSafeEqual(s, expected))) {
    throw new StripeSignatureError('Signature mismatch.');
  }
  let event;
  try { event = JSON.parse(payload.toString('utf8')); } catch { throw new StripeSignatureError('Invalid JSON.'); }
  if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') throw new StripeSignatureError('Invalid event.');
  return event;
}

/** Test helper and documentation of the scheme: builds a valid header. */
export function signStripePayload(payload, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}
