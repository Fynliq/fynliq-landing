import { stripeRequest, keyMode } from '../server/stripe.js';
export default async function handler(req,res) {
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST') return res.status(405).json({error:'POST required'});
 const key=process.env.STRIPE_SECRET_KEY;
 const origin=process.env.BETA_ORIGIN;
 if(!keyMode(key)||!origin|| (keyMode(key)==='live'&&process.env.STRIPE_ALLOW_LIVE_MODE!=='true')) return res.status(503).json({error:'Checkout is not configured'});
 try {
  const session=await stripeRequest({secretKey:key,path:'/checkout/sessions',params:{
   mode:'payment',payment_method_types:['card'],
   line_items:[{price_data:{currency:'usd',unit_amount:5000,product_data:{name:'FYNQ Financial Aid Consultation',description:'One 30-minute educational consultation. No grant or aid approval guaranteed.'}},quantity:1}],
   customer_creation:'always',billing_address_collection:'auto',
   metadata:{purpose:'fynq_consultation_30min'},
   success_url:origin.replace(/\/$/,'')+'/consultation.html?session_id={CHECKOUT_SESSION_ID}',
   cancel_url:origin.replace(/\/$/,'')+'/consultation.html?cancelled=1'
  }});
  if(typeof session.url!=='string'||!session.url.startsWith('https://checkout.stripe.com/')) throw Error('invalid checkout');
  return res.status(200).json({url:session.url});
 } catch(e){console.error('Consultation checkout error',e?.name);return res.status(502).json({error:'Checkout temporarily unavailable'});}
}