import { stripeRequest,keyMode } from '../server/stripe.js';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'GET required'});
 const id=String(req.query?.session_id||'');
 if(!/^cs_(test_|live_)[A-Za-z0-9]{8,200}$/.test(id))return res.status(400).json({error:'Invalid session'});
 const key=process.env.STRIPE_SECRET_KEY;
 if(!keyMode(key))return res.status(503).json({error:'Unavailable'});
 try{
  const s=await stripeRequest({secretKey:key,method:'GET',path:'/checkout/sessions/'+encodeURIComponent(id)});
  const paid=s.payment_status==='paid'&&s.amount_total===5000&&s.currency==='usd'&&s.metadata?.purpose==='fynq_consultation_30min';
  return res.status(200).json({paid,email:paid?(s.customer_details?.email||''):undefined});
 }catch{return res.status(502).json({error:'Could not verify payment'});}
}