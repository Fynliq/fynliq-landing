// Browser-side analytics events (docs/analytics-events.md).
//
//   POST { events: [{ id, name, metadata?, experiment? }] }  -> { ok: true }
//
// Only the client event names in server/analytics.js are accepted, with their
// allow-listed metadata. Who sent them comes from the httpOnly guest and
// account cookies, never from the body. Same-origin only, rate limited, and
// at most 10 events of 4 KB in total per request. Anything not allowed is
// dropped silently; the response is the same either way, so the browser has
// nothing to retry and nothing to learn.
import { observe } from '../server/observability.js';
import { clients, sameOrigin, body, rate, fail, BetaError } from '../server/beta.js';
import { track, CLIENT_EVENT_NAMES } from '../server/analytics.js';

const MAX_EVENTS = 10;

export function createActivityHandler(dependencies = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); throw new BetaError(405, 'Use POST.'); }
      const env = dependencies.env || process.env;
      const { db } = (dependencies.clients || clients)(env);
      sameOrigin(req, env);
      await rate(db, req, 'activity', 120, env);
      const input = body(req, 4096);
      const list = Array.isArray(input?.events) ? input.events.slice(0, MAX_EVENTS) : [];
      const events = list
        .filter((e) => e && typeof e === 'object' && CLIENT_EVENT_NAMES.includes(e.name))
        .map((e) => ({ name: e.name, eventId: e.id, metadata: e.metadata, experimentId: e.experiment, side: 'client' }));
      if (events.length) await track(req, events, {}, { db, env });
      return res.json({ ok: true });
    } catch (error) {
      return fail(res, error);
    }
  };
}

export default observe('/api/activity', createActivityHandler());
