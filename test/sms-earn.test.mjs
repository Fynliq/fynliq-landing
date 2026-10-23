import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  MAX_SMS_BODY_LENGTH, parseTwilioForm, verifyTwilioSignature,
  handleEarnSms, xmlMessage, replyWithExistingModel,
} from '../server/sms-earn.js';
import { createSmsConsentStore } from '../server/sms-consent-store.js';

test('validates configured URL and ALL signed Twilio form fields', () => {
  const url = 'https://fynliq.com/api/sms/inbound';
  const params = parseTwilioForm('From=%2B17135551234&To=%2B18325550123&Body=Hi%20there&MessageSid=SM123');
  const canonical = url + Object.keys(params).sort().map((key) => key + params[key]).join('');
  const signature = createHmac('sha1', 'test-token').update(canonical).digest('base64');
  const args = { url, params, signature, authToken: 'test-token' };
  assert.equal(verifyTwilioSignature(args), true);
  assert.equal(verifyTwilioSignature({ ...args, url: url + '?x=1' }), false);
  assert.equal(verifyTwilioSignature({ ...args, params: { ...params, Body: 'tampered' } }), false);
  assert.equal(verifyTwilioSignature({ ...args, signature: 'bad' }), false);
  assert.throws(() => parseTwilioForm('Body=a&Body=b'), /Duplicate/);
});

test('XML escapes untrusted content', () => {
  const xml = xmlMessage('A&B <C> "D"');
  assert.match(xml, /A&amp;B &lt;C&gt; &quot;D&quot;/);
  assert.ok(xml.startsWith('<?xml'));
});

test('consent flow blocks AI until an explicit JOIN and YES', async () => {
  let status = null;
  let calls = 0;
  const services = {
    getStatus: async () => status,
    setStatus: async (next) => { status = next; },
    answer: async () => { calls += 1; return 'Start with tutoring or freelancing.'; },
  };
  const ask = (body) => handleEarnSms({ ...services, body });
  assert.match(await ask('Make me money'), /JOIN/);
  assert.equal(calls, 0);
  assert.match(await ask('YES'), /JOIN first/);
  assert.match(await ask('JOIN'), /Reply YES/);
  assert.equal(status, 'pending');
  assert.match(await ask('YES'), /subscribed/);
  assert.equal(status, 'active');
  assert.match(await ask('How can I earn extra cash?'), /tutoring/);
  assert.equal(calls, 1);
  assert.match(await ask('STOP'), /unsubscribed/);
  assert.equal(status, 'opted_out');
  assert.match(await ask('Try again'), /JOIN/);
  assert.equal(calls, 1);
  assert.match(await ask('START'), /Reply YES/);
  assert.equal(status, 'pending');
  assert.match(await ask('HELP'), /fynliq.com/);
  assert.match(await ask('x'.repeat(MAX_SMS_BODY_LENGTH + 1)), /shorter/);
});

test('stores only an HMAC phone hash and uses server credentials', async () => {
  const requests = [];
  const mockFetch = async (url, opts) => {
    requests.push({ url, opts });
    if (opts.method === 'GET') return { ok: true, json: async () => [] };
    return { ok: true };
  };
  const secret = '0123456789abcdef0123456789abcdef';
  const store = createSmsConsentStore({
    supabaseUrl: 'https://example.supabase.co',
    serviceRoleKey: 'private-test-key',
    hashSecret: secret,
    fetchImpl: mockFetch,
  }).forPhone('+17135551234');
  assert.equal(await store.getStatus(), null);
  await store.setStatus('pending');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].opts.headers.apikey, 'private-test-key');
  assert.doesNotMatch(requests[1].opts.body, /\+17135551234/);
  const row = JSON.parse(requests[1].opts.body);
  assert.match(row.phone_hash, /^[0-9a-f]{64}$/);
  assert.equal(row.state, 'pending');
  assert.throws(() => createSmsConsentStore({
    supabaseUrl: 'https://example.supabase.co', serviceRoleKey: 'secret', hashSecret: 'short',
  }), /not configured/);
});

test('model-off mode returns a truthful unavailable response', async () => {
  const reply = await replyWithExistingModel('I want to earn $50', { apiKey: '', model: '' });
  assert.match(reply, /configured/);
});
