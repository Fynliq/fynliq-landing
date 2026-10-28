import { useState } from 'react';
import { dollars, proposeMatch, type Offer, type Side } from '../exchange/matching';
import styles from './Exchange.module.css';

const goods = [
  {sku:'sneaker',label:'Retro high-top sneakers',category:'Sneakers',variant:'Size 10 · New',symbol:'↗',buy:14500,sell:16000},
  {sku:'hoodie',label:'Heavyweight hoodie',category:'Clothing',variant:'Medium · New',symbol:'✳',buy:5200,sell:6000},
  {sku:'console',label:'Game console',category:'Electronics',variant:'Disc edition · Used good',symbol:'▣',buy:28000,sell:31000},
  {sku:'calculator',label:'Graphing calculator',category:'College',variant:'Standard · Used good',symbol:'∑',buy:7400,sell:8200}
] as const;
type Good = (typeof goods)[number];
type Line = {who:'user'|'bot', text:string};
const seeded:Offer[] = goods.flatMap((g,i)=>[
  {id:'ask-'+i,side:'sell' as Side,variantId:g.sku,ownerId:'seller-'+i,priceCents:g.sell,status:'open' as const,createdAt:i*2},
  {id:'bid-'+i,side:'buy' as Side,variantId:g.sku,ownerId:'buyer-'+i,priceCents:g.buy,status:'open' as const,createdAt:i*2+1}
]);
export function Exchange() {
 const [selected,setSelected]=useState<Good>(goods[0]);
 const [orders,setOrders]=useState<Offer[]>(seeded);
 const [side,setSide]=useState<Side>('buy');
 const [price,setPrice]=useState('165');
 const [notice,setNotice]=useState('');
 const [command,setCommand]=useState('');
 const [conversation,setConversation]=useState<Line[]>([{who:'bot',text:'Welcome to Fynliq Exchange. Try PRICE SNEAKER, BUY SNEAKER 165, or SELL HOODIE 50. This is simulated Messages, not real SMS.'}]);
 const active=orders.filter(o=>o.variantId===selected.sku&&o.status==='open');
 const highest=[...active].filter(o=>o.side==='buy').sort((a,b)=>b.priceCents-a.priceCents);
 const lowest=[...active].filter(o=>o.side==='sell').sort((a,b)=>a.priceCents-b.priceCents);
 function place(kind:Side,item:Good,value:string) {
  if(!/^\d+(\.\d{1,2})?$/.test(value.trim())) return 'Enter a valid price in dollars.';
  const cents=Math.round(Number(value)*100);
  if(cents<100||cents>10000000) return 'Price must be $1–$100,000.';
  const incoming:Offer={id:'demo-'+Date.now()+'-'+Math.random(),side:kind,variantId:item.sku,ownerId:'visitor',priceCents:cents,status:'open',createdAt:Date.now()};
  const proposal=proposeMatch(incoming,orders);
  if(proposal) {
   const counterparty=kind==='buy'?proposal.sellerOrderId:proposal.buyerOrderId;
   setOrders(existing=>existing.map(o=>o.id===counterparty?{...o,status:'reserved'}:o));
   return 'Price match proposed at '+dollars(proposal.tradePriceCents)+' for '+item.label+'. No purchase, reservation, shipment or payment has occurred.';
  }
  setOrders(existing=>[incoming,...existing]);
  return (kind==='buy'?'Bid':'Ask')+' recorded at '+dollars(cents)+' in this browser demo. Refresh resets offers.';
 }
 function onSend(e:React.FormEvent) {
  e.preventDefault();
  const message=command.trim(); if(!message)return;
  const [operation='',sku='',amount='']=message.split(/\s+/);
  const item=goods.find(g=>g.sku===sku.toLowerCase());
  let answer='Use PRICE SNEAKER, BUY SNEAKER 165, or SELL HOODIE 50.';
  if(item) {
   const nearby=orders.filter(o=>o.variantId===item.sku&&o.status==='open');
   if(operation.toUpperCase()==='PRICE') {
    const buys=nearby.filter(o=>o.side==='buy').map(o=>o.priceCents);
    const sells=nearby.filter(o=>o.side==='sell').map(o=>o.priceCents);
    answer=item.label+': best bid '+(buys.length?dollars(Math.max(...buys)):'none')+', lowest ask '+(sells.length?dollars(Math.min(...sells)):'none')+'. Demo prices only.';
   }
   if(operation.toUpperCase()==='BUY'||operation.toUpperCase()==='SELL')
    answer=place(operation.toUpperCase()==='BUY'?'buy':'sell',item,amount);
  }
  setConversation(prev=>[...prev,{who:'user',text:message},{who:'bot',text:answer}]);setCommand('');
 }
 return <div className={styles.exchange}>
  <header className={styles.header}><a href="/" className={styles.logo}><span>F</span> FYNLIQ <em>/ EXCHANGE</em></a><a href="/" className={styles.home}>Back to Fynliq ↗</a></header>
  <main className={styles.wrap}>
   <section className={styles.hero}><small>✦ THE MARKETPLACE WHERE YOUR PRICE MATTERS</small><h1>What's it worth <i>to you?</i></h1><p>Buyers bid. Sellers ask. Fynliq finds the match. A market for real products, built for text-first trading.</p></section>
   <div className={styles.banner}><span>●</span> INTERACTIVE PROTOTYPE — NO ACTUAL USERS, TRADES, OR MONEY MOVEMENT</div>
   <section className={styles.columns}>
    <div><h2>Explore the exchange</h2><div className={styles.products}>{goods.map(g=><button type="button" className={styles.product+' '+(selected.sku===g.sku?styles.selected:'')} onClick={()=>{setSelected(g);setNotice('')}} key={g.sku}><b className={styles.itemIcon}>{g.symbol}</b><span><small>{g.category}</small><strong>{g.label}</strong><small>{g.variant}</small></span><span>↗</span></button>)}</div>
    <div className={styles.book}><small>PRICE DISCOVERY · {selected.variant}</small><h3>{selected.label}</h3><div className={styles.quotes}><div><small>HIGHEST BID</small><strong className={styles.up}>{highest[0]?dollars(highest[0].priceCents):'—'}</strong><span>Buyers offer</span></div><div><small>LOWEST ASK</small><strong>{lowest[0]?dollars(lowest[0].priceCents):'—'}</strong><span>Sellers want</span></div></div><div className={styles.depth}><div><h4>BUY ORDERS</h4>{highest.slice(0,4).map(o=><p key={o.id}>Bid <b className={styles.up}>{dollars(o.priceCents)}</b></p>)}</div><div><h4>SELL ORDERS</h4>{lowest.slice(0,4).map(o=><p key={o.id}>Ask <b>{dollars(o.priceCents)}</b></p>)}</div></div></div></div>
    <div><form className={styles.panel} onSubmit={e=>{e.preventDefault();setNotice(place(side,selected,price));}}><h2>Your price, your move</h2><div className={styles.tabs}><button type="button" className={side==='buy'?styles.on:''} onClick={()=>setSide('buy')}>Place bid</button><button type="button" className={side==='sell'?styles.on:''} onClick={()=>setSide('sell')}>Set ask</button></div><label>Your {side==='buy'?'maximum bid':'minimum ask'}<div className={styles.amount}><span>$</span><input type="number" aria-label="Price in dollars" min="1" max="100000" step="0.01" value={price} onChange={e=>setPrice(e.target.value)}/></div></label><button className={styles.cta} type="submit">Submit demo {side} ↗</button><p className={styles.small}>Simulated only; no offers or user data are sent to a server.</p>{notice&&<p className={styles.notice} role="status">{notice}</p>}</form>
    <div className={styles.panel}><div className={styles.msgHeader}><span className={styles.avatar}>F</span><div><h3>Fynliq Messages</h3><small>Simulated text commands, not live SMS</small></div></div><div className={styles.chat} aria-live="polite">{conversation.map((line,i)=><p key={i} className={line.who==='user'?styles.userBubble:styles.botBubble}>{line.text}</p>)}</div><form className={styles.chatForm} onSubmit={onSend}><input aria-label="Message command" value={command} onChange={e=>setCommand(e.target.value)} maxLength={120} placeholder="PRICE SNEAKER"/><button type="submit" aria-label="Send message">↑</button></form></div></div>
   </section>
   <section className={styles.outro}><h2>One exchange. More possibilities.</h2><p>First sneakers and apparel, then electronics, college essentials and retailer inventory. Live payments, inventory verification, authentication, shipping and SMS come only after the secured backend is built and reviewed.</p></section>
  </main><footer className={styles.footer}>Fynliq Exchange · Prototype only <span>Matching prices is not a completed sale.</span></footer>
 </div>;
}
