import test from 'node:test';
import assert from 'node:assert/strict';
import { foodMoneyReply, instacartListReply, parseGroceryList } from '../server/food-money-actions.js';
import { answerEarnRequest } from '../server/sms-actions.js';
import { handleEarnSms } from '../server/sms-earn.js';

test('official consumer food links never claim paid or placed orders', async () => {
  const cases = [
    ['DOORDASH', 'https://www.doordash.com/'],
    ['UBER EATS', 'https://www.ubereats.com/'],
    ['GRUBHUB', 'https://www.grubhub.com/'],
    ['INSTACART', 'https://www.instacart.com/'],
    ['ORDER FROM DOORDASH', 'https://www.doordash.com/'],
  ];
  for (const [cmd, url] of cases) {
    const reply = await foodMoneyReply(cmd);
    assert.ok(reply.includes(url));
    assert.match(reply, /NOT placed an order or charged/);
  }
  assert.match(await foodMoneyReply('ORDER FOOD'), /choices:/);
});

test('FOOD still means emergency aid; ORDER FOOD means shopping', async () => {
  assert.match(await answerEarnRequest('FOOD'), /SNAP/);
  assert.match(await answerEarnRequest('ORDER FOOD'), /DOORDASH/);
  assert.match(await answerEarnRequest('PAYOUT'), /No verified Fynliq/);
  assert.match(await answerEarnRequest('BUDGET 100 80 5'), /15\.00/);
  assert.match(await answerEarnRequest('UBER'), /NOT booked/);
});

test('money-moving and checkout commands fail closed without touching accounts', async () => {
  const cmds = ['SEND MONEY', 'SEND $20', 'TRANSFER $100', 'PAY BILL', 'PAY NOW', 'CHECKOUT', 'PLACE ORDER', 'CONFIRM ORDER', 'ORDER STATUS', 'CHARGE MY CARD'];
  for (const cmd of cmds) {
    const result = await answerEarnRequest(cmd, {genericAnswer:async()=>{throw Error('model must not execute transfer');}});
    assert.match(result, /No payment or transfer occurred/);
  }
  assert.match(await answerEarnRequest('MONEY'), /NOT active/);
});

test('grocery item parsing bounds quantity, length and strips linebreaks', () => {
  assert.deepEqual(parseGroceryList('GROCERY LIST: eggs, rice, milk'), ['eggs','rice','milk']);
  assert.equal(parseGroceryList('GROCERY LIST: a'), null);
  assert.equal(parseGroceryList('GROCERY LIST: eggs,\npassword'), null);
  assert.equal(parseGroceryList('GROCERY LIST: x, y'), null);
  assert.equal(parseGroceryList('GROCERY LIST: one, two, three, four, five, six, seven, eight, nine'), null);
  assert.equal(parseGroceryList('GROCERY LIST: <token>'), null);
  assert.equal(parseGroceryList('DOORDASH'), null);
});

test('without partner API key, grocery request links to Instacart without ordering', async () => {
  const msg=await instacartListReply('GROCERY LIST: eggs, rice, milk', {
    apiKey:'',
    fetchImpl:()=>{throw Error('must not call external service');}
  });
  assert.match(msg, /not connected/);
  assert.match(msg, /3 items/);
  assert.match(msg, /No order or payment was made/);
});

test('Instacart API link adapter constructs merchant checkout list, not a charge', async () => {
  let captured;
  const msg=await instacartListReply('GROCERY LIST: brown rice, oat milk', {
    apiKey:'server-only-test-key',
    environment:'development',
    fetchImpl:async (url, opts)=>{
      captured={url,opts};
      return {ok:true,json:async()=>({products_link_url:'https://www.instacart.com/store/recipes/grocery-list/abc'})};
    },
  });
  assert.equal(captured.url, 'https://connect.dev.instacart.tools/idp/v1/products/products_link');
  assert.equal(captured.opts.method,'POST');
  assert.equal(captured.opts.headers.Authorization,'Bearer server-only-test-key');
  assert.deepEqual(JSON.parse(captured.opts.body).line_items,[{name:'brown rice'},{name:'oat milk'}]);
  assert.equal(JSON.parse(captured.opts.body).link_type,'shopping_list');
  assert.match(msg,/https:\/\/www\.instacart\.com\/store\//);
  assert.match(msg,/No order or charge was made/);
  assert.ok(!msg.includes('server-only-test-key'));
});

test('reject redirect to lookalike financial/phishing site and API errors', async () => {
  for (const unsafe of ['https://instacart.com.attacker.example/x','http://www.instacart.com/x','https://localhost/private','https://evil.example/']) {
    const result=await instacartListReply('GROCERY LIST: eggs, milk', {
      apiKey:'server-only-secret',
      fetchImpl:async()=>({ok:true,json:async()=>({products_link_url:unsafe})}),
    });
    assert.match(result,/service is unavailable/);
    assert.doesNotMatch(result,/attacker\.example|evil\.example|localhost/);
  }
  const fail=await instacartListReply('GROCERY LIST: eggs, milk',{
    apiKey:'server-only-secret',
    fetchImpl:async()=>({ok:false,status:429}),
  });
  assert.match(fail,/No order was placed or charged/);
  const invalidEnv=await instacartListReply('GROCERY LIST: eggs, milk',{apiKey:'secret',environment:'javascript:invalid'});
  assert.match(invalidEnv,/No order or charge occurred/);
});

test('sensitive payment requests require SMS opt-in, and never execute transactions', async () => {
  let status=null;
  const runner=async body=>handleEarnSms({
    body,
    getStatus:async()=>status,
    setStatus:async s=>{status=s;},
    answer:answerEarnRequest,
  });
  assert.match(await runner('DOORDASH'),/JOIN/);
  assert.match(await runner('JOIN'),/Reply YES/);
  assert.match(await runner('YES'),/subscribed/);
  assert.match(await runner('DOORDASH'),/NOT placed an order/i);
  assert.match(await runner('SEND MONEY'),/No payment or transfer occurred/);
  assert.match(await runner('STOP'),/unsubscribed/);
  assert.match(await runner('DOORDASH'),/JOIN/);
});
