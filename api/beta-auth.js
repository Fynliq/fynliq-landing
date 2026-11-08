import {clients,rpc,sameOrigin,body,session,token,hash,newSession,cookie,isAdmin,rate,fail,BetaError,guestId} from '../server/beta.js';
export function createAuthHandler(dependencies={}) {return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  try {
    const env=dependencies.env||process.env,{db,auth}=(dependencies.clients||clients)(env);
    if(req.method==='GET'){try{const user=await session(req,db,env);return res.json({user:{id:user.user_id},admin:isAdmin(user,env)});}catch(e){if(e.status===401)return res.json({user:null,admin:false});throw e;}}
    if(req.method!=='POST')throw new BetaError(405,'Use GET or POST.');
    sameOrigin(req,env);
    const input=body(req,2000);
    if(input?.action==='logout'||input?.action==='admin-logout'){const admin=input.action==='admin-logout';const value=token(req,admin);if(value)await rpc(db,'beta_logout',{p_hash:hash(value)});res.setHeader('Set-Cookie',cookie('',0,admin));return res.json({ok:true});}
    if(input?.action==='guest'){
      try{const existing=await session(req,db,env);return res.json({user:{id:existing.user_id},admin:false});}catch(e){if(e.status!==401)throw e;}
      await rate(db,req,'guest-create',100,env);
      const fresh=newSession(),id=guestId();
      await rpc(db,'beta_guest',{p_user:id,p_hash:fresh.digest});
      res.setHeader('Set-Cookie',cookie(fresh.value,30*24*60*60));
      return res.json({user:{id},admin:false});
    }
    await rate(db,req,'auth',10,env);
    const email=typeof input?.email==='string'?input.email.trim().toLowerCase():'';
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)throw new BetaError(400,'Enter your invited email address.');
    // DB admission list is provisioned by the operator, never by a public route.
    const invited=await rpc(db,'beta_invited',{p_email:email});
    if(input.action==='send'){
      if(invited){const {error}=await auth.auth.signInWithOtp({email,options:{shouldCreateUser:false}});if(error)throw new BetaError(503,'Sign-in email could not be sent. Please contact the beta organizer.');}
      return res.json({ok:true,message:'If this email has been invited, a sign-in code is on its way.'});
    }
    if(input.action!=='verify'||typeof input.code!=='string'||!/^\d{6,10}$/.test(input.code)||!invited)throw new BetaError(401,'The code or invitation is not valid.');
    const {data,error}=await auth.auth.verifyOtp({email,token:input.code,type:'email'});
    if(error||!data?.user?.email_confirmed_at||data.user.email?.toLowerCase()!==email||data.user.is_anonymous)throw new BetaError(401,'The code or invitation is not valid.');
    const prior=token(req,true),fresh=newSession();
    await rpc(db,'beta_login',{p_user:data.user.id,p_email:email,p_hash:fresh.digest,p_previous:prior?hash(prior):null});
    // Provider tokens stay server-side and are not persisted by Fynliq.
    res.setHeader('Set-Cookie',cookie(fresh.value,3600,true));
    return res.json({user:{id:data.user.id},admin:isAdmin({user_id:data.user.id},env)});
  }catch(error){return fail(res,error);}
};}
export default createAuthHandler();
