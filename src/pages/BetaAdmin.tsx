import {useEffect,useState} from 'react';
type MetricRow={user_id:string;signup_date:string;last_active:string|null;questions:number;successful_answers:number;is_returning:boolean};
type Series={period:string;users:number}[];
type Metrics=Record<string,unknown>&{users:MetricRow[];signups_by_day:Series;signups_by_week:Series;signups_by_month:Series};
export function BetaAdmin(){
 const [email,setEmail]=useState(''),[code,setCode]=useState(''),[sent,setSent]=useState(false);
 const [data,setData]=useState<Metrics|null>(null),[error,setError]=useState('');
 useEffect(()=>{void fetch('/api/beta-admin',{cache:'no-store',credentials:'same-origin'}).then(async r=>{if(!r.ok)throw Error(r.status===401?'Sign in with your invited administrator account, then reload.':r.status===403?'Administrator access is required.':'Beta metrics are not available yet.');return r.json();}).then(setData).catch(e=>setError(e.message));},[]);
 async function signIn(){try{const r=await fetch('/api/beta-auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:sent?'verify':'send',email,code})});if(!r.ok)throw Error('Administrator sign-in failed.');if(sent)window.location.reload();else setSent(true);}catch{setError('Administrator sign-in failed. Check your invitation and code.');}}
 return <main style={{padding:'40px',maxWidth:1200,margin:'auto'}}><h1>Fynliq beta usage</h1>{!data&&<form onSubmit={e=>{e.preventDefault();void signIn();}}><label>Administrator email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label>{sent&&<label>Email code<input required autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value)}/></label>}<button>{sent?'Verify code':'Send sign-in code'}</button></form>}
 {error&&<p role="alert">{error}</p>}
 {data&&<>
 <p>DAU counts question submissions today (UTC). WAU and MAU count distinct users submitting questions in the last 7 and 30 days. Returning means questions on at least two distinct UTC days. IDs represent guest browsers, not verified people. Page views and login alone do not count.</p>
 <dl>{[['total_signups','Total guest signups'],['activated_users','Activated users'],['returning_users','Returning users'],['dau','DAU'],['wau','WAU'],['mau','MAU'],['total_questions','Total questions'],['successful_answers','Successful answers'],['failed_answers','Failed answers'],['pending_answers','Pending answers'],['questions_per_user','Questions per user'],['new_today','New users today'],['new_7_days','New users: 7 days'],['new_30_days','New users: 30 days']].map(([key,label])=><div key={key}><dt>{label}</dt><dd>{String(data[key]??0)}</dd></div>)}</dl>
 {(['day','week','month'] as const).map(period=><section key={period}><h2>Signups by {period} (UTC)</h2><table><thead><tr><th>Period</th><th>New users</th></tr></thead><tbody>{data[`signups_by_${period}`].map(row=><tr key={row.period}><td>{row.period}</td><td>{row.users}</td></tr>)}</tbody></table></section>)}
 <h2>Participants</h2><table><thead><tr><th>Internal ID</th><th>First joined</th><th>Last meaningful activity</th><th>Questions</th><th>Successful answers</th></tr></thead><tbody>{data.users.map(u=><tr key={u.user_id}><td>{u.user_id}</td><td>{u.signup_date}</td><td>{u.last_active||'No questions yet'}</td><td>{u.questions}</td><td>{u.successful_answers}</td></tr>)}</tbody></table>
 <button onClick={()=>void fetch('/api/beta-auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'admin-logout'})}).then(r=>{if(r.ok)window.location.reload();else setError('Could not sign out. Try again.');})}>Sign out of admin</button><p>No question text, answer text, filenames or financial details are collected in these metrics. Unfinished requests older than two minutes count as failed until a final outcome is recorded.</p>
 </>}
 </main>;
}
