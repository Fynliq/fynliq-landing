// Which model provider answers questions on /api/ask. Server-only.
//
// ASK_PROVIDER=openai (default) uses OPENAI_API_KEY / OPENAI_MODEL.
// ASK_PROVIDER=ollama uses Ollama Cloud with OLLAMA_API_KEY / OLLAMA_MODEL.
//
// The document reader (/api/analyze) always stays on OpenAI; this switch only
// moves Ask. An unknown value fails closed (null) instead of falling back.
export function askProviderConfig(env = process.env) {
  const provider = String(env.ASK_PROVIDER ?? '').trim().toLowerCase() || 'openai';
  if (provider === 'openai') return { provider, apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL };
  if (provider === 'ollama') return { provider, apiKey: env.OLLAMA_API_KEY, model: env.OLLAMA_MODEL };
  return null;
}

/**
 * Secret for signing reviewed document summaries. It used to be the OpenAI
 * key itself, which tied personal answers to that provider. A dedicated
 * SUMMARY_SIGNING_SECRET is preferred; the OpenAI key remains the fallback so
 * existing deployments keep working unchanged.
 */
export function summarySigningSecret(env = process.env) {
  return env.SUMMARY_SIGNING_SECRET || env.OPENAI_API_KEY || '';
}
