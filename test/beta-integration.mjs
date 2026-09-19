import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile,mkdtemp,cp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createAskHandler} from '../api/ask.js';
import {createAuthHandler} from '../api/beta-auth.js';
import {createAdminHandler} from '../api/beta-admin.js';
import analyze from '../api/analyze.js';
import account from '../api/account.js';
import {containsHighRiskPII} from '../server/privacy.js';
import {answerQuestion} from '../server/ask-service.js';
import {structuredResponse} from '../server/provider.js';
import {signSummary} from '../server/summary.js';
const folder=await mkdtemp(path.join(os.tmpdir(),'fynliq-synthetic-beta-'));
// Optional reuse of a known synthetic test database avoids duplicate WASM init on low-memory machines.
if(process.env.BETA_SYNTHETIC_TEMPLATE){
 const source=path.resolve(process.env.BETA_SYNTHETIC_TEMPLATE);
 assert.equal(path.dirname(source),path.resolve(os.tmpdir()));assert.ok(path.basename(source).startsWith('fynliq-synthetic-beta-'));
 await cp(source,folder,{recursive:true});
}
let pg=new PGlite(folder,{initialMemory:128*1024*1024});
if(process.env.BETA_SYNTHETIC_TEMPLATE)await pg.exec('drop schema public cascade; create schema public;');
else await pg.exec('create role anon; create role authenticated; create role service_role bypassrls;');
await pg.exec(await readFile(new URL('../supabase/migrations/202609170002_closed_beta.sql',import.meta.url),'utf8'));
await pg.exec('grant usage on schema public to anon, authenticated, service_role');
const db={async rpc(name,args={}){try{const entries=Object.entries(args);const result=await pg.query('select public.'+name+'('+entries.map(([k],i)=>k+'=> $'+(i+1)).join(',')+') as value',entries.map(([,v])=>v));return {data:result.rows[0]?.value,error:null};}catch{return {error:true};}}};
let id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';const other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const env={BETA_ENABLED:'true',BETA_ORIGIN:'https://beta.example.test',BETA_RATE_SECRET:'synthetic-only-secret-32-characters-long',OPENAI_API_KEY:'synthetic',OPENAI_MODEL:'synthetic',BETA_MAX_QUESTIONS_PER_DAY:'10000',OPENAI_MAX_OUTPUT_TOKENS:'1200',BETA_ADMIN_USER_IDS:other};
let authCalls=0,openaiCalls=0;
const auth={auth:{signInWithOtp:async options=>{authCalls++;assert.equal(options.options.shouldCreateUser,false);return {error:null};},verifyOtp:async ({email,token})=>token==='123456'?{data:{user:{id:email.startsWith('admin')?other:id,email,email_confirmed_at:new Date().toISOString()}},error:null}:{error:true}}};
const dependencies={env,clients:()=>({db,auth})};
function response(){return {statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},send(v){this.body=v;return this;},json(v){this.body=v;return this;}};}
async function call(handler,body,cookie='',method='POST'){const res=response();await handler({method,body,headers:{'content-type':'application/json',origin:env.BETA_ORIGIN,cookie},socket:{remoteAddress:'192.0.2.1'}},res);return res;}
let passed=0;
async function test(name,run){await run();passed++;console.log('PASS '+name);}
const login=createAuthHandler(dependencies);
const ask=createAskHandler({...dependencies,answer:async(p,options)=>{openaiCalls++;assert.equal(options.maxOutputTokens,1200);return {status:200,body:{paragraphs:['SYNTHETIC_ANSWER_MARKER'],basis:'general',grounding:[],missing:null,relatedIds:[]}};}});
let cookie='';
try{
await test('uninvited signup never invokes provider or creates account',async()=>{
 const res=await call(login,{action:'send',email:'notinvited@example.test'});assert.equal(res.statusCode,200);assert.equal(authCalls,0);
 assert.equal((await call(login,{action:'verify',email:'notinvited@example.test',code:'123456'})).statusCode,401);
 assert.equal((await db.rpc('beta_metrics')).data.total_users,0);
});
await pg.query("insert into public.beta_invites(email) values ('student@example.test'),('admin@example.test')");
await test('public anonymous guest needs no invitation and receives stable opaque cookie',async()=>{
 const res=await call(login,{action:'guest'});assert.equal(res.statusCode,200);id=res.body.user.id;
 cookie=res.headers['Set-Cookie'].split(';')[0];assert.match(res.headers['Set-Cookie'],/HttpOnly; Secure; SameSite=Strict/);
 assert.ok(!cookie.includes(id));assert.equal((await call(login,{action:'guest'},cookie)).body.user.id,id);
 assert.equal((await db.rpc('beta_metrics')).data.total_users,1);
});
await test('unauthenticated ask blocked before provider',async()=>{assert.equal((await call(ask,{question:'Pell Grant?'})).statusCode,401);assert.equal(openaiCalls,0);});
await test('login and passive session checks do not count as DAU WAU MAU',async()=>{
 await call(login,undefined,cookie,'GET');const m=(await db.rpc('beta_metrics')).data;
 assert.equal(m.dau,0);assert.equal(m.wau,0);assert.equal(m.mau,0);assert.equal(m.total_users,1);
});
const pii=['SSN 123-45-6789','123456789','tax ID 12-3456789','routing number: 021000021','bank account 1234 5678 9012','account # 12345678','my password is SyntheticSecret!','FSA ID: fake-student','FSA login is fake-student','username: fake-user','password: abc','IBAN GB82WEST12345698765432'];
await test('synthetic high-risk PII blocked before any provider call',async()=>{
 for(const question of pii){await pg.exec('delete from public.beta_rate_windows');assert.equal(containsHighRiskPII(question),true,question);assert.equal((await call(ask,{question},cookie)).statusCode,422);}
 assert.equal(openaiCalls,0);assert.equal((await db.rpc('beta_metrics')).data.total_questions,0);
});
await test('normal aid amounts and general credential-help questions accepted by detector',async()=>{
 for(const q of ['My Pell Grant is $7,395. What does it cover?','What is an FSA ID?','How do I reset my password?','What does account balance mean?'])assert.equal(containsHighRiskPII(q),false,q);
});
await test('successful question uses stable account ID and records outcome only',async()=>{
 await pg.exec('delete from public.beta_rate_windows');
 const res=await call(ask,{question:'SYNTHETIC_QUESTION_MARKER What is a Pell Grant?'},cookie);assert.equal(res.statusCode,200);assert.equal(openaiCalls,1);
 const m=(await db.rpc('beta_metrics')).data;assert.equal(m.total_questions,1);assert.equal(m.successful_answers,1);assert.equal(m.activated_users,1);assert.equal(m.mau,1);assert.equal(m.users[0].user_id,id);
 const tables=['anonymous_users','events','beta_sessions','beta_questions','beta_rate_windows','beta_invites'];
 for(const table of tables){const dump=JSON.stringify((await pg.query('select * from public.'+table)).rows);assert.ok(!dump.includes('SYNTHETIC_QUESTION_MARKER'));assert.ok(!dump.includes('SYNTHETIC_ANSWER_MARKER'));}
});
await test('student cannot access admin; explicit admin can',async()=>{
 const admin=createAdminHandler(dependencies);assert.ok([401,403].includes((await call(admin,undefined,cookie,'GET')).statusCode));
 const res=await call(login,{action:'verify',email:'admin@example.test',code:'123456'});assert.equal(res.statusCode,200);
 const result=await call(admin,undefined,res.headers['Set-Cookie'].split(';')[0],'GET');assert.equal(result.statusCode,200);
 for(const key of ['total_signups','activated_users','returning_users','dau','wau','mau','total_questions','successful_answers','failed_answers'])assert.ok(key in result.body);
});
await test('returning guest requires question activity on a separate UTC day',async()=>{
 assert.equal((await db.rpc('beta_metrics')).data.returning_users,0);
 await pg.query("update public.beta_questions set created_at=now()-interval '1 day' where user_id=$1",[id]);
 await call(ask,{question:'Explain subsidized loans.'},cookie);
 assert.equal((await db.rpc('beta_metrics')).data.returning_users,1);
 // Restore to today for subsequent daily cap checks.
 await pg.query('update public.beta_questions set created_at=now() where user_id=$1',[id]);
});
await test('global beta cap rejects before provider and cannot be disabled with zero',async()=>{
 const capped=createAskHandler({...dependencies,env:{...env,BETA_MAX_QUESTIONS_PER_DAY:'2'},answer:()=>{throw Error('must not call');}});
 assert.equal((await call(capped,{question:'Another question?'},cookie)).statusCode,429);
 const disabled=createAskHandler({...dependencies,env:{...env,BETA_MAX_QUESTIONS_PER_DAY:'0'}});
 assert.equal((await call(disabled,{question:'Another question?'},cookie)).statusCode,503);
});
await test('public launch reserves with the approved 10000 daily default',async()=>{
 const configured={...env};delete configured.BETA_MAX_QUESTIONS_PER_DAY;
 const checkedDb={async rpc(name,args){if(name==='beta_reserve_question'){assert.equal(args.p_global,10000);return {data:{allowed:false}};}return db.rpc(name,args);}};
 const budget=createAskHandler({...dependencies,env:configured,clients:()=>({db:checkedDb,auth})});
 assert.equal((await call(budget,{question:'Budget check?'},cookie)).statusCode,429);
});
await test('provider failure and echoed errors never reach logs or content storage',async()=>{
 const marker='SYNTHETIC_ERROR_QUESTION';let logs='';const prior=console.error;console.error=(...args)=>{logs+=JSON.stringify(args);};
 try{const failing=createAskHandler({...dependencies,answer:()=>{throw Object.assign(Error(marker),{name:marker,code:marker});}});
 const res=await call(failing,{question:marker},cookie);assert.equal(res.statusCode,502);assert.ok(!JSON.stringify(res).includes(marker));assert.ok(!logs.includes(marker));
 assert.equal((await db.rpc('beta_metrics')).data.failed_answers,1);
 }finally{console.error=prior;}
});
await test('1000-character input cap',async()=>{assert.equal((await call(ask,{question:'x'.repeat(1001)},cookie)).statusCode,400);});
await test('raw documents and question persistence endpoints fail closed',async()=>{
 assert.equal((await call(analyze,{files:[{data:'synthetic'}]},cookie)).statusCode,503);
 assert.equal((await call(account,{question:'SYNTHETIC_QUESTION_MARKER'},cookie)).statusCode,410);
});
await test('general and personal OpenAI requests carry store:false and explicit token ceiling',async()=>{
 for(const personal of [false,true]){
 const facts=[{id:'f1',field:'grantOffer',label:'Pell Grant',value:'7000',quote:'Pell Grant $7000',period:'2026',kind:'award-letter',page:1,document:1,estimated:false}];
 const options={apiKey:'synthetic',model:'synthetic',maxOutputTokens:600,fetchImpl:async(_,req)=>{
 const input=JSON.parse(req.body);assert.equal(input.store,false);assert.equal(input.max_output_tokens,600);
 return {ok:true,json:async()=>({output:[{type:'message',content:[{type:'output_text',text:personal?JSON.stringify({paragraphs:['Your Pell Grant offer is $7000.'],usedFields:['f1']}):'A Pell Grant is gift aid.'}]}]})};}};
 const result=await answerQuestion({question:'What is a Pell Grant?',analysis:personal?{reviewed:true,summaryToken:signSummary(facts,'synthetic')}:null},options);assert.equal(result.status,200);
 }
 let called=false;await assert.rejects(()=>structuredResponse([{type:'input_image'}],'',{}, {apiKey:'synthetic',model:'synthetic',fetchImpl:()=>{called=true;}}));assert.equal(called,false);
});
await test('PII in signed facts cannot bypass question screening',async()=>{
 const facts=[{id:'f1',field:'balanceDue',label:'Balance due',value:'500',quote:'Balance $500; password: fake-secret',period:'Fall',kind:'account-statement',page:1,document:1,estimated:false}];
 let called=false;const result=await answerQuestion({question:'Explain my bill',analysis:{reviewed:true,summaryToken:signSummary(facts,'synthetic')}},{apiKey:'synthetic',model:'synthetic',fetchImpl:()=>{called=true;}});
 assert.equal(result.status,422);assert.equal(called,false);
});
await test('Postgres RLS and function privileges deny direct student access',async()=>{
 for(const role of ['anon','authenticated']){await pg.exec('set role '+role);try{await assert.rejects(()=>pg.query('select * from public.beta_questions'));await assert.rejects(()=>pg.query('select public.beta_metrics()'));}finally{await pg.exec('reset role');}}
 await pg.exec('set role service_role');try{assert.ok((await pg.query('select public.beta_metrics() as metrics')).rows[0].metrics.total_questions>0);}finally{await pg.exec('reset role');}
});
await test('MAU and WAU rolling windows exclude old actions and include today',async()=>{
 await pg.exec("update public.beta_questions set created_at=now()-interval '31 days' where user_id='"+id+"'");
 let m=(await db.rpc('beta_metrics')).data;assert.equal(m.mau,0);assert.equal(m.wau,0);assert.equal(m.dau,0);
 await pg.exec("update public.beta_questions set created_at=now()-interval '20 days' where user_id='"+id+"'");
 m=(await db.rpc('beta_metrics')).data;assert.equal(m.mau,1);assert.equal(m.wau,0);
 await pg.exec("update public.beta_questions set created_at=now()-interval '6 days' where user_id='"+id+"'");
 m=(await db.rpc('beta_metrics')).data;assert.equal(m.mau,1);assert.equal(m.wau,1);assert.equal(m.dau,0);
 await pg.exec("update public.beta_questions set created_at=now() where user_id='"+id+"'");
 m=(await db.rpc('beta_metrics')).data;assert.equal(m.dau,1);assert.equal(m.wau,1);assert.equal(m.mau,1);
});
await test('metrics, sessions and global reservations survive database restart',async()=>{
 const before=(await db.rpc('beta_metrics')).data;await pg.close();pg=new PGlite(folder,{initialMemory:128*1024*1024});
 const after=(await db.rpc('beta_metrics')).data;assert.deepEqual(after,before);
 assert.equal((await call(login,undefined,cookie,'GET')).body.user.id,id);
 const cap=createAskHandler({...dependencies,env:{...env,BETA_MAX_QUESTIONS_PER_DAY:'1'}});
 assert.equal((await call(cap,{question:'After restart?'},cookie)).statusCode,429);
});
await test('anonymous_users and events contain exactly the requested content-free columns',async()=>{
 for(const [table,expected] of [['anonymous_users',['id','created_at','last_active_at']],['events',['id','user_id','event_type','created_at']]]){
  const rows=(await pg.query("select column_name from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position",[table])).rows;
  assert.deepEqual(rows.map(r=>r.column_name),expected);
 }
 assert.ok((await pg.query('select last_active_at from public.anonymous_users where id=$1',[id])).rows[0].last_active_at);
 assert.ok((await pg.query("select count(*) n from public.events where user_id=$1 and event_type='question_submitted'",[id])).rows[0].n>0);
});
await test('separate IP and per-user limits remain enforced',async()=>{
 await pg.exec('delete from public.beta_rate_windows');
 const limited=createAskHandler({...dependencies,env:{...env,ASK_USER_MAX_PER_DAY:'1'}});
 assert.equal((await call(limited,{question:'Daily cap?'},cookie)).statusCode,429);
 const minute=createAskHandler({...dependencies,env:{...env,ASK_USER_MAX_PER_MINUTE:'1'}});
 assert.equal((await call(minute,{question:'Minute cap?'},cookie)).statusCode,429);
 for(let n=0;n<10;n++)await db.rpc('beta_rate',{p_key:'synthetic-test',p_limit:10});
 assert.equal((await db.rpc('beta_rate',{p_key:'synthetic-test',p_limit:10})).data,false);
});
await test('guest cookie cannot be used as an admin session',async()=>{
 const forged=cookie.replace('__Host-fynliq_beta=','__Host-fynliq_admin=');
 assert.equal((await call(createAdminHandler(dependencies),undefined,forged,'GET')).statusCode,401);
});
await test('logout revokes the copied session cookie',async()=>{
 await pg.exec('delete from public.beta_rate_windows');
 assert.equal((await call(login,{action:'logout'},cookie)).statusCode,200);
 assert.equal((await call(ask,{question:'After logout?'},cookie)).statusCode,401);
});
console.log('RESULT '+passed+' passed; fake data only; no network provider calls. Persistent fixture: '+folder);
}finally{await pg.close();}
