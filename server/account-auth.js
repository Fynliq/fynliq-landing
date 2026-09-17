import { createClient } from '@supabase/supabase-js';

export class AccountError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function accountClients(env = process.env) {
  if (env.ACCOUNTS_ENABLED !== 'true' || !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new AccountError(503, 'Accounts are not available yet. You can keep using Fynliq without signing in.');
  }
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  return {
    auth: createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, options),
    db: createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, options),
  };
}

export async function authenticatedUser(req, auth) {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !/^Bearer [^\s]+$/.test(header)) throw new AccountError(401, 'Please sign in to access your saved information.');
  const { data, error } = await auth.auth.getUser(header.slice(7));
  if (error || !data?.user || data.user.is_anonymous) throw new AccountError(401, 'Your session has expired. Please sign in again.');
  return data.user;
}

export function accountBody(req, maxBytes = 100000) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new AccountError(415, 'Send JSON.');
  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  if (!raw || Buffer.byteLength(raw) > maxBytes) throw new AccountError(413, 'This saved item is too large.');
  try { return JSON.parse(raw); } catch { throw new AccountError(400, 'Invalid request.'); }
}

export function requireId(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new AccountError(400, 'Invalid item identifier.');
  return value;
}

// Every privileged query must use this owner filter, including reads and deletes.
export async function ownedRecord(db, table, userId, id) {
  const { data, error } = await db.from(table).select('*').eq('user_id', userId).eq('id', requireId(id)).maybeSingle();
  if (error) throw new AccountError(503, 'Saved information is temporarily unavailable.');
  if (!data) throw new AccountError(404, 'Saved item not found.');
  return data;
}
