import { describe, expect, it } from 'vitest';
import { providerResponse, ProviderError } from './provider.js';
import { askProviderConfig, summarySigningSecret } from './ask-provider.js';
import { answerQuestion } from './ask-service.js';
import { signSummary, validateSummary } from './summary.js';

// Mock-only: no request leaves the machine. The fake key is never a real one.
const KEY = 'test-only-ollama-key';
const base = { provider: 'ollama', apiKey: KEY, model: 'gemma4:31b', maxOutputTokens: 600 };

/** Records the request and answers like Ollama's native /api/chat. */
function ollama(reply, { ok = true, status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok, status, json: async () => reply };
  };
  return { calls, fetchImpl };
}
const chat = (content, extra = {}) => ({ model: 'gemma4:31b', message: { role: 'assistant', content }, done: true, done_reason: 'stop', ...extra });

async function failure(promise) {
  try { await promise; } catch (error) { return error; }
  throw new Error('expected a failure');
}

describe('Ollama Cloud adapter', () => {
  it('sends system instructions and the user text to the native chat API', async () => {
    const { calls, fetchImpl } = ollama(chat('Hello there.'));
    const text = await providerResponse('What is a Pell Grant?', 'You are Fynliq.', null, { ...base, fetchImpl });
    expect(text).toBe('Hello there.');
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe('https://ollama.com/api/chat');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].body).toEqual({
      model: 'gemma4:31b', stream: false,
      messages: [{ role: 'system', content: 'You are Fynliq.' }, { role: 'user', content: 'What is a Pell Grant?' }],
      options: { num_predict: 600 },
    });
  });

  it('authenticates with a bearer token that stays out of the body', async () => {
    const { calls, fetchImpl } = ollama(chat('ok'));
    await providerResponse('hi', 'sys', null, { ...base, fetchImpl });
    const headers = calls[0].init.headers;
    expect(headers['Content-Type']).toBe('application/json');
    // Compare without printing the value, as a log would.
    expect(headers.Authorization === `Bearer ${KEY}`).toBe(true);
    expect(calls[0].init.body.includes(KEY)).toBe(false);
  });

  it('asks for JSON-schema output and parses it', async () => {
    const schema = { type: 'object', required: ['paragraphs'], properties: { paragraphs: { type: 'array', items: { type: 'string' } } } };
    const { calls, fetchImpl } = ollama(chat('{"paragraphs":["One."]}'));
    const data = await providerResponse('q', 'sys', schema, { ...base, fetchImpl });
    expect(calls[0].body.format).toEqual(schema);
    expect(data).toEqual({ paragraphs: ['One.'] });
  });

  it('maps upstream failures to content-free codes', async () => {
    const cases = [[401, 'auth'], [403, 'auth'], [404, 'model-not-found'], [429, 'rate-limited'], [500, 'upstream'], [503, 'upstream']];
    for (const [status, code] of cases) {
      const { fetchImpl } = ollama({ error: `model "secret prompt" failed ${KEY}` }, { ok: false, status });
      const error = await failure(providerResponse('q', 'sys', null, { ...base, fetchImpl }));
      expect(error instanceof ProviderError).toBe(true);
      expect(error.code).toBe(code);
      expect(error.message).toBe('Provider unavailable');
    }
  });

  it('rejects empty, truncated and malformed replies', async () => {
    for (const [reply, schema, code] of [
      [chat('   '), null, 'empty'],
      [{ done: true }, null, 'empty'],
      [chat('half an ans', { done_reason: 'length' }), null, 'incomplete'],
      [chat('not json'), { type: 'object' }, 'bad-json'],
      [{ error: 'something' }, null, 'upstream'],
    ]) {
      const { fetchImpl } = ollama(reply);
      expect((await failure(providerResponse('q', 'sys', schema, { ...base, fetchImpl }))).code).toBe(code);
    }
  });

  it('blocks high-risk personal details before any request', async () => {
    const { calls, fetchImpl } = ollama(chat('ok'));
    const error = await failure(providerResponse('my ssn is 123-45-6789', 'sys', null, { ...base, fetchImpl }));
    expect(error.name).toBe('PrivacyError');
    expect(calls.length).toBe(0);
  });

  it('passes cancellation through to the request', async () => {
    const controller = new AbortController();
    let seen;
    const fetchImpl = async (_url, init) => { seen = init.signal; return { ok: true, status: 200, json: async () => chat('ok') }; };
    await providerResponse('q', 'sys', null, { ...base, fetchImpl, signal: controller.signal });
    expect(seen.aborted).toBe(false);
    controller.abort();
    expect(seen.aborted).toBe(true);
  });

  it('refuses an unknown provider', async () => {
    const { calls, fetchImpl } = ollama(chat('ok'));
    expect((await failure(providerResponse('q', 'sys', null, { ...base, provider: 'other', fetchImpl }))).code).toBe('unknown-provider');
    expect(calls.length).toBe(0);
  });

  it('keeps OpenAI as the default provider', async () => {
    const calls = [];
    const fetchImpl = async (url) => { calls.push(url); return { ok: true, status: 200, json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] }) }; };
    await providerResponse('q', 'sys', null, { apiKey: 'x', model: 'm', fetchImpl });
    expect(calls[0]).toBe('https://api.openai.com/v1/responses');
  });
});

