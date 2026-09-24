// Only explicitly saved drafts are staged, encrypted with a key held by this tab.
// Other tabs/accounts are never searched for drafts. Drafts expire in one hour.
const keyName='fynliq.pending-key';
async function db() {
  return new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open('fynliq-pending',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('drafts');
    request.onsuccess=()=>{
      const database=request.result;
      const cleanup=database.transaction('drafts','readwrite');
      const cursor=cleanup.objectStore('drafts').openCursor();
      cursor.onsuccess=()=>{const row=cursor.result;if(row){if(row.value.expires<Date.now())row.delete();row.continue();}};
      cleanup.oncomplete=()=>resolve(database);
      cleanup.onerror=()=>{database.close();reject(cleanup.error);};
    };
    request.onerror=()=>reject(request.error);
  });
}
async function operation<T>(mode:IDBTransactionMode,run:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T> {
  const database=await db();
  try { return await new Promise<T>((resolve,reject)=>{ const transaction=database.transaction('drafts',mode); const request=run(transaction.objectStore('drafts')); transaction.oncomplete=()=>resolve(request.result); transaction.onerror=()=>reject(transaction.error); transaction.onabort=()=>reject(transaction.error); }); }
  finally { database.close(); }
}
export async function stageDraft(value:unknown) {
  await clearDraft();
  const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
  const raw=Array.from(new Uint8Array(await crypto.subtle.exportKey('raw',key)));
  const id=crypto.randomUUID(), iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(value)));
  await operation('readwrite',store=>store.put({encrypted,iv,expires:Date.now()+3600000},id));
  sessionStorage.setItem(keyName,JSON.stringify({id,raw}));
}
export async function readDraft<T>():Promise<T|null> {
  try {
    const info=sessionStorage.getItem(keyName); if(!info) return null;
    const {id,raw}=JSON.parse(info);
    const record=await operation('readonly',store=>store.get(id));
    if(!record || record.expires<Date.now()) { await clearDraft(); return null; }
    const key=await crypto.subtle.importKey('raw',new Uint8Array(raw),{name:'AES-GCM'},false,['decrypt']);
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:record.iv},key,record.encrypted);
    return JSON.parse(new TextDecoder().decode(plain));
  } catch { await clearDraft(); return null; }
}
export async function clearDraft() {
  let info:string|null=null;
  try{info=sessionStorage.getItem(keyName);sessionStorage.removeItem(keyName);}catch{return;}
  if(info) { try { await operation('readwrite',store=>store.delete(JSON.parse(info).id)); } catch { /* Removing the tab key makes the draft unreadable. */ } }
}
