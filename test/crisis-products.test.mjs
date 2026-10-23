import test from 'node:test';
import assert from 'node:assert/strict';
import { crisisCashReply, budgetReply } from '../server/crisis-products.js';
import { answerEarnRequest } from '../server/sms-actions.js';
import { handleEarnSms } from '../server/sms-earn.js';

test('Crisis Cash provides a truthful action menu, not promised deposits', () => {
  const msg=crisisCashReply('CRISIS');
  assert.match(msg,/AID/);
  assert.match(msg,/BUDGET/);
  assert.match(msg,/No guaranteed cash/);
  assert.match(crisisCashReply('CASH HELP'),/Crisis Cash/);
});

test('AID, food, rent and utility pathways reference official navigation', () => {
  assert.match(crisisCashReply('AID'),/usa.gov\/benefits/);
  assert.match(crisisCashReply('FOOD'),/SNAP/);
  assert.match(crisisCashReply('RENT'),/No funding or eligibility has been verified/);
  assert.match(crisisCashReply('UTILITIES'),/hardship plans/);
  assert.match(crisisCashReply('JOBS'),/careeronestop.org/);
});

test('hardship script never claims to contact creditor', () => {
  assert.match(crisisCashReply('BILL RENT'),/landlord or property manager/);
  assert.match(crisisCashReply('BILL CARD'),/fee relief/);
  assert.match(crisisCashReply('BILL MEDICAL'),/billing office/);
  assert.match(crisisCashReply('BILL'),/Choose BILL/);
  assert.match(crisisCashReply('BILL TAX'),/Choose BILL/);
  assert.match(crisisCashReply('BILL PHONE'),/Nothing was sent/);
});

test('budget arithmetic uses precise cents and does not pretend to link accounts', () => {
  const gap=budgetReply('BUDGET 1500.25 1200.50 350.05');
  assert.match(gap,/monthly gap: \$50\.30/);
  assert.match(gap,/No account linked/);
  const positive=budgetReply('BUDGET 1500 800 250');
  assert.match(positive,/remainder: \$450\.00/);
  assert.match(budgetReply('BUDGET 1600 1200 250'),/\$150\.00/);
  assert.match(budgetReply('BUDGET -50 20 10'),/Use positive dollar totals/);
  assert.match(budgetReply('BUDGET 200 100.999 20'),/at most 2 decimals/);
  assert.match(budgetReply('BUDGET 1234567890123 300 100'),/positive dollar totals/);
  assert.match(budgetReply('BUDGET foo'),/Text BUDGET/);
});

test('no fabricated payout, direct bank connection, or TikTok monetization', () => {
  const payout=crisisCashReply('PAYOUT');
  assert.match(payout,/No verified Fynliq task payouts/);
  assert.match(payout,/not sent money/);
  assert.match(crisisCashReply('TIKTOK'),/No creator revenue has been verified/);
  assert.match(crisisCashReply('SCAM'),/one-time codes/);
});

test('existing earn router routes crisis requests and leaves other commands intact', async () => {
  assert.match(await answerEarnRequest('AID'),/211/);
  assert.match(await answerEarnRequest('CRISIS'),/Crisis Cash/);
  assert.match(await answerEarnRequest('BILL CARD'),/Nothing was sent/);
  assert.match(await answerEarnRequest('PAYOUT'),/No verified/);
  assert.match(await answerEarnRequest('UBER'),/NOT booked/);
  assert.match(await answerEarnRequest('DEALS', {catalogJson:'[]'}),/No recently reviewed deals/);
  let genericCalled=false;
  const response=await answerEarnRequest('What is my next step?',{genericAnswer:async()=>{genericCalled=true;return 'Reply';}});
  assert.equal(response,'Reply');
  assert.equal(genericCalled,true);
});

test('SMS consent still prevents access to crisis tools before opt-in', async () => {
  let status=null, calls=0;
  const app=(body)=>handleEarnSms({
    body,
    getStatus:async()=>status,
    setStatus:async(next)=>{status=next;},
    answer:async(value)=>{calls++;return answerEarnRequest(value);},
  });
  assert.match(await app('AID'),/JOIN/);
  assert.equal(calls,0);
  assert.match(await app('JOIN'),/Reply YES/);
  assert.match(await app('YES'),/subscribed/);
  assert.match(await app('AID'),/usa.gov\/benefits/);
  assert.equal(calls,1);
  assert.match(await app('STOP'),/unsubscribed/);
  assert.match(await app('PAYOUT'),/JOIN/);
  assert.equal(calls,1);
});
