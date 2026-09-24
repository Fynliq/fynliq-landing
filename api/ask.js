import {answerQuestion} from '../server/ask-service.js';
import {containsHighRiskPII,PRIVACY_MESSAGE} from '../server/privacy.js';
import {clients,session,sameOrigin,body,rpc,rate,positive,fail,BetaError,cookie,token} from '../server/beta.js';
export const config={maxDuration:60};
export function createAskHandler(dependencies={}) {return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  try {
    if(req.method!=='POST')throw new BetaError(405,'Use POST to ask a question.');
    const env=dependencies.env||process.env,{db}=(dependencies.clients||clients)(env);
    const user=await session(req,db,env);sameOrigin(req,env);await rate(db,req,'ask',10,env);
    const payload=body(req);
    if(typeof payload?.question!=='string'||!payload.question.trim()||payload.question.trim().length>1000)throw new BetaError(400,'Please enter a question between 1 and 1,000 characters.');
    if(containsHighRiskPII(payload.question))throw new BetaError(422,PRIVACY_MESSAGE);
    if(!env.OPENAI_API_KEY||!env.OPENAI_MODEL)throw new BetaError(503,'The answer service is not configured yet.');
    const cap=positive(env.OPENAI_MAX_OUTPUT_TOKENS,1200,4000);
    const reservation=await rpc(db,'beta_reserve_question',{p_user:user.user_id,p_session:user.id,
      p_global:positive(env.BETA_MAX_QUESTIONS_PER_DAY,10000),p_daily:positive(env.ASK_USER_MAX_PER_DAY,50),p_minute:positive(env.ASK_USER_MAX_PER_MINUTE,8)});
    if(!reservation.allowed)throw new BetaError(429,'The beta question limit has been reached. Please try again later.');
    res.setHeader('Set-Cookie',cookie(token(req),30*24*60*60));
    let result;
    try{result=await (dependencies.answer||answerQuestion)(payload,{apiKey:env.OPENAI_API_KEY,model:env.OPENAI_MODEL,maxOutputTokens:cap});}
    catch{result={status:502,error:'The answer service is temporarily unavailable.'};}
    await rpc(db,'beta_finish_question',{p_id:reservation.id,p_success:!result.error});
    if(result.error)return res.status(result.status).send(result.error);
    return res.status(200).json(result.body);
  }catch(error){return fail(res,error);}
};}
export default createAskHandler();
