import {clients,session,isAdmin,rpc,fail,BetaError} from '../server/beta.js';
import {grandfatherCutoff,testAccountIds,paywallEnabled,livemode} from '../server/billing.js';
export function createAdminHandler(dependencies={}){return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  try{
    if(req.method!=='GET')throw new BetaError(405,'Use GET.');
    const env=dependencies.env||process.env,{db}=(dependencies.clients||clients)(env),user=await session(req,db,env,true);
    if(!isAdmin(user,env))throw new BetaError(403,'Administrator access is required.');
    const metrics=await rpc(db,'beta_metrics');
    // Account sign-ups and log-ins (null until the accounts migration is applied).
    const accounts=await rpc(db,'account_metrics').catch(()=>null);
    const uploads=await rpc(db,'upload_metrics').catch(()=>null);
    // FYNQ Beta Unlock funnel and revenue (null until the billing migration is
    // applied). Admin/test accounts are excluded; live and test mode are separate.
    const billing=await (async()=>{const m=await rpc(db,'billing_metrics',{p_cutoff:grandfatherCutoff(env),p_test:[...testAccountIds(env)]});return m&&{...m,paywall_enabled:paywallEnabled(env),stripe_livemode:livemode(env)};})().catch(()=>null);
    return res.json({...metrics,accounts,uploads,billing});
  }catch(error){return fail(res,error);}
};}
export default createAdminHandler();
