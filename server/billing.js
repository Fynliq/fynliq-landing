// FYNQ Beta Unlock: who may run premium My Aid analysis, and the $1 Stripe
// Checkout that unlocks it for accounts created after the cutoff.
//
// Access rule (server-side, authoritative):
//   PAYWALL_ENABLED is not exactly 'true'  -> open to everyone, as before
//   admin/test account                     -> allowed, excluded from metrics
//   accounts.created_at <= cutoff          -> grandfathered, never pays
//   active paid entitlement                -> unlocked
//   otherwise                              -> HTTP 402 beta_unlock_required
//
// The account is always the one on the httpOnly session cookie. Nothing a
// browser sends (an account id, a Stripe session id, a success URL) is ever
// taken as evidence of who is paying or whether they paid.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import { rpc, hash, BetaError } from './beta.js';
import { accountToken } from './account-login.js';
import { keyMode, stripeRequest } from './stripe.js';

export const DEFAULT_GRANDFATHER_CUTOFF = '2026-09-30T18:53:52.654622Z';
export const UNLOCK_PRICE = { amount: 100, currency: 'usd', label: '$1.00 — One-Time Beta Unlock' };
export const UNLOCK_REQUIRED = { code: 'beta_unlock_required', message: 'Unlock My Aid to continue.' };
export const PURPOSE = 'fynq_beta_unlock';
/** Funnel steps the browser may report. Everything else is recorded server-side. */
export const CLIENT_EVENTS = ['my_aid_entered', 'preflight_completed', 'paywall_viewed'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CUTOFF = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const PENDING_TTL_DEFAULT = 1800;

export class UnlockRequired extends Error {
  constructor() { super(UNLOCK_REQUIRED.message); this.name = 'UnlockRequired'; this.status = 402; }
}

// ------------------------------------------------------------------ config

export const paywallEnabled = (env = process.env) => env.PAYWALL_ENABLED === 'true';

export function grandfatherCutoff(env = process.env) {
  const value = env.FYNQ_BETA_GRANDFATHER_CUTOFF || DEFAULT_GRANDFATHER_CUTOFF;
  if (!CUTOFF.test(value) || Number.isNaN(Date.parse(value))) throw new BetaError(503, 'Billing is not configured safely.');
  return value;
}

/** Admin and test accounts: bypass payment, excluded from revenue and conversion. */
export function testAccountIds(env = process.env) {
  return new Set(
    `${env.FYNQ_BILLING_TEST_ACCOUNT_IDS || ''},${env.BETA_ADMIN_USER_IDS || ''}`
      .split(',').map((x) => x.trim().toLowerCase()).filter((x) => UUID.test(x)),
  );
}

/** Whether billing rows written now belong to Stripe live mode. */
export const livemode = (env = process.env) => keyMode(env.STRIPE_SECRET_KEY) === 'live';

export function stripeConfig(env = process.env) {
  const mode = keyMode(env.STRIPE_SECRET_KEY);
  if (!mode || !/^price_[A-Za-z0-9]+$/.test(env.STRIPE_PRICE_ID || '') || !env.BETA_ORIGIN) {
    throw new BetaError(503, 'Payments are not available right now. Please try again later.');
  }
  // A live key is refused unless the operator has deliberately opted in.
  if (mode === 'live' && env.STRIPE_ALLOW_LIVE_MODE !== 'true') {
    throw new BetaError(503, 'Payments are not available right now. Please try again later.');
  }
  return { secretKey: env.STRIPE_SECRET_KEY, priceId: env.STRIPE_PRICE_ID, origin: env.BETA_ORIGIN.replace(/\/+$/, ''), livemode: mode === 'live' };
}

// ------------------------------------------------------------------ access

/** The logged-in FYNQ account from the httpOnly cookie, or a 401. */
export async function currentAccount(req, db) {
  const value = accountToken(req);
  const row = value ? await rpc(db, 'account_session', { p_hash: hash(value) }) : null;
  if (!row?.user_id) throw new BetaError(401, 'Please log in to continue.');
  return { id: String(row.user_id).toLowerCase(), email: row.email };
}

/**
 * 'test_account' | 'grandfathered' | 'premium' | 'locked'.
 * Grandfathering is decided in Postgres from accounts.created_at, so the
 * cutoff keeps its microseconds.
 */
export async function resolveAccess(db, account, env = process.env) {
  const testAccount = testAccountIds(env).has(account.id);
  const row = await rpc(db, 'billing_access', { p_user: account.id, p_cutoff: grandfatherCutoff(env) });
  if (!row?.account) throw new BetaError(401, 'Please log in to continue.');
  const access = testAccount ? 'test_account' : row.grandfathered ? 'grandfathered' : row.premium ? 'premium' : 'locked';
  return { access, testAccount, grandfathered: row.grandfathered === true, premium: row.premium === true };
}

/**
 * The gate in front of premium analysis. With the paywall off this touches
 * nothing and returns 'open', so FYNQ behaves exactly as it did before.
 */
export async function analysisAccess(req, env = process.env, dependencies = {}) {
  if (!paywallEnabled(env)) return { access: 'open', account: null, db: null };
  const { db } = dependencies.clients(env);
  const account = await currentAccount(req, db);
  const result = await resolveAccess(db, account, env);
  if (result.access === 'locked') throw new UnlockRequired();
  return { ...result, account, db };
}

/** Best effort: a funnel event must never break a student's flow. */
export async function track(db, account, event, env = process.env, testAccount = testAccountIds(env).has(account.id)) {
  try {
    await rpc(db, 'billing_track', { p_user: account.id, p_event: event, p_livemode: livemode(env), p_test: testAccount });
  } catch { /* metrics only */ }
}

// ---------------------------------------------------------------- checkout

/**
 * Starts (or reuses) the one-time $1 Checkout Session for this account.
 * The caller has already established the account is locked.
 */
export async function createCheckout(db, account, env = process.env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const config = stripeConfig(env);
  const testAccount = testAccountIds(env).has(account.id);

  const open = await rpc(db, 'billing_open_checkout', { p_user: account.id, p_livemode: config.livemode });
  if (open?.url) return { url: open.url, reused: true };

  // Double clicks inside one five-minute window map to one Stripe session via
  // the idempotency key; the parameters are identical within the window.
  const windowStart = Math.floor(now / 300000) * 300000;
  const expiresAt = Math.floor(windowStart / 1000) + 36 * 60;
  let session;
  try {
    session = await stripeRequest({
    secretKey: config.secretKey,
    path: '/checkout/sessions',
    idempotencyKey: `fynq-beta-unlock:${account.id}:${windowStart}`,
    fetchImpl,
    params: {
      mode: 'payment',
      line_items: [{ price: config.priceId, quantity: 1 }],
      // Account identifiers only. Never document text or aid figures.
      client_reference_id: account.id,
      metadata: { fynq_account_id: account.id, purpose: PURPOSE },
      payment_intent_data: { metadata: { fynq_account_id: account.id, purpose: PURPOSE }, description: 'FYNQ Beta Unlock' },
      customer_email: account.email || undefined,
      submit_type: 'pay',
      success_url: `${config.origin}/beta/checkout?result=success`,
      cancel_url: `${config.origin}/beta/checkout?result=cancelled`,
      expires_at: expiresAt,
    },
    });
  } catch {
    throw new BetaError(502, 'Payments are not available right now. Please try again in a moment.');
  }
  if (typeof session?.id !== 'string' || typeof session.url !== 'string' || !session.url.startsWith('https://checkout.stripe.com/')) {
    throw new BetaError(502, 'Payments are not available right now. Please try again later.');
  }
  if (session.livemode !== config.livemode) throw new BetaError(503, 'Payments are not available right now. Please try again later.');
  await rpc(db, 'billing_checkout_created', {
    p_session: session.id, p_user: account.id, p_livemode: config.livemode, p_test: testAccount,
    p_url: session.url, p_expires: new Date(expiresAt * 1000).toISOString(),
  });
  return { url: session.url, reused: false };
}

// -------------------------------------------------------- pending analysis
//
// Fallback for browsers that cannot keep the My Aid tab alive while Stripe
// Checkout is open (popup blocked, most phones). Only the already-redacted
// aid lines are kept, never an original file and never a file name,
// encrypted with AES-256-GCM under a server-only key, bound to the account
// and pending id, for at most 30 minutes.

function pendingKey(env) {
  const secret = env.FYNQ_PENDING_ANALYSIS_KEY;
  if (typeof secret !== 'string' || secret.length < 32) throw new BetaError(503, 'This checkout option is not available. Please try again on a computer.');
  return Buffer.from(hkdfSync('sha256', secret, 'fynq-pending-analysis', 'aid-lines-v1', 32));
}

export function pendingTtl(env = process.env) {
  const n = Number(env.FYNQ_PENDING_ANALYSIS_TTL_SECONDS || PENDING_TTL_DEFAULT);
  return Number.isInteger(n) ? Math.min(1800, Math.max(60, n)) : PENDING_TTL_DEFAULT;
}

export function sealPending(pages, accountId, id, env = process.env) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', pendingKey(env), iv);
  cipher.setAAD(Buffer.from(`${id}:${accountId}`));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ v: 1, documents: pages.map((p) => ({ pages: p })) }), 'utf8'), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

