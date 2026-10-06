// FYNLIQ Intelligence: model provider abstraction.
//
// Everything above this file calls provider.analyze(); nothing else in the
// intelligence layer knows which vendor or SDK is behind it. Adding Anthropic
// or Gemini later means one new class here and one line in createProvider().
//
// Interface (AIProvider):
//   name: string
//   model: string
//   analyze({ instructions, input, schema, maxOutputTokens, timeoutMs })
//     -> Promise<{ text: string, usage: { inputTokens: number|null, outputTokens: number|null } }>
//   Throws ProviderError with a content-free `code`.
//
// Only OpenAI is implemented: it is the provider this project already uses
// (server/provider.js, same Responses API, store:false). This separate class
// exists because the intelligence layer also needs token usage for cost
// observability, which server/provider.js does not return.
import { assertSafeInput } from '../privacy.js';

export class ProviderError extends Error {
  constructor(code, status = null) { super(`Provider error: ${code}`); this.name = 'ProviderError'; this.code = code; this.status = status; }
}

export class OpenAIProvider {
  constructor({ apiKey, model, fetchImpl = fetch }) {
    if (!apiKey || !model) throw new ProviderError('not_configured');
    this.name = 'openai';
    this.model = model;
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
  }

  async analyze({ instructions, input, schema, maxOutputTokens = 1500, timeoutMs = 45000 }) {
    if (typeof input !== 'string') throw new ProviderError('invalid_input');
    // Same gate as every other FYNQ model call. The intelligence input is aggregate-only, so this should never trip.
    try { assertSafeInput(input); } catch { throw new ProviderError('privacy_blocked'); }
    if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 4000) throw new ProviderError('invalid_output_limit');
    let response;
    try {
      response = await this.fetchImpl('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model: this.model, store: false, max_output_tokens: maxOutputTokens, instructions, input,
          text: { format: { type: 'json_schema', name: 'fynliq_ceo_brief', strict: true, schema } },
        }),
      });
    } catch (error) {
      throw new ProviderError(error?.name === 'TimeoutError' ? 'timeout' : 'network');
    }
    if (!response.ok) throw new ProviderError('http_error', response.status);
    let body;
    try { body = await response.json(); } catch { throw new ProviderError('bad_response'); }
    if (body?.status === 'incomplete') throw new ProviderError('incomplete');
    const text = (body?.output ?? []).flatMap((x) => (x.type === 'message' ? x.content ?? [] : []))
      .filter((x) => x.type === 'output_text').map((x) => x.text).join('');
    if (!text.trim()) throw new ProviderError('empty');
    const usage = body?.usage ?? {};
    return {
      text,
      usage: {
        inputTokens: Number.isFinite(usage.input_tokens) ? usage.input_tokens : null,
        outputTokens: Number.isFinite(usage.output_tokens) ? usage.output_tokens : null,
      },
    };
  }
}

export const SUPPORTED_PROVIDERS = ['openai'];

/** Picks the provider from server-only env. Throws ProviderError('not_configured' | 'unsupported_provider'). */
export function createProvider(env = process.env, { fetchImpl } = {}) {
  const name = (env.INTELLIGENCE_PROVIDER || 'openai').toLowerCase();
  if (name === 'openai') {
    return new OpenAIProvider({ apiKey: env.OPENAI_API_KEY, model: env.INTELLIGENCE_MODEL || env.OPENAI_MODEL, fetchImpl });
  }
  throw new ProviderError('unsupported_provider');
}

/** USD estimate from configured per-million-token prices; null when prices or usage are unknown. Never hard-codes a price. */
export function estimateCostUsd(usage, env = process.env) {
  const inPrice = Number(env.INTELLIGENCE_COST_INPUT_PER_MTOK);
  const outPrice = Number(env.INTELLIGENCE_COST_OUTPUT_PER_MTOK);
  if (!env.INTELLIGENCE_COST_INPUT_PER_MTOK || !env.INTELLIGENCE_COST_OUTPUT_PER_MTOK || !Number.isFinite(inPrice) || !Number.isFinite(outPrice)) return null;
  if (!Number.isFinite(usage?.inputTokens) || !Number.isFinite(usage?.outputTokens)) return null;
  return Math.round(((usage.inputTokens * inPrice + usage.outputTokens * outPrice) / 1e6) * 1e6) / 1e6;
}
