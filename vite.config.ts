import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // VITE_ is the default. ASK_PROVIDER is a provider name (openai | ollama),
  // never a secret: the Ask page names the provider that answers.
  envPrefix: ['VITE_', 'ASK_PROVIDER'],
});
