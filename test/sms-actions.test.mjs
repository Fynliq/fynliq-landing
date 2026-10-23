import test from 'node:test';
import assert from 'node:assert/strict';
import { answerEarnRequest, reviewedDeals, dealsReply, draftCustomerDeliverable, UBER_RIDE_LINK } from '../server/sms-actions.js';
import { handleEarnSms } from '../server/sms-earn.js';
import { createSmsConsentStore } from '../server/sms-consent-store.js';

test('Uber handoff always requires customer confirmation and never claims booking', async () => {
  for (const message of ['UBER', 'book an uber', 'RIDE']) {
    const answer = await answerEarnRequest(message, {
      genericAnswer: () => { throw new Error('should not use generic AI'); },
    });
    assert.ok(answer.includes(UBER_RIDE_LINK));
    assert.match(answer, /NOT booked/);
    assert.doesNotMatch(answer, /your driver|ride confirmed/i);
  }
});

test('deal responses require reviewed source, recent review and unexpired offer', async () => {
  const now = new Date('2026-10-22T15:00:00Z');
  const catalog = [
    { title: 'Unreviewed 99% discount', reviewedByFynliq: false, reviewedAt:'2026-10-22T14:00:00Z', expiresAt:'2026-10-31T14:00:00Z', sourceUrl:'https://example.com/sale' },
    { title: 'Expired fake promotion', reviewedByFynliq: true, reviewedAt:'2026-10-22T14:00:00Z', expiresAt:'2026-10-20T14:00:00Z', sourceUrl:'https://example.com/sale' },
    { title: 'Reviewed sample partner promotion', reviewedByFynliq: true, reviewedAt:'2026-10-22T14:00:00Z', expiresAt:'2026-10-31T14:00:00Z', sourceUrl:'https://example.com/terms' },
    { title: 'Bad internal URL', reviewedByFynliq: true, reviewedAt:'2026-10-22T14:00:00Z', expiresAt:'2026-10-31T14:00:00Z', sourceUrl:'http://localhost/private' },
  ];
  const offers = reviewedDeals(catalog, now);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].title, 'Reviewed sample partner promotion');
  const reply = dealsReply(JSON.stringify(catalog), now);
  assert.match(reply, /example.com\/terms/);
  assert.match(reply, /No purchase or booking has been made/);
  assert.equal(reviewedDeals('malformed', now).length, 0);
  const empty = await answerEarnRequest('DEALS', { catalogJson: '[]', currentTime: now });
  assert.match(empty, /No recently reviewed deals/);
});

test('task drafting produces an actual deliverable, but never reports money or submission', async () => {
  let seen = null;
  const reply = await draftCustomerDeliverable('TASK CAPTION: 12 handmade candles for our fall collection', {
    apiKey: 'example', model: 'test-model',
    provider: async (brief, instructions) => {
      seen = { brief, instructions };
      return 'Handmade candles for cozy fall evenings. Explore our latest collection!';
    },
  });
  assert.equal(seen.brief, '12 handmade candles for our fall collection');
  assert.match(seen.instructions, /Do not claim/);
  assert.match(reply, /Draft created/);
  assert.match(reply, /NOT sent or paid/);
  assert.match(reply, /Handmade candles/);
  assert.match(await draftCustomerDeliverable('TASK LISTING: xyz', {apiKey:'a',model:'b'}), /12 and 600/);
  assert.match(await draftCustomerDeliverable('TASK REPLY: Please write to my client about delivery', {apiKey:'',model:''}), /not configured/);
  assert.match(await answerEarnRequest('TASK'), /TASK CAPTION/);
});

test('promotional alert consent is separate from conversational replies', async () => {
  let status = 'active';
  let promoStatus = null;
  let sent = 0;
  const action = (body) => handleEarnSms({
    body,
    getStatus: async () => status,
    setStatus: async (next) => { status = next; if (next === 'opted_out') promoStatus = 'opted_out'; },
    getDealsStatus: async () => promoStatus,
    setDealsStatus: async (next) => { promoStatus = next; },
    answer: async () => { sent += 1; return 'General AI answer'; },
  });
  assert.match(await action('DEALS YES'), /DEALS JOIN/);
  assert.match(await action('DEALS JOIN'), /Optional Fynliq/);
  assert.equal(promoStatus, 'pending');
  assert.match(await action('DEALS YES'), /Scheduled promotional messages are NOT active/);
  assert.equal(promoStatus, 'active');
  assert.match(await action('DEALS'), /General AI answer/);
  assert.equal(sent, 1);
  assert.match(await action('DEALS STOP'), /switched off/);
  assert.equal(promoStatus, 'opted_out');
  assert.equal(status, 'active');
  assert.match(await action('STOP'), /unsubscribed/);
  assert.equal(status, 'opted_out');
  assert.equal(promoStatus, 'opted_out');
  assert.equal(sent, 1);
});

test('promotional database update includes only hashed identity, not plaintext number', async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({url, opts});
    if (opts.method === 'PATCH') return {ok:true, json:async () => [{deals_state:'pending'}]};
    return {ok:true, json:async()=>[{deals_state:null}]};
  };
  const store = createSmsConsentStore({
    supabaseUrl: 'https://example.supabase.co',
    serviceRoleKey: 'server-role-secret',
    hashSecret: '0123456789abcdef0123456789abcdef',
    fetchImpl: fakeFetch,
  }).forPhone('+17135551234');
  assert.equal(await store.getDealsStatus(), null);
  await store.setDealsStatus('pending');
  assert.equal(calls[1].opts.method, 'PATCH');
  assert.match(calls[1].url, /phone_hash=eq\.[a-f0-9]{64}/);
  assert.equal(JSON.parse(calls[1].opts.body).deals_state, 'pending');
  assert.ok(!JSON.stringify(calls).includes('+17135551234'));
});
