// Email + password accounts for the /login and /signup pages.
//
// Passwords go to Supabase Auth and nowhere else: Fynliq never stores or logs
// them. A successful log-in gets its own random session token, kept only as a
// SHA-256 hash in the database and sent to the browser as an httpOnly cookie,
// so page scripts can never read it. Sign-ups and log-ins are recorded for the
// /admin dashboard (email, dates, counts), never any aid or question content.
import { clients, rpc, sameOrigin, body, session as guestSession, hash, newSession, rate, BetaError } from './beta.js';

export const ACCOUNT_COOKIE = '__Host-fynliq_account';
const THIRTY_DAYS = 30 * 24 * 60 * 60;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function accountCookie(value, seconds = THIRTY_DAYS) {
  return `${ACCOUNT_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
}

export function accountToken(req) {
  const value = (new RegExp(`(?:^|;\\s*)${ACCOUNT_COOKIE}=([^;]+)`).exec(req.headers.cookie || '') || [])[1];
  return /^[a-f0-9]{64}$/.test(value || '') ? value : null;
}

function credentials(req) {
  const input = body(req, 4000);
  const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : '';
  const password = typeof input?.password === 'string' ? input.password : '';
  if (!EMAIL.test(email) || email.length > 254) throw new BetaError(400, 'Enter a valid email address.');
  return { email, password };
}

function sessionBody(row) {
  return {
    account: { email: row.email, firstName: null, createdAt: new Date(row.created_at).toISOString() },
    token: null,
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

/** The guest browser id already used for question tracking, if there is one. */
async function guestId(req, db, env) {
  try { return (await guestSession(req, db, env)).user_id; } catch { return null; }
}

async function start(res, req, db, env, user) {
  const fresh = newSession();
  const row = await rpc(db, 'account_start_session', { p_user: user.id, p_email: user.email, p_hash: fresh.digest, p_guest: await guestId(req, db, env) });
  res.setHeader('Set-Cookie', accountCookie(fresh.value));
  return res.json(sessionBody(row));
}

export function createAccountHandler(action, dependencies = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const env = dependencies.env || process.env;
      const { db, auth } = (dependencies.clients || clients)(env);

      if (action === 'session') {
        if (req.method !== 'GET') throw new BetaError(405, 'Use GET.');
        const value = accountToken(req);
        const row = value ? await rpc(db, 'account_session', { p_hash: hash(value) }) : null;
        if (!row) return res.status(401).send('Not logged in.');
        // Keep attributing this browser's questions to the account.
        const guest = await guestId(req, db, env);
        if (guest) await rpc(db, 'account_link_guest', { p_user: row.user_id, p_guest: guest }).catch(() => {});
        return res.json(sessionBody(row));
      }

      if (req.method !== 'POST') throw new BetaError(405, 'Use POST.');
      sameOrigin(req, env);

      if (action === 'logout') {
        const value = accountToken(req);
        if (value) await rpc(db, 'account_logout', { p_hash: hash(value) });
        res.setHeader('Set-Cookie', accountCookie('', 0));
        return res.json({ ok: true });
      }

      await rate(db, req, `account-${action}`, action === 'signup' ? 5 : 10, env);
      const { email, password } = credentials(req);

      if (action === 'signup') {
        if (password.length < 8 || password.length > 200) throw new BetaError(400, 'Use a password of at least 8 characters.');
        const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
        if (error) {
          if (error.status === 422 || /already|registered|exists/i.test(error.message || '')) {
            throw new BetaError(409, 'There is already an account with that email address. Log in instead.');
          }
          if (/password/i.test(error.message || '')) throw new BetaError(400, 'Choose a stronger password.');
          throw new BetaError(503, 'Accounts are temporarily unavailable. Please try again in a moment.');
        }
        await rpc(db, 'account_signed_up', { p_user: data.user.id, p_email: email });
        return start(res, req, db, env, { id: data.user.id, email });
      }

      if (action === 'login') {
        if (!password || password.length > 200) throw new BetaError(401, 'That email and password do not match an account.');
        const { data, error } = await auth.auth.signInWithPassword({ email, password });
        if (error || !data?.user || data.user.email?.toLowerCase() !== email) {
          throw new BetaError(401, 'That email and password do not match an account.');
        }
        // Only our own cookie session is used; the provider session is dropped.
        return start(res, req, db, env, { id: data.user.id, email });
      }

      throw new BetaError(404, 'Not found.');
    } catch (error) {
      const status = error instanceof BetaError ? error.status : 503;
      return res.status(status).send(error instanceof BetaError ? error.message : 'Accounts are temporarily unavailable.');
    }
  };
}
