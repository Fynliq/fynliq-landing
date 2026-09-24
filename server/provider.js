import { assertSafeInput } from './privacy.js';
export async function providerResponse(input, instructions, schema, options) {
  assertSafeInput(input);
  const ceiling=options.maxOutputTokens ?? 4000;
  if(!Number.isInteger(ceiling)||ceiling<1||ceiling>4000)throw Error('Invalid output limit');
  const response = await (options.fetchImpl ?? fetch)('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(45000),
    body: JSON.stringify({ model: options.model, store: false, max_output_tokens: ceiling, instructions, input,
      ...(schema ? {text: { format: { type: 'json_schema', name: 'fynliq_result', strict: true, schema } }} : {}) }),
  });
  if (!response.ok) throw Error('Provider unavailable');
  const body = await response.json();
  if (body.status === 'incomplete') throw Error('Incomplete response');
  const text = (body.output ?? []).flatMap(x => x.type === 'message' ? x.content ?? [] : [])
    .filter(x => x.type === 'output_text').map(x => x.text).join('');
  if (!text.trim()) throw Error('Empty response');
  return schema ? JSON.parse(text) : text;
}

export const structuredResponse = providerResponse;