describe('Ask provider configuration', () => {
  it('defaults to OpenAI and switches to Ollama only when asked', () => {
    const env = { OPENAI_API_KEY: 'o', OPENAI_MODEL: 'om', OLLAMA_API_KEY: 'l', OLLAMA_MODEL: 'lm' };
    expect(askProviderConfig(env)).toEqual({ provider: 'openai', apiKey: 'o', model: 'om' });
    expect(askProviderConfig({ ...env, ASK_PROVIDER: 'Ollama ' })).toEqual({ provider: 'ollama', apiKey: 'l', model: 'lm' });
  });
  it('fails closed on an unknown provider', () => {
    expect(askProviderConfig({ ASK_PROVIDER: 'anthropic', OPENAI_API_KEY: 'o', OPENAI_MODEL: 'om' })).toBe(null);
  });
  it('prefers a dedicated summary signing secret', () => {
    expect(summarySigningSecret({ OPENAI_API_KEY: 'o' })).toBe('o');
    expect(summarySigningSecret({ OPENAI_API_KEY: 'o', SUMMARY_SIGNING_SECRET: 's' })).toBe('s');
    expect(summarySigningSecret({})).toBe('');
  });
});

describe('Ask answers through Ollama', () => {
  const facts = validateSummary({ supported: true, conflicts: [], facts: [
    { field: 'balanceDue', label: 'Balance due', value: '1200', page: 1, document: 1, kind: 'account-statement', period: 'Fall 2026', estimated: false, quote: 'Balance due: $1,200' },
  ] });

  it('returns the existing general-answer contract', async () => {
    const { calls, fetchImpl } = ollama(chat('First.\n\nSecond.'));
    const result = await answerQuestion({ question: ' What is the SAI? ', analysis: null }, { ...base, fetchImpl });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ paragraphs: ['First.', 'Second.'], basis: 'general', grounding: [],
      missing: 'Upload and review your aid documents to get an answer based on your own figures.', relatedIds: [] });
    expect(calls[0].body.messages[1].content).toBe('What is the SAI?');
  });

  it('verifies personal facts with the signing secret, not the Ollama key', async () => {
    const signing = 'test-only-signing-secret';
    const analysis = { reviewed: true, summaryToken: signSummary(facts, signing) };
    const { calls, fetchImpl } = ollama(chat(JSON.stringify({ paragraphs: ['Your statement lists a balance due of $1,200.'], usedFields: ['f1'] })));
    const result = await answerQuestion({ question: 'What do I owe?', analysis }, { ...base, signingSecret: signing, fetchImpl });
    expect(result.status).toBe(200);
    expect(result.body.basis).toBe('personal');
    expect(calls[0].body.format.required).toEqual(['paragraphs', 'usedFields']);
    // A token signed with a different secret is refused before any request.
    const other = ollama(chat('{}'));
    const refused = await answerQuestion({ question: 'What do I owe?', analysis }, { ...base, signingSecret: 'another-secret', fetchImpl: other.fetchImpl });
    expect(refused.status).toBe(409);
    expect(other.calls.length).toBe(0);
  });

  it('still rejects invented amounts from the model', async () => {
    const signing = 'test-only-signing-secret';
    const analysis = { reviewed: true, summaryToken: signSummary(facts, signing) };
    const { fetchImpl } = ollama(chat(JSON.stringify({ paragraphs: ['You owe $9,999.'], usedFields: ['f1'] })));
    expect((await answerQuestion({ question: 'What do I owe?', analysis }, { ...base, signingSecret: signing, fetchImpl })).status).toBe(502);
  });

  it('turns provider failures into safe messages', async () => {
    const { fetchImpl } = ollama({ error: 'unauthorized' }, { ok: false, status: 401 });
    const result = await answerQuestion({ question: 'hello' }, { ...base, fetchImpl });
    expect(result.status).toBe(502);
    expect(result.error.includes('unauthorized')).toBe(false);
    const timeout = await answerQuestion({ question: 'hello' }, { ...base, fetchImpl: async () => { const e = new Error(); e.name = 'TimeoutError'; throw e; } });
    expect(timeout.status).toBe(504);
  });
});
