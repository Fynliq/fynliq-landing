import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { accountClients, authenticatedUser, accountBody, requireId, AccountError } from '../server/account-auth.js';
import { allowRequest } from '../server/limits.js';

export const EVENT_NAMES = new Set(['anonymous_session_started','signup_started','login_completed','session_started','document_uploaded','document_saved','ask_fynliq_question','conversation_started','return_session','logout']);
function mac(value,secret) { return createHmac('sha256',secret).update(value).digest('base64url'); }
export function anonymousIdentity(cookie,secret) {
  const value = /(?:^|;\s*)fynliq_visitor=([^;]+)/.exec(cookie || '')?.[1];
  const [id,sig] = (value || '').split('.');
  if (id && sig) {
    const expected = Buffer.from(mac(id,secret)), actual = Buffer.from(sig);
    if (actual.length === expected.length && timingSafeEqual(actual,expected)) return requireId(id);
  }
  return randomUUID();
}

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  try {
    if(req.method !== 'POST') throw new AccountError(405,'Use POST.');
    if(!allowRequest(req,'activity',60)) throw new AccountError(429,'Try again later.');
    const {auth,db} = accountClients();
    const secret = process.env.ACCOUNT_SESSION_SECRET;
    if(!secret || secret.length < 32) throw new AccountError(503,'Activity unavailable.');
    const body = accountBody(req,2000);
    requireId(body.id); requireId(body.sessionId);
    if (!EVENT_NAMES.has(body.event)) throw new AccountError(400,'Invalid activity.');
    // No arbitrary metadata, question text, file names or URLs are accepted.
    const user = req.headers.authorization ? await authenticatedUser(req,auth) : null;
    const anonymousId = anonymousIdentity(req.headers.cookie,secret);
    res.setHeader('Set-Cookie',`fynliq_visitor=${anonymousId}.${mac(anonymousId,secret)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`);
    const {error} = await db.rpc('fynliq_record_activity',{p_id:body.id,p_user:user?.id || null,p_anonymous:anonymousId,p_session:body.sessionId,p_event:body.event});
    if(error) throw error;
    if(body.event === 'logout') res.setHeader('Set-Cookie','fynliq_visitor=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    return res.json({ok:true});
  } catch(error) { return res.status(error instanceof AccountError ? error.status : 503).send(error instanceof AccountError ? error.message : 'Activity unavailable.'); }
}
