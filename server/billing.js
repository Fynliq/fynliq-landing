// FYNQ Beta Unlock: who may run premium My Aid analysis, and the $1 Stripe
// Checkout that unlocks it for accounts created after the cutoff.
//
// Access rule (server-side, authoritative):
//   PAYWALL_ENABLED is not exactly 'true'  -> open to everyone, as before
//   PAYWALL_PILOT_EMAILS set, not listed   -> open (the paywall only applies
//                                            to the listed test accounts)
//   admin/test account                     -> allowed, excluded from metrics
//   accounts.created_at <= cutoff          -> grandfathered, never pays
//   active paid entitlement                -> unlocked
//   otherwise                              -> HTTP 402 beta_unlock_required
//
// The account is always the one on the httpOnly session cookie. Nothing a
// browser sends (an account id, a Stripe session id, a success URL) is ever
// taken as evidence of who is paying or whether they paid.
import { rpc, hash, BetaError } from './beta.js';
import { accountToken } from './account-login.js';
import { keyMode, stripeRequest } from './stripe.js';
import { accountAttribution, stripeAttributionMetadata } from './attribution.js';

export const DEFAULT_GRANDFATHER_CUTOFF = '2026-09-30T18:53:52.654622Z';
export const UNLOCK_PRICE = { amount: 100, currency: 'usd', label: '$1.00 — One-Time Beta Unlock' };
export const UNLOCK_REQUIRED = { code: 'beta_unlock_required', message: 'Unlock My Aid to continue.' };
export const PURPOSE = 'fynq_beta_unlock';
/** Funnel steps the browser may report. Everything else is recorded server-side. */
export const CLIENT_EVENTS = [
  'my_aid_entered', 'paywall_viewed', 'preflight_completed',
  // Preview-before-pay funnel (content-free: event name, account, time only).
  'my_aid_page_view', 'aid_upload_started', 'aid_upload_completed', 'aid_preview_viewed', 'unlock_button_clicked', 'full_analysis_viewed',
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CUTOFF = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;

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

/**
 * Pilot mode: when PAYWALL_PILOT_EMAILS lists account emails, the paywall
 * applies to those accounts only and everybody else carries on as before.
 * This is how the whole flow is tried on the real site with Stripe test cards
 * before it is switched on for everyone. `null` means no pilot: all accounts.
 */
export function pilotEmails(env = process.env) {
  const list = (env.PAYWALL_PILOT_EMAILS || '').split(',').map((x) => x.trim().toLowerCase()).filter((x) => x.includes('@'));
  return list.length ? new Set(list) : null;
}

/** Is this account subject to the paywall at all? */
export function inPilot(account, env = process.env) {
  const pilot = pilotEmails(env);
  return !pilot || (typeof account?.email === 'string' && pilot.has(account.email.toLowerCase()));
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
  const gate = await analysisGate(req, env, dependencies);
  if (gate.locked) throw new UnlockRequired();
  return gate;
}

/**
 * Who is asking and whether they have unlocked, without refusing anyone.
 * My Aid reads documents for locked accounts too (they get a preview); the
 * full result is released only when `locked` is false.
 */
export async function analysisGate(req, env = process.env, dependencies = {}) {
  if (!paywallEnabled(env)) return { access: 'open', account: null, db: null, locked: false };
  if (pilotEmails(env)) {
    // Pilot: only listed accounts are gated. Anyone else, signed in or not,
    // and any lookup failure, reads exactly as before the paywall existed.
    let pilot;
    try {
      const { db } = dependencies.clients(env);
      const account = accountToken(req) ? await currentAccount(req, db) : null;
      pilot = account && inPilot(account, env) ? { account, db } : null;
    } catch { pilot = null; }
    if (!pilot) return { access: 'open', account: null, db: null, locked: false };
  }
  const { db } = dependencies.clients(env);
  const account = await currentAccount(req, db);
  const result = await resolveAccess(db, account, env);
  return { ...result, account, db, locked: result.access === 'locked' };
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
  // First-touch source (TikTok video, campaign...) for this account: ids and
  // UTM values only. Read best effort; a missing value never blocks payment.
  const attribution = stripeAttributionMetadata(await accountAttribution(db, account.id));
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
      metadata: { ...attribution, fynq_account_id: account.id, purpose: PURPOSE },
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
