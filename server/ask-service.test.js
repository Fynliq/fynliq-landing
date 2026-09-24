import { describe, it, expect } from 'vitest';
import { answerQuestion } from './ask-service';
import { parseAskAnswer } from '../src/ask/contract';

const options = { apiKey: 'test-only', model: 'test-model' };
describe('live Ask service contract', () => {
  it('returns the exact frontend contract for a general question', async () => {
    const result = await answerQuestion({ question: ' hello ', analysis: null }, {
      ...options, fetchImpl: async (_url, request) => {
        const body = JSON.parse(request.body);
        expect(body.input).toBe('hello');
        expect(request.body).not.toContain('not-forwarded');
        expect(body.store).toBe(false);
        return { ok: true, json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'First.\n\nSecond.' }] }] }) };
      },
    });
    expect(result.status).toBe(200);
    expect(parseAskAnswer(result.body)).toMatchObject({ paragraphs: ['First.', 'Second.'], basis: 'general', grounding: [] });
  });
  it.each([null, {}, { question: '' }, { question: '  ' }, { question: 42 }, { question: 'x'.repeat(2001) }])('rejects invalid question %j', async payload => {
    expect((await answerQuestion(payload, options)).status).toBe(400);
  });
  it('fails closed without configuration', async () => {
    expect((await answerQuestion({ question: 'hello' }, {})).status).toBe(503);
  });
  it('does not leak provider error details', async () => {
    const result = await answerQuestion({ question: 'hello' }, { ...options, fetchImpl: async () => ({ ok: false }) });
    expect(result.status).toBe(502);
  });
  it('rejects an empty model response', async () => {
    expect((await answerQuestion({ question: 'hello' }, { ...options, fetchImpl: async () => ({ ok: true, json: async () => ({ output: [] }) }) })).status).toBe(502);
  });
  it('reports timeouts', async () => {
    expect((await answerQuestion({ question: 'hello' }, { ...options, fetchImpl: async () => { const e = new Error(); e.name = 'TimeoutError'; throw e; } })).status).toBe(504);
  });
});
