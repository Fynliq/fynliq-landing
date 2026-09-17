import { accountClient } from './client';

export type Activity = 'anonymous_session_started'|'signup_started'|'login_completed'|'session_started'|'document_uploaded'|'document_saved'|'ask_fynliq_question'|'conversation_started'|'return_session'|'logout';
let fallback = crypto.randomUUID();
export function sessionId() {
  try {
    const key = 'fynliq.activity-session';
    let id = sessionStorage.getItem(key);
    if(!id) { id=crypto.randomUUID(); sessionStorage.setItem(key,id); }
    return id;
  } catch { return fallback; }
}
export async function activity(event:Activity,id:string=crypto.randomUUID()) {
  if(!accountClient) return;
  try {
    const {data:{session}} = await accountClient.auth.getSession();
    await fetch('/api/activity',{method:'POST',headers:{'Content-Type':'application/json',...(session ? {Authorization:`Bearer ${session.access_token}`} : {})},body:JSON.stringify({id,sessionId:sessionId(),event}),keepalive:true});
  } catch { /* Analytics must not block the student experience. */ }
}

export function beginActivity(userId:string|null) {
  const key=`fynliq.started:${sessionId()}:${userId || 'guest'}`;
  try {
    if(sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key,'1');
    const prior = localStorage.getItem('fynliq.previous-visit');
    if(prior && prior !== sessionId()) void activity('return_session');
    localStorage.setItem('fynliq.previous-visit',sessionId());
  } catch { /* Storage may be disabled. */ }
  void activity(userId ? 'session_started':'anonymous_session_started');
}
