import {createContext,useCallback,useContext,useEffect,useRef,useState} from 'react';
import type {AidAnalysis} from '../core';
import type {AskAnswer} from '../ask/asker';
import styles from './Account.module.css';
interface User {id:string}
interface Context {enabled:boolean;user:User|null;ensureGuest:()=>Promise<User>;open:()=>void;capture:(analysis:AidAnalysis,files:File[])=>Promise<void>;question:(text:string,answer:AskAnswer)=>void;save:()=>void}
const AccountContext=createContext<Context>({enabled:true,user:null,ensureGuest:async()=>{throw new Error('Guest session unavailable');},open:()=>{},capture:async()=>{},question:()=>{},save:()=>{}});
export const useAccount=()=>useContext(AccountContext);
let pending:Promise<User>|null=null;
async function guest():Promise<User>{
 if(!pending)pending=(async()=>{
  const response=await fetch('/api/beta-auth',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'guest'})});
  if(!response.ok)throw new Error('Your guest session could not start. Please try again.');
  const data=await response.json();if(!data.user?.id)throw new Error('Guest session unavailable');return data.user;
 })().finally(()=>{pending=null;});
 return pending;
}
export function AccountProvider({children}:{children:React.ReactNode}){
 const [user,setUser]=useState<User|null>(null),[open,setOpen]=useState(false),[error,setError]=useState('');
 const dialog=useRef<HTMLDialogElement>(null);
 const ensureGuest=useCallback(async()=>{const next=await guest();setUser(next);setError('');return next;},[]);
 useEffect(()=>{void ensureGuest().catch(()=>{});},[ensureGuest]);
 useEffect(()=>{if(open&&!dialog.current?.open)dialog.current?.showModal();},[open]);
 return <AccountContext.Provider value={{enabled:true,user,ensureGuest,open:()=>setOpen(true),capture:async()=>{},question:()=>{},save:()=>{}}}>
 {children}
 {open&&<dialog ref={dialog} onCancel={()=>setOpen(false)} className={styles.panel} aria-labelledby="account-title">
 <button className={styles.close} onClick={()=>setOpen(false)} aria-label="Close guest information">×</button>
 <h2 id="account-title">Your guest session</h2>
 <p>No account or invite code is needed. A secure cookie recognizes this browser for 30 days after you ask a question. Clearing cookies or using another device creates a new guest ID.</p>
 <p>We track visits and question counts, not your question or answer text.</p>
 {!user&&<button onClick={()=>void ensureGuest().catch(()=>setError('Your guest session could not start. Please try again.'))}>Retry connection</button>}
 {error&&<p role="alert">{error}</p>}
 </dialog>}
 </AccountContext.Provider>;
}
export function AccountButton(){const account=useAccount();return <button className={styles.button} onClick={account.open}>Guest session</button>;}
export function SaveAccountButton(){return null;}
