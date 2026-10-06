// Records that a document read happened, and how it went, for /admin.
//
// Stored: when, which account or guest browser, the outcome, how many files
// and how many figures were read, and the content-free reason code. Never
// file names, document text, figures or images. Tracking is best effort: it
// can never slow down or break a student's upload.
import { clients, rpc, hash, session as guestSession } from './beta.js';
import { accountToken } from './account-login.js';
import { buildEvent, recordEvents } from './analytics.js';

export const OUTCOMES = ['read', 'no_aid_lines', 'unreadable', 'privacy_blocked', 'reader_error'];

/** The canonical analytics event for each reader outcome (docs/analytics-events.md). */
export const OUTCOME_EVENTS = {
  read: 'analysis_completed',
  reader_error: 'analysis_failed',
  no_aid_lines: 'upload_failed',
  unreadable: 'upload_failed',
  privacy_blocked: 'upload_failed',
};

async function who(req, db, env) {
  const [account, guest] = await Promise.all([
    (async () => {
      const value = accountToken(req);
      if (!value) return null;
      const row = await rpc(db, 'account_session', { p_hash: hash(value) });
      return row?.user_id ?? null;
    })().catch(() => null),
    guestSession(req, db, env).then((row) => row.user_id).catch(() => null),
  ]);
  return { account, guest };
}

export async function recordUpload(req, { outcome, files, figures = 0, reason = null, ai_ms, second_pass }, dependencies = {}) {
  try {
    if (!OUTCOMES.includes(outcome)) return;
    const env = dependencies.env || process.env;
    const { db } = (dependencies.clients || clients)(env);
    const work = (async () => {
      const { account, guest } = await who(req, db, env);
      await rpc(db, 'record_upload', {
        p_account: account,
        p_guest: guest,
        p_outcome: outcome,
        p_files: Math.max(0, Math.min(3, files | 0)),
        p_figures: Math.max(0, Math.min(40, figures | 0)),
        p_reason: typeof reason === 'string' && /^[a-z0-9+-]{1,200}$/.test(reason) ? reason : null,
      }).catch(() => {});
      // The same outcome as a canonical analytics event. Reason codes only.
      await recordEvents(db, buildEvent(OUTCOME_EVENTS[outcome], {
        userId: account ? String(account).toLowerCase() : null,
        guestId: guest ? String(guest).toLowerCase() : null,
        userAgent: req?.headers?.['user-agent'],
        env,
        metadata: {
          outcome, files, figures, ai_ms, second_pass,
          reason: outcome === 'read' || outcome === 'reader_error' ? undefined : outcome,
        },
      }));
    })().catch(() => {});
    // Never hold a student's answer for more than a moment over bookkeeping.
    await Promise.race([work, new Promise((resolve) => setTimeout(resolve, 1500))]);
  } catch {
    /* tracking must not affect the upload */
  }
}
