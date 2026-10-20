# Ask on Ollama Cloud

`/api/ask` (Ask Fynliq and Search answers) can use an Ollama Cloud model
instead of OpenAI. It is off by default: nothing changes until `ASK_PROVIDER`
is set to `ollama`.

The document reader (`/api/analyze`) **stays on OpenAI**. Student document
text is never sent to Ollama, and the upload consent wording is unchanged.

## How it works

- `server/provider.js` has two providers behind one contract. Ollama is called
  through its native API, `POST https://ollama.com/api/chat`, with
  `Authorization: Bearer $OLLAMA_API_KEY`. Personal answers use JSON-schema
  output (`format`). That's why the native API is used and not the
  OpenAI-compatible `/v1` path, which doesn't document schema output.
- `server/ask-provider.js` picks the provider from `ASK_PROVIDER`. An unknown
  value fails closed (503) instead of falling back.
- Everything in front of the model is unchanged: sign-in session, same-origin
  check, per-user and global question limits, PII blocking, the reviewed-facts
  check and the rejection of invented dollar amounts.
- Provider errors are mapped to short codes (`auth`, `model-not-found`,
  `rate-limited`, `upstream`, `incomplete`, `empty`, `bad-json`). The
  provider's error body is never logged or returned, because it can echo the
  question.
- The Ask page notice names the active provider and links its privacy policy
  (`src/ask/provider.ts`), read from the same `ASK_PROVIDER` at build time.

## Settings (Vercel → fynliq-landing → Settings → Environment Variables)

| Variable | Secret? | Value |
|---|---|---|
| `OLLAMA_API_KEY` | **Yes. Mark Sensitive** | Create at ollama.com → Settings → API keys |
| `OLLAMA_MODEL` | No | A cloud model ID your account can use, e.g. `gemma4:31b` |
| `ASK_PROVIDER` | No | `ollama` to switch Ask; unset or `openai` keeps OpenAI |
| `SUMMARY_SIGNING_SECRET` | **Yes. Mark Sensitive** | Optional. 32+ random characters (`openssl rand -base64 48`) |
| `ASK_MAX_OUTPUT_TOKENS` | No | Optional. Defaults to `OPENAI_MAX_OUTPUT_TOKENS`, then 1200 |

Never prefix `OLLAMA_API_KEY` or `SUMMARY_SIGNING_SECRET` with `VITE_`, and
never commit them. `ASK_PROVIDER` is exposed to the browser on purpose (it is
only a provider name). Never give any variable whose name starts with
`ASK_PROVIDER` a secret value.

**Redeploy after changing any of these.** Server and notice switch together
on the next deployment.

### About `SUMMARY_SIGNING_SECRET`

Reviewed document summaries are signed so a browser can't edit the facts a
personal answer uses. They used to be signed with `OPENAI_API_KEY`. That still
works as the fallback, so you don't have to set anything. Setting a dedicated
secret means rotating the OpenAI key no longer touches personal answers. When
you first set it, summaries signed in the previous hour stop verifying, and
students upload again.

## Testing

```bash
npm test             # includes server/ollama-provider.test.js (mocked, no network)
npm run test:ollama  # real Ollama Cloud call; skips if OLLAMA_API_KEY is unset
```

For the real call, pull the key into an ignored file rather than typing it,
e.g. `vercel env pull .env.local`, then
`node --env-file=.env.local test/ollama-smoke.mjs`. The smoke test prints only
pass/fail, timings and error codes, never the key or the reply.

## Switching on

1. Set `OLLAMA_API_KEY` (Sensitive) and `OLLAMA_MODEL` for **Preview** first.
2. Run `npm run test:ollama` with those values and check both checks pass.
3. Set `ASK_PROVIDER=ollama` for Preview and redeploy the preview.
4. Signed in on the preview: ask a general question, then upload fictional
   documents, review them, and ask a personal question. Check the notice says
   Ollama and the answer cites your documents.
5. Repeat for Production when you are satisfied. To roll back, unset
   `ASK_PROVIDER` and redeploy.

Smaller cloud models can follow the "only quote supplied amounts" rule less
reliably. When they don't, the existing checks refuse the answer (the student
sees "Could not produce a supported answer"), so test personal questions
before switching production.
