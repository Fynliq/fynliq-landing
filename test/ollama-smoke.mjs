// Real Ollama Cloud smoke test: one plain answer and one schema-checked answer
// through the same adapter /api/ask uses. Skips cleanly when OLLAMA_API_KEY
// is not set. Never prints the key, the prompt or the provider's error body.
//
//   OLLAMA_API_KEY=... OLLAMA_MODEL=gemma4:31b npm run test:ollama
//
// (Better: load them from an ignored .env.local, e.g. `vercel env pull`,
// rather than typing the key on the command line.)
import { providerResponse } from '../server/provider.js';

const { OLLAMA_API_KEY: apiKey, OLLAMA_MODEL: model } = process.env;
if (!apiKey) {
  console.log('SKIP  ollama smoke: OLLAMA_API_KEY is not set.');
  process.exit(0);
}
if (!model) {
  console.error('FAIL  ollama smoke: set OLLAMA_MODEL (for example gemma4:31b).');
  process.exit(1);
}

const options = { provider: 'ollama', apiKey, model, maxOutputTokens: 400 };
let failed = 0;
async function check(name, run) {
  const started = Date.now();
  try {
    const detail = await run();
    console.log(`PASS  ${name} (${Date.now() - started} ms)${detail ? ` ${detail}` : ''}`);
  } catch (error) {
    failed++;
    // Codes only: auth, model-not-found, rate-limited, upstream, incomplete, empty, bad-json.
    console.error(`FAIL  ${name}: ${error?.code ?? error?.name ?? 'Error'}`);
  }
}

await check(`plain answer from ${model}`, async () => {
  const text = await providerResponse('In one sentence, what is a Pell Grant?', 'You are a concise assistant.', null, options);
  if (typeof text !== 'string' || !text.trim()) throw Object.assign(new Error(), { code: 'empty' });
  return `${text.trim().length} chars`;
});

await check(`structured answer from ${model}`, async () => {
  const schema = { type: 'object', additionalProperties: false, required: ['paragraphs'],
    properties: { paragraphs: { type: 'array', items: { type: 'string' } } } };
  const data = await providerResponse('Explain a Student Aid Index in two short paragraphs.',
    'Answer as JSON matching the schema.', schema, options);
  if (!Array.isArray(data?.paragraphs) || !data.paragraphs.length || data.paragraphs.some(p => typeof p !== 'string' || !p.trim())) {
    throw Object.assign(new Error(), { code: 'schema-mismatch' });
  }
  return `${data.paragraphs.length} paragraphs`;
});

process.exit(failed ? 1 : 0);
