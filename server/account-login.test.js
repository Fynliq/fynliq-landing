import { describe, expect, it } from 'vitest';
import { createAccountHandler, accountCookie } from './account-login.js';
import { hash } from './beta.js';

const env = { BETA_ORIGIN: 'https://www.fynliq.com', BETA_RATE_SECRET: 'x'.repeat(40) };
function response() {
  return { statusCode: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, send(v) { this.body = v; return this; }, json(v) { this.body = v; return this; } };
}
function fakeDb() {
  const calls = [];
  const users = new Map();
  const sessions = new Map();
  const db = {
    calls,
    async rpc(name, args) {
      calls.push([name, args]);
      if (name === 'beta_rate') return { data: true, error: null };
      if (name === 'beta_session') return { data: null, error: null };
      if (name === 'account_start_session') {
        const row = { user_id: args.p_user, email: args.p_email, created_at: '2026-09-21T00:00:00Z', expires_at: '2026-10-21T00:00:00Z' };
        sessions.set(args.p_hash, row); return { data: row, error: null };
      }
      if (name === 'account_session') return { data: sessions.get(args.p_hash) ?? null, error: null };
      return { data: null, error: null };
    },
    auth: { admin: { async createUser({ email, password }) {
      if (users.has(email)) return { data: null, error: { status: 422, message: 'A user with this email address has already been registered' } };
      users.set(email, password); return { data: { user: { id: '11111111-1111-4111-8111-111111111111', email } }, error: null };
    } } },
  };
  const auth = { auth: { async signInWithPassword({ email, password }) {
    return users.get(email) === password ? { data: { user: { id: '11111111-1111-4111-8111-111111111111', email } }, error: null } : { data: null, error: { message: 'Invalid' } };
  } } };
  return { db, auth };
}
const post = (body, extra = {}) => ({ method: 'POST', headers: { origin: env.BETA_ORIGIN, 'content-type': 'application/json', ...extra }, socket: { remoteAddress: '10.0.0.1' }, body });

describe('account log-in', () => {
  it('signs up, sets an httpOnly cookie, returns the session shape and records the sign-up', async () => {
    const c = fakeDb();
    const res = response();
    await createAccountHandler('signup', { env, clients: () => c })(post({ email: ' Sam@School.edu ', password: 'correct horse' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.account.email).toBe('sam@school.edu');
    expect(res.body.token).toBeNull();
    expect(res.headers['Set-Cookie']).toMatch(/^__Host-fynliq_account=[a-f0-9]{64}; Path=\/; HttpOnly; Secure/);
    expect(c.db.calls.map(([n]) => n)).toContain('account_signed_up');
    expect(c.db.calls.map(([n]) => n)).toContain('account_start_session');
    expect(JSON.stringify(c.db.calls)).not.toContain('correct horse');
  });

  it('refuses a second sign-up with the same email as 409', async () => {
    const c = fakeDb();
    await createAccountHandler('signup', { env, clients: () => c })(post({ email: 'sam@school.edu', password: 'correct horse' }), response());
    const res = response();
    await createAccountHandler('signup', { env, clients: () => c })(post({ email: 'sam@school.edu', password: 'another one' }), res);
    expect(res.statusCode).toBe(409);
  });

  it('logs in with the right password, counts it, and restores the session from the cookie', async () => {
    const c = fakeDb();
    await createAccountHandler('signup', { env, clients: () => c })(post({ email: 'sam@school.edu', password: 'correct horse' }), response());
    const res = response();
    await createAccountHandler('login', { env, clients: () => c })(post({ email: 'sam@school.edu', password: 'correct horse' }), res);
    expect(res.statusCode).toBe(200);
    const cookie = res.headers['Set-Cookie'].split(';')[0];
    const restored = response();
    await createAccountHandler('session', { env, clients: () => c })({ method: 'GET', headers: { cookie } }, restored);
    expect(restored.statusCode).toBe(200);
    expect(restored.body.account.email).toBe('sam@school.edu');
    expect(restored.headers['Set-Cookie']).toMatch(/Max-Age=34560000/);
    expect(c.db.calls.filter(([n]) => n === 'account_start_session')).toHaveLength(2);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const c = fakeDb();
    await createAccountHandler('signup', { env, clients: () => c })(post({ email: 'sam@school.edu', password: 'correct horse' }), response());
    const wrong = response(); const unknown = response();
    await createAccountHandler('login', { env, clients: () => c })(post({ email: 'sam@school.edu', password: 'nope nope' }), wrong);
    await createAccountHandler('login', { env, clients: () => c })(post({ email: 'nobody@school.edu', password: 'nope nope' }), unknown);
    expect(wrong.statusCode).toBe(401); expect(unknown.statusCode).toBe(401);
    expect(wrong.body).toBe(unknown.body);
  });

  it('refuses requests from another site', async () => {
    const res = response();
    await createAccountHandler('login', { env, clients: fakeDb })(post({ email: 'sam@school.edu', password: 'x' }, { origin: 'https://evil.example' }), res);
    expect(res.statusCode).toBe(403);
  });

  it('answers 401 for a missing or unknown session, and logs out by revoking and clearing the cookie', async () => {
    const c = fakeDb();
    const none = response();
    await createAccountHandler('session', { env, clients: () => c })({ method: 'GET', headers: {} }, none);
    expect(none.statusCode).toBe(401);
    const value = 'a'.repeat(64);
    const out = response();
    await createAccountHandler('logout', { env, clients: () => c })(post(null, { cookie: `__Host-fynliq_account=${value}` }), out);
    expect(out.statusCode).toBe(200);
    expect(c.db.calls.some(([n, a]) => n === 'account_logout' && a.p_hash === hash(value))).toBe(true);
    expect(out.headers['Set-Cookie']).toBe(accountCookie('', 0));
  });

  it('fails closed when the beta backend is not configured', async () => {
    const res = response();
    await createAccountHandler('login')(post({ email: 'sam@school.edu', password: 'x' }), res);
    expect(res.statusCode).toBe(503);
  });
});
