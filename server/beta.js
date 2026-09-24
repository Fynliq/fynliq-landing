import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export class BetaError extends Error { constructor(status,message){super(message);this.status=status;} }
export const cookieName='__Host-fynliq_beta';
export function positive(value,fallback,max=100000) {
  const n=value===undefined||value===''?fallback:Number(value);
  if(!Number.isSafeInteger(n)||n<1||n>max)throw new BetaError(503,'The beta limits are not configured safely.');
  return n;
}
export const hash=value=>createHash('sha256').update(value).digest('hex');
export function clients(env=process.env) {
  if(env.BETA_ENABLED!=='true'||!env.SUPABASE_URL||!env.SUPABASE_PUBLISHABLE_KEY||!env.SUPABASE_SERVICE_ROLE_KEY)
    throw new BetaError(503,'Fynliq is temporarily unavailable.');
  const options={auth:{persistSession:false,autoRefreshToken:false}};
  return {auth:createClient(env.SUPABASE_URL,env.SUPABASE_PUBLISHABLE_KEY,options),db:createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,options)};
}
export async function rpc(db,name,args={}) {
  const {data,error}=await db.rpc(name,args);
  if(error)throw new BetaError(503,'The beta service is temporarily unavailable.');
  return data;
}
export function sameOrigin(req,env=process.env) {
  if(!env.BETA_ORIGIN||req.headers.origin!==env.BETA_ORIGIN)throw new BetaError(403,'Please use the Fynliq website to continue.');
}
export function body(req,limit=65536) {
  if(!(req.headers['content-type']||'').startsWith('application/json'))throw new BetaError(415,'Send JSON.');
  const raw=typeof req.body==='string'?req.body:JSON.stringify(req.body??null);
  if(Buffer.byteLength(raw)>limit)throw new BetaError(413,'That request is too large.');
  try{return JSON.parse(raw);}catch{throw new BetaError(400,'Invalid request.');}
}
export function token(req,admin=false) {
  const pattern=admin?/(?:^|;\s*)__Host-fynliq_admin=([^;]+)/:/(?:^|;\s*)__Host-fynliq_beta=([^;]+)/;
  const value=(pattern.exec(req.headers.cookie||'')||[])[1];
  return /^[a-f0-9]{64}$/.test(value||'')?value:null;
}
export async function session(req,db,env=process.env,admin=false) {
  const value=token(req,admin);if(!value)throw new BetaError(401,'Please refresh the page to start your guest session.');
  const row=await rpc(db,'beta_session',{p_hash:hash(value)});
  if(!row)throw new BetaError(401,'Your session has expired. Please refresh the page.');
  if(row.kind!==(admin?'admin':'guest'))throw new BetaError(401,'This session cannot access that service.');
  return row;
}
export function cookie(value,seconds=28800,admin=false){return `${admin?'__Host-fynliq_admin':cookieName}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds}`;}
export function newSession(){const value=randomBytes(32).toString('hex');return {value,digest:hash(value)};}
export function isAdmin(user,env=process.env){return (env.BETA_ADMIN_USER_IDS||'').split(',').map(x=>x.trim()).filter(Boolean).includes(user.user_id);}
export function fail(res,error) {return res.status(error instanceof BetaError?error.status:503).send(error instanceof BetaError?error.message:'The beta service is temporarily unavailable.');}
export async function rate(db,req,scope,limit,env=process.env) {
  if(!env.BETA_RATE_SECRET||env.BETA_RATE_SECRET.length<32)throw new BetaError(503,'The beta rate limits are not configured.');
  // Vercel overwrites this header; never trust arbitrary x-forwarded-for chains.
  const ip=(env.VERCEL==='1'?req.headers['x-vercel-forwarded-for']:req.socket?.remoteAddress)||'unknown';
  const key=hash(env.BETA_RATE_SECRET+':'+scope+':'+String(ip));
  if(!await rpc(db,'beta_rate',{p_key:key,p_limit:limit}))throw new BetaError(429,'Please wait a minute before trying again.');
}


export const guestId=()=>randomUUID();
