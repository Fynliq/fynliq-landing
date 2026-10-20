// Regression tests for contract gaps QA found in PR #18 (observability).
// They assert docs/analytics-events.md as written.
//
//   node --test test/observability-contract-gaps.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildEvent } from '../server/analytics.js';
import { createActivityHandler } from '../api/activity.js';

const ACCOUNT = '40000000-0000-4000-8000-000000000002';
const GUEST = '50000000-0000-4000-8000-000000000002';
const MORNING = Date.parse('2026-10-19T09:00:00Z');
const LATER = Date.parse('2026-10-19T09:10:00Z');

// Contract (docs/analytics-events.md): once-per-day events are keyed on the
// account when logged in, otherwise the guest browser. A guest who signs up
// mid-day can therefore store one row of each; ops_* functions count distinct
// people (guest → account), so funnel numbers are unaffected.
test('once-per-day keys follow the documented identity rule', () => {
  const before = buildEvent('landing_view', { guestId: GUEST, now: MORNING });
  const after = buildEvent('landing_view', { guestId: GUEST, userId: ACCOUNT, now: LATER });
  assert.equal(before.dedupe_key, `g:${GUEST}:2026-10-19`);
  assert.equal(after.dedupe_key, `u:${ACCOUNT}:2026-10-19`);
  assert.equal(buildEvent('landing_view', { guestId: GUEST, userId: ACCOUNT, now: LATER + 60_000 }).dedupe_key, after.dedupe_key);
});

// Contract: browser upload_failed reasons are only device_unreadable, offline
// and client; unreadable / no_aid_lines / privacy_blocked are server reason
// codes. /api/activity accepts any reason from the browser, so a page script
// (or any same-origin caller) can record server-only failure reasons.
test('the browser cannot report server-only upload_failed reasons', async () => {
  const sent = [];
  const db = { rpc: async (name, args) => {
    if (name === 'beta_rate') return { data: true, error: null };
    if (name === 'analytics_record') { sent.push(...args.p_events); return { data: args.p_events.length, error: null }; }
    return { data: null, error: null };
  } };
  const env = { BETA_ORIGIN: 'https://www.fynliq.test', BETA_RATE_SECRET: 'synthetic-rate-secret-at-least-32-chars' };
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; },
    send(v) { this.body = v; return this; }, json(v) { this.body = v; return this; } };
  await createActivityHandler({ env, clients: () => ({ db }) })({ method: 'POST', socket: { remoteAddress: '198.51.100.9' },
    headers: { 'content-type': 'application/json', origin: env.BETA_ORIGIN },
    body: JSON.stringify({ events: [{ id: randomUUID(), name: 'upload_failed', metadata: { reason: 'privacy_blocked', files: 1 } }] }) }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(sent.length, 0, 'a cookie-less request stores nothing');
  const reasons = sent.filter((e) => e.event_name === 'upload_failed').map((e) => e.metadata.reason);
  for (const reason of reasons) assert.ok(['device_unreadable', 'offline', 'client'].includes(reason), `browser recorded server reason ${reason}`);
});
