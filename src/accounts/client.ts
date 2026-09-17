import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const accountsEnabled = import.meta.env.VITE_ACCOUNTS_ENABLED === 'true' && Boolean(url && key);
// This is a public project key. The service-role key must never be used here.
export const accountClient = accountsEnabled ? createClient(url, key, {
  auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'fynliq.auth.v1' },
}) : null;

export async function downloadSavedFile(id:string,index:number,name:string) {
  if(!accountClient)throw new Error('Accounts are not available yet.');
  const {data:{session}}=await accountClient.auth.getSession();
  if(!session)throw new Error('Please sign in again.');
  const response=await fetch('/api/account?action=download',{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({id,index}),cache:'no-store'});
  if(!response.ok)throw new Error(await response.text());
  const blob=await response.blob(),url=URL.createObjectURL(blob),anchor=document.createElement('a');
  anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export async function accountRequest<T>(action: string, body?: unknown): Promise<T> {
  if (!accountClient) throw new Error('Accounts are not available yet.');
  const { data: { session }, error } = await accountClient.auth.getSession();
  if (error || !session) throw new Error('Please sign in again to access saved information.');
  const response = await fetch(`/api/account?action=${encodeURIComponent(action)}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}
