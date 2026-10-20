import { describe, expect, it } from 'vitest';
import { askProviderInfo } from '../provider';

describe('Ask provider notice', () => {
  it('names OpenAI by default', () => {
    expect(askProviderInfo(undefined).name).toBe('OpenAI');
    expect(askProviderInfo('').name).toBe('OpenAI');
    expect(askProviderInfo('openai').privacyUrl).toBe('https://openai.com/policies/privacy-policy/');
  });

  it('names Ollama when Ask is switched to Ollama Cloud', () => {
    expect(askProviderInfo('ollama')).toEqual({ name: 'Ollama', privacyUrl: 'https://ollama.com/privacy' });
    expect(askProviderInfo(' Ollama ').name).toBe('Ollama');
  });

  it('matches the server for unknown values, which the server refuses', () => {
    // The server fails closed on an unknown ASK_PROVIDER, so no question is
    // sent anywhere; the notice falls back to the default wording.
    expect(askProviderInfo('something-else').name).toBe('OpenAI');
  });
});
