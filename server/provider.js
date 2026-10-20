import { assertSafeInput } from './privacy.js';

// Server-only model adapter. Two providers share one contract: text in,
// text (or schema-checked JSON) out. Errors never carry the provider's body,
// which can echo the prompt or document text.
//
//   openai  POST https://api.openai.com/v1/responses  (default)
//   ollama  POST https://ollama.com/api/chat           (Ollama Cloud, native API)
//
// Ollama Cloud is called through its native chat API rather than its
// OpenAI-compatible /v1/responses path, because only the native API documents
// JSON-schema structured output (`format`), which the reviewed-facts answers
// depend on.
export const PROVIDERS = ['openai', 'ollama'];
const OPENAI_URL = 'https://api.openai.com/v1/responses';
const OLLAMA_URL = 'https://ollama.com/api/chat';
const TIMEOUT_MS = 45000;

/** A provider failure with a short, content-free code safe to log. */
export class ProviderError extends Error {
  constructor(code) { super('Provider unavailable'); this.name = 'ProviderError'; this.code = code; }
}

function statusCode(status) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'model-not-found';
  if (status === 429) return 'rate-limited';
  if (status === 400 || status === 422) return 'bad-request';
  return 'upstream';
}

function parseOutput(text, schema) {
  if (!text.trim()) throw new ProviderError('empty');
  if (!schema) return text;
  try { return JSON.parse(text); } catch { throw new ProviderError('bad-json'); }
}

async function openaiResponse(input, instructions, schema, options, ceiling, signal) {
  const response = await (options.fetchImpl ?? fetch)(OPENAI_URL, {
    method: 'POST', headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ model: options.model, store: false, max_output_tokens: ceiling, instructions, input,
      ...(schema ? {text: { format: { type: 'json_schema', name: 'fynliq_result', strict: true, schema } }} : {}) }),
  });
  if (!response.ok) throw new ProviderError(statusCode(response.status));
  const body = await response.json();
  if (body.status === 'incomplete') throw new ProviderError('incomplete');
  const text = (body.output ?? []).flatMap(x => x.type === 'message' ? x.content ?? [] : [])
    .filter(x => x.type === 'output_text').map(x => x.text).join('');
  return parseOutput(text, schema);
}

async function ollamaResponse(input, instructions, schema, options, ceiling, signal) {
  const response = await (options.fetchImpl ?? fetch)(OLLAMA_URL, {
    method: 'POST', headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model: options.model, stream: false,
      messages: [{ role: 'system', content: instructions }, { role: 'user', content: input }],
      options: { num_predict: ceiling },
      ...(schema ? { format: schema } : {}),
    }),
  });
  if (!response.ok) throw new ProviderError(statusCode(response.status));
  const body = await response.json();
  if (body.error) throw new ProviderError('upstream');
  if (body.done_reason === 'length') throw new ProviderError('incomplete');
  return parseOutput(typeof body.message?.content === 'string' ? body.message.content : '', schema);
}

export async function providerResponse(input, instructions, schema, options) {
  assertSafeInput(input);
  const ceiling=options.maxOutputTokens ?? 4000;
  if(!Number.isInteger(ceiling)||ceiling<1||ceiling>4000)throw Error('Invalid output limit');
  const provider = options.provider ?? 'openai';
  if (!PROVIDERS.includes(provider)) throw new ProviderError('unknown-provider');
  // The timeout always applies; a caller's signal (e.g. client disconnect) can cancel sooner.
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const call = provider === 'ollama' ? ollamaResponse : openaiResponse;
  return call(input, instructions, schema, options, ceiling, signal);
}

export const structuredResponse = providerResponse;
