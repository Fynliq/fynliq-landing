// The one safe way for agents and reports to read FYNQ's numbers.
//
// GET /api/beta-admin?view=ops&since=…&until=…&segment=…
//   Authorization: Bearer <ops read token>
//
// Returns aggregates only (counts, rates, latencies). Every database call is a
// STABLE ops_* function sent with rpcRead (HTTP GET), which PostgREST runs in a
// read-only transaction: this path cannot change data. The token is compared
// in constant time against OPS_READ_TOKEN_SHA256 (a SHA-256 hex digest set in
// Vercel); the raw token lives only in the private ops repository's secrets.
// No database credentials ever leave the server.
import { createHash, timingSafeEqual } from 'node:crypto';
import { rpcRead, BetaError } from './beta.js';
import { testAccountIds } from './billing.js';

export const SEGMENTS = ['none', 'source', 'campaign', 'content', 'device', 'browser', 'school', 'date', 'experiment'];
const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?Z)?$/;
const DAY = 24 * 60 * 60 * 1000;

/** True only for a well-formed bearer token whose SHA-256 matches the configured digest. */
export function opsTokenValid(req, env = process.env) {
  const expected = String(env.OPS_READ_TOKEN_SHA256 || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) return false;
  const header = req?.headers?.authorization;
  const match = typeof header === 'string' ? /^Bearer ([A-Za-z0-9_-]{32,200})$/.exec(header) : null;
  if (!match) return false;
  const actual = createHash('sha256').update(match[1]).digest();
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}

export function hasBearer(req) {
  return typeof req?.headers?.authorization === 'string' && /^Bearer /i.test(req.headers.authorization);
}

/** Validated window: defaults to the last 24 hours, at most 92 days. */
export function parseWindow(query = {}, now = Date.now()) {
  const until = ISO.test(query.until || '') ? Date.parse(query.until) : now;
  const since = ISO.test(query.since || '') ? Date.parse(query.since) : until - DAY;
  if (!Number.isFinite(since) || !Number.isFinite(until) || since >= until || until - since > 92 * DAY) {
    throw new BetaError(400, 'Invalid window.');
  }
  const segment = SEGMENTS.includes(query.segment) ? query.segment : 'none';
  return { since: new Date(since).toISOString(), until: new Date(until).toISOString(), segment };
}

const rate = (num, den) => (Number(den) > 0 ? Math.round((Number(num) / Number(den)) * 10000) / 10000 : null);

/** Step-to-step conversions for one funnel row. Null when the step before is zero. */
export function conversions(row = {}) {
  return {
    visitor_to_signup: rate(row.signups, row.visitors),
    signup_to_upload: rate(row.uploaders, row.signups),
    upload_to_result: rate(row.result_viewers, row.uploaders),
    result_to_checkout: rate(row.checkout_starters, row.result_viewers),
    checkout_to_paid: rate(row.payers, row.checkout_starters),
    visitor_to_paid: rate(row.payers, row.visitors),
  };
}

export async function opsMetrics(db, env, window) {
  const test = [...testAccountIds(env)].join(',');
  const [funnel, revenue, health, milestones, migrations] = await Promise.all([
    rpcRead(db, 'ops_funnel', { p_since: window.since, p_until: window.until, p_segment: window.segment, p_test: test }),
    rpcRead(db, 'ops_revenue', { p_since: window.since, p_until: window.until, p_test: test }),
    rpcRead(db, 'ops_health', { p_since: window.since, p_until: window.until }),
    rpcRead(db, 'ops_milestone_metrics', { p_test: test }),
    rpcRead(db, 'ops_applied_migrations', {}).catch(() => null),
  ]);
  const rows = Array.isArray(funnel?.rows) ? funnel.rows : [];
  return {
    generated_at: new Date().toISOString(),
    window,
    funnel: rows.map((row) => ({ ...row, conversions: conversions(row) })),
    revenue,
    health,
    milestones,
    applied_migrations: Array.isArray(migrations) ? migrations.map((m) => m?.name).filter((n) => typeof n === 'string') : null,
    notes: [
      'Funnel counts unique people from analytics_events (live since this feature shipped).',
      'Payments and revenue are authoritative: billing tables written only by the verified Stripe webhook.',
      'Admin and test accounts, and Stripe test mode, are excluded.',
    ],
  };
}
