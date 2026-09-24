import { describe,it,expect,vi } from 'vitest';
import { createHash } from 'node:crypto';
import { saveDocument,loadDocument } from './account-service.js';
import { signSummary } from './summary.js';
const sourceId='12345678-1234-4234-8234-123456789abc';
const user={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
const secret='test-only-not-an-api-key';
const bytes=Buffer.from('%PDF-1.4 synthetic test');
const facts=[{id:'f1',field:'balanceDue',label:'Balance due',value:'1800',page:1,document:1,kind:'account-statement',period:'Fall 2026',estimated:false,quote:'Balance due: $1,800'}];
function fakeDb(){
  const rows=[];const upload=vi.fn(async()=>({error:null})),remove=vi.fn(async()=>({error:null}));
  return {rows,upload,remove,storage:{from:()=>({upload,remove})},from:()=>{
    const filters=[];const q={select:()=>q,eq:(key,value)=>{filters.push([key,value]);return q;},maybeSingle:async()=>({data:rows.find(row=>filters.every(([k,v])=>row[k]===v))||null,error:null}),insert:async row=>{rows.push(row);return {error:null};}};return q;
  }};
}
function input(){return {sourceId,consent:true,analysis:{summaryToken:signSummary(facts,secret,Date.now(),[createHash('sha256').update(bytes).digest('hex')])},files:[{name:'test.pdf',type:'application/pdf',data:bytes.toString('base64')}]};}
describe('private document saves',()=>{
  it('saves trusted fields and preserves ownership; duplicate migration uploads nothing twice',async()=>{
    const db=fakeDb(),value=input();
    const first=await saveDocument(db,user,value,secret),second=await saveDocument(db,user,value,secret);
    expect(second).toEqual(first);expect(db.upload).toHaveBeenCalledTimes(1);expect(db.rows).toHaveLength(1);
    expect(db.rows[0].user_id).toBe(user.id);expect(db.rows[0].analysis.summaryToken).toBeUndefined();
    expect(db.rows[0].analysis.summaryFacts[0].value).toBe('1800');
  });
  it('rejects substituted files and does not upload them',async()=>{
    const db=fakeDb(),value=input();value.files[0].data=Buffer.from('%PDF-1.4 other file').toString('base64');
    await expect(saveDocument(db,user,value,secret)).rejects.toMatchObject({status:400});expect(db.upload).not.toHaveBeenCalled();
  });
  it('rejects forged summaries before any file is saved',async()=>{
    const db=fakeDb(),value=input();value.analysis.summaryToken='forged';
    await expect(saveDocument(db,user,value,secret)).rejects.toMatchObject({status:400});expect(db.upload).not.toHaveBeenCalled();
  });
  it('does not load another user record even with a valid document id',async()=>{
    const db=fakeDb();const {id}=await saveDocument(db,user,input(),secret);
    await expect(loadDocument(db,{id:'another-user'},id,secret)).rejects.toMatchObject({status:404});
  });
});
