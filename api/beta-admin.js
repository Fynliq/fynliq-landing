import {clients,session,isAdmin,rpc,fail,BetaError} from '../server/beta.js';
export function createAdminHandler(dependencies={}){return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  try{
    if(req.method!=='GET')throw new BetaError(405,'Use GET.');
    const env=dependencies.env||process.env,{db}=(dependencies.clients||clients)(env),user=await session(req,db,env,true);
    if(!isAdmin(user,env))throw new BetaError(403,'Administrator access is required.');
    return res.json(await rpc(db,'beta_metrics'));
  }catch(error){return fail(res,error);}
};}
export default createAdminHandler();
