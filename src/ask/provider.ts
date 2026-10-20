/**
 * Who answers Ask questions, for the privacy notice on the Ask page.
 *
 * The same `ASK_PROVIDER` setting that picks the provider on the server
 * (`server/ask-provider.js`) is read here at build time, so the notice always
 * names the company a question is actually sent to. It is a provider name,
 * never a secret. Changing it on Vercel takes effect on the next deploy,
 * for the server and this notice together.
 */
export interface AskProviderInfo {
  name: string;
  privacyUrl: string;
}

const PROVIDERS: Record<string, AskProviderInfo> = {
  openai: { name: 'OpenAI', privacyUrl: 'https://openai.com/policies/privacy-policy/' },
  ollama: { name: 'Ollama', privacyUrl: 'https://ollama.com/privacy' },
};

/** Maps the setting to display details. Unset or unknown means the OpenAI default. */
export function askProviderInfo(value: string | undefined): AskProviderInfo {
  const key = (value ?? '').trim().toLowerCase();
  return PROVIDERS[key] ?? PROVIDERS.openai;
}

export const ASK_PROVIDER = askProviderInfo(import.meta.env?.ASK_PROVIDER);