export function openPending(row, accountId, id, env = process.env) {
  const decipher = createDecipheriv('aes-256-gcm', pendingKey(env), Buffer.from(row.iv, 'base64'));
  decipher.setAAD(Buffer.from(`${id}:${accountId}`));
  decipher.setAuthTag(Buffer.from(row.tag, 'base64'));
  const plain = Buffer.concat([decipher.update(Buffer.from(row.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  const data = JSON.parse(plain);
  if (data?.v !== 1 || !Array.isArray(data.documents)) throw new Error('Invalid pending payload');
  return data.documents;
}

export async function savePending(db, account, redactedPages, env = process.env) {
  const id = randomUUID();
  const sealed = sealPending(redactedPages, account.id, id, env);
  const expiresAt = await rpc(db, 'billing_pending_save', {
    p_id: id, p_user: account.id, p_ciphertext: sealed.ciphertext, p_iv: sealed.iv, p_tag: sealed.tag,
    p_documents: redactedPages.length, p_ttl_seconds: pendingTtl(env),
  });
  return { pendingId: id, expiresAt: new Date(expiresAt).toISOString() };
}

export async function loadPending(db, account, id, env = process.env) {
  if (typeof id !== 'string' || !UUID.test(id)) return null;
  const row = await rpc(db, 'billing_pending_load', { p_id: id, p_user: account.id });
  if (!row) return null;
  try { return openPending(row, account.id, id, env); } catch { return null; }
}

export async function deletePending(db, account, id) {
  if (typeof id !== 'string' || !UUID.test(id)) return;
  try { await rpc(db, 'billing_pending_delete', { p_id: id, p_user: account.id }); } catch { /* expires on its own */ }
}
