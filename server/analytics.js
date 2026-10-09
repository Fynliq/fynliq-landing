// Canonical FYNQ analytics events (docs/analytics-events.md).
//
// recordEvents() is the only way the server writes an analytics event. It
// never throws and never holds a response for long: if Supabase is down, slow
// or not configured, the events are dropped and the student's request carries
// on exactly as before.
//
// What may be recorded is decided here, not by callers:
//   * the event name must be in EVENTS;
//   * identity comes from the request's own cookies (guest + account), never
//     from a request body;
//   * device and browser are coarse buckets from the User-Agent; the raw UA
//     is never stored;
//   * metadata keys must be in METADATA and values must be small scalars.
// Attribution (channel, UTM values, referrer host, landing path) is attached
// by the database from acquisition_attribution, so callers can't forge it.
import { randomUUID } from 'node:crypto';
import { clients, rpc, hash, session as guestSession } from './beta.js';
import { accountToken } from './account-login.js';
import { testAccountIds } from './billing.js';
import { afterResponse } from './observability.js';

/** Stable event names. Changing a name breaks history: add, don't rename. */
export const EVENTS = Object.freeze({
  landing_view: { side: 'server', once: 'per_person_day' },
  return_session: { side: 'server', once: 'per_person_day' },
  signup_started: { side: 'client', once: 'per_person_day' },
  signup_completed: { side: 'server', once: 'per_user' },
  login_completed: { side: 'server' },
  login_failed: { side: 'server' },
  my_aid_viewed: { side: 'client', once: 'per_person_day' },
  upload_started: { side: 'client' },
  upload_completed: { side: 'server' },
  upload_failed: { side: 'both' },
  analysis_started: { side: 'server' },
  analysis_completed: { side: 'server' },
  analysis_failed: { side: 'server' },
  results_viewed: { side: 'client' },
  checkout_viewed: { side: 'client', once: 'per_person_day' },
  checkout_started: { side: 'server', once: 'per_key' },
  payment_completed: { side: 'server', once: 'per_key' },
  payment_failed: { side: 'server', once: 'per_key' },
  checkout_expired: { side: 'server', once: 'per_key' },
  unlock_verified: { side: 'server', once: 'per_key' },
  client_error: { side: 'client' },
});

/** Events a browser may send to /api/activity. Everything else is server-only. */
export const CLIENT_EVENT_NAMES = Object.freeze(Object.entries(EVENTS)
  .filter(([, spec]) => spec.side === 'client' || spec.side === 'both').map(([name]) => name));

/** Allowed metadata keys and their shape. Anything else is dropped silently. */
export const METADATA = Object.freeze({
  reason: /^[a-z0-9_+-]{1,60}$/,
  view: /^(preview|full)$/,
  kind: /^[a-z0-9_-]{1,40}$/,
  outcome: /^[a-z_]{1,40}$/,
  error_name: /^[A-Za-z]{1,40}$/,
  source_file: /^[A-Za-z0-9_.-]{1,80}$/,
  path: /^\/[A-Za-z0-9/_-]{0,80}$/,
  stripe_outcome: /^[a-z_]{1,40}$/,
  files: 'int:0:3',
  figures: 'int:0:40',
  ai_ms: 'int:0:120000',
  duration_ms: 'int:0:600000',
  second_pass: 'bool',
  duplicate: 'bool',
  reused: 'bool',
});

export function sanitizeMetadata(input) {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [key, rule] of Object.entries(METADATA)) {
    if (!(key in input)) continue;
    const value = input[key];
    if (rule instanceof RegExp) {
      if (typeof value === 'string' && rule.test(value)) out[key] = value;
    } else if (rule === 'bool') {
      if (typeof value === 'boolean') out[key] = value;
    } else if (rule.startsWith('int:')) {
      const [, min, max] = rule.split(':').map(Number);
      if (Number.isFinite(value)) out[key] = Math.max(min, Math.min(max, Math.round(value)));
    }
  }
  return out;
}

