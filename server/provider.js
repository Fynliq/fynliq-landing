export async function structuredResponse(input, instructions, schema, options) {
  const response = await (options.fetchImpl ?? fetch)('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(45000),
    body: JSON.stringify({ model: options.model, store: false, max_output_tokens: 4000, instructions, input,
      text: { format: { type: 'json_schema', name: 'fynliq_result', strict: true, schema } } }),
  });
  if (!response.ok) throw Error('Provider unavailable');
  const body = await response.json();
  if (body.status === 'incomplete') throw Error('Incomplete response');
  const text = (body.output ?? []).flatMap(x => x.type === 'message' ? x.content ?? [] : [])
    .filter(x => x.type === 'output_text').map(x => x.text).join('');
  return JSON.parse(text);
}
