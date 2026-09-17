import { createContext,useContext,useEffect,useRef,useState } from 'react';
import type { User } from '@supabase/supabase-js';
import type { AidAnalysis } from '../core';
import type { AskAnswer } from '../ask/asker';
import { accountClient,accountRequest,downloadSavedFile } from './client';
import { activity,beginActivity } from './activity';
import { stageDraft,readDraft,clearDraft } from './pending';
import styles from './Account.module.css';

interface SavedQuestion { id:string;conversationId:string;question:string;answer:AskAnswer }
interface Draft { sourceId:string;analysis:AidAnalysis|null;files:{name:string;type:string;data:string}[];questions:SavedQuestion[];owner:string|null }
interface Library { documents:{id:string;created_at:string;names:string[]}[];questions:{id:string;question:string;answer:AskAnswer}[] }
interface Context { enabled:boolean; user:User|null; open:()=>void; capture:(analysis:AidAnalysis,files:File[])=>Promise<void>; question:(text:string,answer:AskAnswer)=>void; save:()=>void }
const empty:Context={enabled:false,user:null,open:()=>{},capture:async()=>{},question:()=>{},save:()=>{}};
const AccountContext=createContext<Context>(empty);
export const useAccount=()=>useContext(AccountContext);

export function AccountProvider({children}:{children:React.ReactNode}) {
  const [user,setUser]=useState<User|null>(null),[ready,setReady]=useState(false),[open,setOpen]=useState(false);
  const [email,setEmail]=useState(''),[code,setCode]=useState(''),[sent,setSent]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [pending,setPending]=useState<Draft|null>(null),[library,setLibrary]=useState<Library|null>(null);
  const draft=useRef<Draft|null>(null),userRef=useRef<User|null>(null),conversation=useRef(crypto.randomUUID()),generation=useRef(0);
  const dialog=useRef<HTMLDialogElement>(null);
  const running=useRef(false);
  useEffect(()=>{if(open && dialog.current && !dialog.current.open)dialog.current.showModal();},[open]);
  useEffect(()=>{
    if(!accountClient) {setReady(true);return;}
    let live=true;
    const apply=(next:User|null)=>{
      if(!live)return;
      if(userRef.current && userRef.current.id !== next?.id) {
        try { sessionStorage.removeItem(`fynliq.login:${userRef.current.id}`); sessionStorage.removeItem('fynliq.activity-session'); } catch { /* Storage may be disabled. */ }
        generation.current++;draft.current=null;setPending(null);setLibrary(null);void clearDraft();
        window.dispatchEvent(new Event('fynliq:clear-private'));
      }
      userRef.current=next;setUser(next);setReady(true);beginActivity(next?.id || null);
      if(next) {
        const marker=`fynliq.login:${next.id}`;
        try { if(!sessionStorage.getItem(marker)){sessionStorage.setItem(marker,'1');setTimeout(()=>void activity('login_completed'),0);} } catch { /* No activity if deduplication storage is unavailable. */ }
      }
    };
    void accountClient.auth.getSession().then(({data,error})=>{if(error && live)setError('Could not restore your session. Please sign in again.');apply(data.session?.user || null);});
    const {data:{subscription}}=accountClient.auth.onAuthStateChange((event,session)=>{
      apply(session?.user || null);
      if(event==='SIGNED_IN') setTimeout(()=>{if(live)void readDraft<Draft>().then(value=>{if(live && value){setPending(value);setOpen(true);}});},0);
    });
    void readDraft<Draft>().then(value=>{if(live && value){setPending(value);setOpen(true);}});
    return()=>{live=false;subscription.unsubscribe();};
  },[]);

  async function run(task:()=>Promise<void>) { if(running.current)return;running.current=true;setBusy(true);setError('');setMessage('');try{await task();}catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{running.current=false;setBusy(false);} }
  async function refreshLibrary() {const epoch=generation.current;const result=await accountRequest<Library>('list');if(epoch===generation.current)setLibrary(result);}
  async function capture(analysis:AidAnalysis,files:File[]) {
    if(!accountClient)return;
    const epoch=generation.current;
    const encoded=await Promise.all(files.map(async file=>{
      const bytes=new Uint8Array(await file.arrayBuffer());let binary='';
      for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
      const type=file.type || ({pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'} as Record<string,string>)[file.name.split('.').pop()?.toLowerCase() || ''];
      return {name:file.name,type,data:btoa(binary)};
    }));
    if(epoch!==generation.current)return;
    draft.current={sourceId:crypto.randomUUID(),analysis,files:encoded,questions:[],owner:userRef.current?.id || null};
    conversation.current=crypto.randomUUID();void activity('document_uploaded');
  }
  function question(text:string,answer:AskAnswer) {
    if(!accountClient)return;
    if(!draft.current)draft.current={sourceId:crypto.randomUUID(),analysis:null,files:[],questions:[],owner:userRef.current?.id || null};
    if(!draft.current.questions.length)void activity('conversation_started');
    draft.current.questions.push({id:crypto.randomUUID(),conversationId:conversation.current,question:text,answer});
    void activity('ask_fynliq_question');
  }
  function save() {setOpen(true);void run(async()=>{
    if(!draft.current)throw new Error('Upload a document or ask a question first.');
    setPending({...draft.current,questions:[...draft.current.questions]});
    // Staging is explicit and stays bound to this browser tab through OAuth.
    await stageDraft(draft.current);
  });}
  async function persist() {
    const current=userRef.current, value=pending;
    if(!current || !value)return;
    if(value.owner && value.owner!==current.id)throw new Error('This draft belongs to a different account.');
    const epoch=generation.current;
    if(value.analysis){await accountRequest('save-document',{...value,consent:true});void activity('document_saved',value.sourceId);}
    for(const item of value.questions){if(epoch!==generation.current)return;await accountRequest('save-question',item);}
    if(epoch!==generation.current)return;
    await clearDraft();setPending(null);setMessage('Saved to your Fynliq account.');await refreshLibrary();
  }
  async function google() {
    if(!accountClient)return;await activity('signup_started');
    const {error}=await accountClient.auth.signInWithOAuth({provider:'google',options:{redirectTo:`${window.location.origin}/account`}});
    if(error)throw error;
  }
  async function sendEmail() {
    if(!accountClient)return;await activity('signup_started');
    const {error}=await accountClient.auth.signInWithOtp({email,options:{emailRedirectTo:`${window.location.origin}/account`,shouldCreateUser:true}});
    if(error)throw error;setSent(true);setMessage('Check your email for your sign-in code.');
  }
  async function verify() {
    if(!accountClient)return;const {error}=await accountClient.auth.verifyOtp({email,token:code,type:'email'});
    if(error)throw error;setSent(false);
  }
  async function logout() {
    await activity('logout');await clearDraft();
    const {error}=await accountClient!.auth.signOut({scope:'local'});
    if(error)throw error;
    generation.current++;draft.current=null;setPending(null);setLibrary(null);setOpen(false);
    window.dispatchEvent(new Event('fynliq:clear-private'));
  }
  const context:Context={enabled:Boolean(accountClient),user,open:()=>{setOpen(true);if(user)void run(refreshLibrary);},capture,question,save};
  return <AccountContext.Provider value={context}>{children}
    {accountClient && open && <dialog ref={dialog} onCancel={()=>setOpen(false)} className={styles.panel} aria-labelledby="account-title">
      <button className={styles.close} onClick={()=>setOpen(false)} aria-label="Close account">×</button>
      <h2 id="account-title">{user?'Your Fynliq account':'Save this to Fynliq'}</h2>
      {!ready?<p>Restoring your session…</p>:!user?<>
        <p>Create your Fynliq account to securely save your information and access it later.</p>
        <button disabled={busy} onClick={()=>void run(google)}>Continue with Google</button>
        <form onSubmit={e=>{e.preventDefault();void run(sent?verify:sendEmail);}}>
          <label>Email<input type="email" required autoComplete="email" value={email} disabled={busy||sent} onChange={e=>setEmail(e.target.value)}/></label>
          {sent && <label>Code from your email<input required inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value)}/></label>}
          <button disabled={busy} type="submit">{sent?'Verify code':'Continue with email'}</button>
          {sent && <button type="button" disabled={busy} onClick={()=>setSent(false)}>Use a different email or resend</button>}
        </form>
      </>:<>
        <p>Signed in as {user.email}</p>
        {pending && <section><p>Save {pending.analysis?'your uploaded files and aid summary':'your questions'}{pending.analysis && pending.questions.length?' and Ask Fynliq activity':''} privately to this account?</p><p>Only save information that belongs to you. Your selected information will be stored privately with Supabase.</p><button disabled={busy} onClick={()=>void run(persist)}>Confirm save to this account</button><button disabled={busy} onClick={()=>void run(async()=>{await clearDraft();setPending(null);})}>Discard pending save</button></section>}
        <button disabled={busy} onClick={()=>void run(refreshLibrary)}>Show saved information</button>
        {library && <section>
          <h3>Saved documents</h3>
          {!library.documents.length && <p>No saved documents yet.</p>}
          {library.documents.map(doc=><div key={doc.id}>
            <p>{doc.names.join(', ')}</p>
            <button disabled={busy} onClick={()=>void run(async()=>{
              const epoch=generation.current;
              const result=await accountRequest<{analysis:AidAnalysis}>('load-document',{id:doc.id});
              if(epoch!==generation.current)return;
              window.dispatchEvent(new CustomEvent('fynliq:load-document',{detail:result.analysis}));setOpen(false);
            })}>Open aid summary</button>
            {doc.names.map((name,index)=><button key={index} disabled={busy} onClick={()=>void run(()=>downloadSavedFile(doc.id,index,name))}>Download {name}</button>)}
            <button disabled={busy} onClick={()=>{if(window.confirm('Permanently delete these saved files and their summary?'))void run(async()=>{await accountRequest('delete-document',{id:doc.id});await refreshLibrary();});}}>Delete saved document</button>
          </div>)}
          <h3>Saved questions</h3>
          {library.questions.map(q=><details key={q.id}><summary>{q.question}</summary>{q.answer.paragraphs.map((p,i)=><p key={i}>{p}</p>)}<button disabled={busy} onClick={()=>{if(window.confirm('Permanently delete this saved question and answer?'))void run(async()=>{await accountRequest('delete-question',{id:q.id});await refreshLibrary();});}}>Delete saved question</button></details>)}
        </section>}
        <button disabled={busy} onClick={()=>void run(logout)}>Sign out</button>
      </>}
      {busy && <p role="status">Please wait…</p>}{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    </dialog>}
  </AccountContext.Provider>;
}

export function AccountButton(){const account=useAccount();return account.enabled?<button className={styles.button} onClick={account.open}>{account.user?'My account':'Sign in'}</button>:null;}
export function SaveAccountButton(){const account=useAccount();return account.enabled?<button className={styles.button} onClick={account.save}>Save this to Fynliq</button>:null;}
