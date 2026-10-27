import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createGateway, readConfig } from './gateway.mjs';

const key = 'safe-test-only-key-with-more-than-32-characters';
const config = { apiKey: key, model: 'company-model', upstream: 'http://127.0.0.1:8000/v1/chat/completions',
  upstreamKey: '', timeout: 3000, rpm: 10, concurrent: 2 };
const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: 'GPU reply' }, finish_reason: 'stop' }] }),
  { status: 200, headers: { 'Content-Type': 'application/json' } });
async function serve(fn, fetchImpl = async () => ok(), settings = {}) {
  const server = http.createServer(createGateway({ ...config, ...settings }, { fetchImpl, logger: { info() {} } }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await fn('http://127.0.0.1:' + server.address().port); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
function post(url, data = { messages: [{ role: 'user', content: 'Hello' }] }, token = key) {
  return fetch(url + '/v1/chat/completions', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

test('configuration fails closed', () => {
  assert.throws(() => readConfig({}), /CLOUD_GATEWAY_API_KEY/);
  assert.throws(() => readConfig({ CLOUD_GATEWAY_API_KEY: key, CLOUD_MODEL_NAME: 'm',
    CLOUD_UPSTREAM_URL: 'http://remote.example/v1/chat/completions' }), /HTTPS/);
});
test('public health, protected metrics', async () => serve(async url => {
  assert.deepEqual(await (await fetch(url + '/healthz')).json(), { status: 'alive' });
  assert.equal((await fetch(url + '/v1/metrics')).status, 401);
  assert.equal((await fetch(url + '/v1/metrics', { headers: { Authorization: 'Bearer ' + key } })).status, 200);
}));
test('unauthorized calls never reach GPUs', async () => {
  let calls = 0;
  await serve(async url => {
    assert.equal((await post(url, undefined, 'wrong')).status, 401);
    assert.equal(calls, 0);
  }, async () => { calls++; return ok(); });
});
test('valid request is safely forwarded with fixed model', async () => {
  let forwarded;
  await serve(async url => {
    const response = await post(url, { messages: [{ role: 'user', content: 'Hello' }],
      model: 'company-model', extra_upstream_url: 'https://evil.example' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).choices[0].message.content, 'GPU reply');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(forwarded, { model: 'company-model',
      messages: [{ role: 'user', content: 'Hello' }], max_tokens: 512, temperature: 0.7, stream: false });
  }, async (_endpoint, init) => { forwarded = JSON.parse(init.body); return ok(); });
});
test('invalid model, role, streaming, large payload are rejected', async () => serve(async url => {
  for (const input of [
    { model: 'another', messages: [{ role: 'user', content: 'Hi' }] },
    { messages: [{ role: 'tool', content: 'Hi' }] },
    { stream: true, messages: [{ role: 'user', content: 'Hi' }] }
  ]) assert.equal((await post(url, input)).status, 400);
  assert.equal((await post(url, { messages: [{ role: 'user', content: 'x'.repeat(140000) }] })).status, 413);
}));
test('rate limiting and upstream failure hide details', async () => {
  await serve(async url => {
    assert.equal((await post(url)).status, 200);
    assert.equal((await post(url)).status, 429);
  }, async () => ok(), { rpm: 1 });
  await serve(async url => {
    const response = await post(url);
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, 'Model unavailable');
  }, async () => new Response('secret model details', { status: 500 }));
});