/** Coarse device type and browser family. In-app browsers are named by app. */
export function classifyUserAgent(userAgent) {
  const ua = typeof userAgent === 'string' ? userAgent.slice(0, 512) : '';
  if (!ua) return { device_type: 'unknown', browser: 'other' };
  const tablet = /iPad|Tablet|(Android(?!.*Mobile))/i.test(ua);
  const mobile = !tablet && /Mobi|iPhone|iPod|Android/i.test(ua);
  const device_type = tablet ? 'tablet' : mobile ? 'mobile' : /Windows NT|Macintosh|X11|CrOS|Linux/i.test(ua) ? 'desktop' : 'unknown';
  let browser = 'other';
  if (/musical_ly|BytedanceWebview|TikTok/i.test(ua)) browser = 'tiktok';
  else if (/Instagram/i.test(ua)) browser = 'instagram';
  else if (/FBAN|FBAV|FB_IAB/i.test(ua)) browser = 'facebook';
  else if (/SamsungBrowser/i.test(ua)) browser = 'samsung';
  else if (/Edg\//i.test(ua)) browser = 'edge';
  else if (/Firefox|FxiOS/i.test(ua)) browser = 'firefox';
  else if (/Chrome|CriOS/i.test(ua)) browser = 'chrome';
  else if (/Safari/i.test(ua)) browser = 'safari';
  return { device_type, browser };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXPERIMENT = /^[a-z0-9_-]{1,40}$/;
const utcDay = (now) => new Date(now).toISOString().slice(0, 10);

/** The guest browser and logged-in account behind a request, from cookies only. */
export async function identify(req, db, env) {
  const [userId, guestId] = await Promise.all([
    (async () => {
      const value = accountToken(req);
      if (!value) return null;
      const row = await rpc(db, 'account_session', { p_hash: hash(value) });
      return row?.user_id ? String(row.user_id).toLowerCase() : null;
    })().catch(() => null),
    guestSession(req, db, env).then((row) => String(row.user_id).toLowerCase()).catch(() => null),
  ]);
  return { userId, guestId };
}

/**
 * Builds the row for one event, or null if the event is not allowed.
 * `key` is the entity a once-per-key event is about (a checkout session id).
 */
export function buildEvent(name, { userId = null, guestId = null, userAgent = '', metadata, key, eventId, experimentId,
  side = 'server', livemode, env = process.env, now = Date.now() } = {}) {
  const spec = EVENTS[name];
  if (!spec) return null;
  if (side === 'client' && !CLIENT_EVENT_NAMES.includes(name)) return null;
  const person = userId || guestId;
  let dedupe = null;
  if (spec.once === 'per_user') dedupe = userId ? `u:${userId}` : null;
  else if (spec.once === 'per_person_day') dedupe = person ? `${userId ? 'u' : 'g'}:${person}:${utcDay(now)}` : null;
  else if (spec.once === 'per_key') {
    if (typeof key !== 'string' || !/^[A-Za-z0-9_:-]{1,100}$/.test(key)) return null;
    dedupe = key;
  }
  if (spec.once === 'per_user' && !dedupe) return null;
  return {
    event_id: typeof eventId === 'string' && UUID.test(eventId) ? eventId.toLowerCase() : randomUUID(),
    event_name: name,
    side: side === 'client' ? 'client' : 'server',
    anonymous_session_id: guestId && UUID.test(guestId) ? guestId : null,
    user_id: userId && UUID.test(userId) ? userId : null,
    dedupe_key: dedupe,
    ...classifyUserAgent(userAgent),
    experiment_id: typeof experimentId === 'string' && EXPERIMENT.test(experimentId) ? experimentId : null,
    livemode: typeof livemode === 'boolean' ? livemode : null,
    is_test: Boolean(userId && testAccountIds(env).has(userId)),
    metadata: sanitizeMetadata(metadata),
  };
}

/**
 * Stores events. Never throws; gives up after `timeoutMs` so a slow database
 * can't hold a student's response. Returns how many were stored (0 on failure).
 */
export async function recordEvents(db, events, { timeoutMs = 1200 } = {}) {
  const rows = (Array.isArray(events) ? events : [events]).filter(Boolean).slice(0, 25);
  if (!rows.length || !db) return 0;
  try {
    const work = rpc(db, 'analytics_record', { p_events: rows }).then((n) => (Number.isInteger(n) ? n : 0));
    return await Promise.race([work.catch(() => 0), new Promise((resolve) => setTimeout(() => resolve(0), timeoutMs))]);
  } catch {
    return 0;
  }
}

/**
 * Convenience for request handlers: works out who is asking, builds the
 * events and stores them, after the response where the platform allows it.
 * `options.identity` may be { userId, guestId } or an async function that
 * returns it; otherwise identity comes from the request's cookies.
 * Never throws, and never holds the response on Vercel.
 */
export function track(req, names, options = {}, dependencies = {}) {
  const work = (async () => {
    const env = dependencies.env || process.env;
    const db = dependencies.db || (dependencies.clients || clients)(env).db;
    const given = typeof options.identity === 'function' ? await options.identity() : options.identity;
    const who = given || await identify(req, db, env);
    const list = (Array.isArray(names) ? names : [names]).map((entry) => (typeof entry === 'string' ? { name: entry } : entry));
    const { identity: _ignored, ...rest } = options;
    const rows = list.map(({ name, ...extra }) => buildEvent(name, {
      ...who, userAgent: req?.headers?.['user-agent'], env, ...rest, ...extra,
      metadata: { ...(rest.metadata || {}), ...(extra.metadata || {}) },
    }));
    return recordEvents(db, rows, rest);
  })().catch(() => 0);
  return afterResponse(work);
}
