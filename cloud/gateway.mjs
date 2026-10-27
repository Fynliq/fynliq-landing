import { randomUUID, timingSafeEqual } from 'node:crypto';

const BODY_LIMIT = 128 * 1024;
function setting(value, fallback, low, high) {
  const n = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(n) || n < low || n > high) throw Error('Invalid numeric gateway setting');
  return n;
}
export function readConfig(env = process.env) {
  const apiKey = env.CLOUD_GATEWAY_API_KEY;
  if (typeof apiKey !== 'string' || apiKey.length < 32) throw Error('CLOUD_GATEWAY_API_KEY requires 32+ random characters');
  const model = env.CLOUD_MODEL_NAME;
  if (!model || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(model)) throw Error('Invalid CLOUD_MODEL_NAME');
  let url;
  try { url = new URL(env.CLOUD_UPSTREAM_URL); } catch { throw Error('Invalid CLOUD_UPSTREAM_URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      !url.pathname.endsWith('/v1/chat/completions') || url.search || url.hash) throw Error('Invalid upstream endpoint');
  if (url.protocol === 'http:' && !['localhost','127.0.0.1','[::1]','model','host.docker.internal'].includes(url.hostname)) {
    throw Error('Remote model servers require HTTPS');
  }
  return {
    apiKey, model, upstream: url.toString(), upstreamKey: env.CLOUD_UPSTREAM_API_KEY || '',
    bind: env.CLOUD_BIND_HOST || '127.0.0.1',
    port: setting(env.CLOUD_PORT, 8787, 1, 65535),
    timeout: setting(env.CLOUD_TIMEOUT_MS, 30000, 1000, 120000),
    rpm: setting(env.CLOUD_REQUESTS_PER_MINUTE, 60, 1, 10000),
    concurrent: setting(env.CLOUD_MAX_CONCURRENT, 2, 1, 64)
  };
}
function reply(res, status, payload, id) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Request-Id': id, 'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(payload));
}
function auth(header, key) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const a = Buffer.from(header.slice(7)), b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function parseBody(req) {
  if (Number(req.headers['content-length'] || 0) > BODY_LIMIT) throw Object.assign(Error('large'), { status: 413 });
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > BODY_LIMIT) throw Object.assign(Error('large'), { status: 413 });
    parts.push(part);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw Object.assign(Error('json'), { status: 400 }); }
}
function validate(input, model) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      (input.model !== undefined && input.model !== model) || input.stream === true ||
      !Array.isArray(input.messages) || input.messages.length < 1 || input.messages.length > 24) return null;
  const messages = [];
  for (const m of input.messages) {
    if (!m || !['system','user','assistant'].includes(m.role) ||
        typeof m.content !== 'string' || m.content.length < 1 || m.content.length > 8192) return null;
    messages.push({ role: m.role, content: m.content });
  }
  const max = input.max_tokens ?? 512, temperature = input.temperature ?? 0.7;
  if (!Number.isInteger(max) || max < 1 || max > 2048 ||
      typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 0 || temperature > 2) return null;
  return { model, messages, max_tokens: max, temperature, stream: false };
}
async function limitedJson(response) {
  if (Number(response.headers?.get('content-length') || 0) > 1024 * 1024) throw Error('upstream oversized');
  let bytes = 0; const parts = [];
  if (!response.body) throw Error('upstream missing body');
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > 1024 * 1024) throw Error('upstream oversized');
    parts.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
export function createGateway(config, { fetchImpl = fetch, clock = Date.now, logger = console } = {}) {
  let windowStart = clock(), used = 0, inFlight = 0;
  const metrics = { requests: 0, completed: 0, errors: 0, throttled: 0 };
  return async (req, res) => {
    const id = randomUUID(), route = new URL(req.url || '/', 'http://local').pathname;
    if (req.method === 'GET' && route === '/healthz') return reply(res, 200, { status: 'alive' }, id);
    if (!auth(req.headers.authorization, config.apiKey)) return reply(res, 401, { error: 'Unauthorized' }, id);
    if (req.method === 'GET' && route === '/v1/metrics') return reply(res, 200, { ...metrics, inFlight }, id);
    if (route !== '/v1/chat/completions') return reply(res, 404, { error: 'Not found' }, id);
    if (req.method !== 'POST') return reply(res, 405, { error: 'Method not allowed' }, id);
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
      return reply(res, 415, { error: 'Expected JSON' }, id);
    }
    if (clock() - windowStart >= 60000) { windowStart = clock(); used = 0; }
    if (used >= config.rpm || inFlight >= config.concurrent) {
      metrics.throttled++;
      return reply(res, 429, { error: 'Gateway busy or rate limited' }, id);
    }
    used++; inFlight++; metrics.requests++;
    let status = 502;
    try {
      const body = validate(await parseBody(req), config.model);
      if (!body) { status = 400; return reply(res, status, { error: 'Invalid chat request' }, id); }
      const headers = { 'Content-Type': 'application/json' };
      if (config.upstreamKey) headers.Authorization = 'Bearer ' + config.upstreamKey;
      const upstream = await fetchImpl(config.upstream, {
        method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(config.timeout)
      });
      if (!upstream.ok) return reply(res, 502, { error: 'Model unavailable' }, id);
      const data = await limitedJson(upstream);
      const choice = data?.choices?.[0];
      if (typeof choice?.message?.content !== 'string') return reply(res, 502, { error: 'Invalid model response' }, id);
      status = 200;
      return reply(res, 200, {
        id: typeof data.id === 'string' ? data.id : 'chatcmpl-' + id,
        object: 'chat.completion', created: Number.isInteger(data.created) ? data.created : Math.floor(Date.now() / 1000),
        model: config.model,
        choices: [{ index: 0, message: { role: 'assistant', content: choice.message.content },
          finish_reason: typeof choice.finish_reason === 'string' ? choice.finish_reason : 'stop' }]
      }, id);
    } catch (error) {
      status = error?.status === 413 ? 413 : error?.status === 400 ? 400 :
        ['TimeoutError', 'AbortError'].includes(error?.name) ? 504 : 502;
      return reply(res, status, { error: status === 413 ? 'Request too large' :
        status === 400 ? 'Malformed JSON' : status === 504 ? 'Model timeout' : 'Model unavailable' }, id);
    } finally {
      inFlight--;
      if (status === 200) metrics.completed++; else metrics.errors++;
      // Never log prompts, keys, user IDs, request bodies, or upstream responses.
      logger.info?.({ event: 'inference_request', requestId: id, status });
    }
  };
}
