const MAX_QUESTION = 2000;

/** The initial live integration is general guidance, never an award reader. */
export async function answerQuestion(payload, { apiKey, model, fetchImpl = fetch }) {
  if (!payload || typeof payload.question !== 'string' || !payload.question.trim() || payload.question.trim().length > MAX_QUESTION) {
    return { status: 400, error: 'Please enter a question between 1 and 2,000 characters.' };
  }
  if (!apiKey || !model) return { status: 503, error: 'The answer service is not configured yet.' };
  try {
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        model, store: false, max_output_tokens: 1200,
        instructions: 'You are Fynliq, an educational assistant for college students. Answer clearly and concisely about financial aid and college costs. You have NOT read the student\'s award or accessed their accounts. Give general explanations, never invent personal figures, eligibility, citations or deadlines. Do not calculate personal financial outcomes. For changing rules or individual decisions, direct the student to their school financial aid office or official Federal Student Aid resources. Do not request passwords, Social Security numbers or account credentials.',
        input: payload.question.trim(),
      }),
    });
    if (!response.ok) return { status: 502, error: 'The answer service is unavailable. Please try again shortly.' };
    const data = await response.json();
    const text = (data.output ?? []).flatMap(item => item.type === 'message' ? item.content ?? [] : [])
      .filter(item => item.type === 'output_text' && typeof item.text === 'string').map(item => item.text).join('\n\n').trim();
    if (!text || data.status === 'incomplete') return { status: 502, error: 'No complete answer was received. Please try again.' };
    return { status: 200, body: {
      paragraphs: text.split(/\n\s*\n/).filter(Boolean),
      basis: 'general', grounding: [],
      missing: 'Personalized document analysis is not connected to this answer service yet. This answer uses only your question.',
      relatedIds: [],
    } };
  } catch (error) {
    return { status: error?.name === 'TimeoutError' ? 504 : 502, error: 'The answer service took too long or could not connect. Please try again.' };
  }
}
