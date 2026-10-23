# Fynliq Earn AI — SMS pilot (not live)

This feature branch adds a **customer-initiated, two-way SMS proof of concept**.
It is NOT a deployed production messaging service, marketplace, source of live
income opportunities, or a connection to the separately trained custom model.

## Reused Fynliq components

- Existing `server/provider.js` and server-only `OPENAI_API_KEY` /
  `OPENAI_MODEL` for text responses.
- The existing Vercel `api/ask.js` function handles `/api/ask?channel=sms` and delegates to `server/sms-inbound.js` (avoids an extra Hobby function).
- Supabase REST API and a narrow, new RLS-enabled consent table.
- Existing `server/privacy.js` input filtering in the model provider.

The existing Ask Fynliq, finance-document workflow, subscriptions, and closed
beta are not modified. This pilot intentionally stores **no** SMS content
history or raw phone numbers. It does not authenticate customers to financial
accounts: incoming SMS ownership alone must never grant account access.

## Required environment variables (server only, never VITE_)

| Variable | Meaning |
| --- | --- |
| `TWILIO_AUTH_TOKEN` | Token used by Twilio to sign incoming HTTP webhooks |
| `TWILIO_SMS_NUMBER` | Purchased number in E.164 format, e.g. +1XXXXXXXXXX |
| `FYNLIQ_SMS_WEBHOOK_URL` | Exact public, HTTPS Twilio webhook URL, e.g. https://fynliq.com/api/ask?channel=sms |
| `SUPABASE_URL` | Existing Supabase project endpoint |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase service-role key |
| `FYNLIQ_SMS_PHONE_HASH_KEY` | Unique random secret of at least 32 characters to HMAC-hash inbound phone numbers |
| `OPENAI_API_KEY` | Already-used existing model provider API key |
| `OPENAI_MODEL` | Already-used existing model provider identifier |

**Do not set up keys by committing an .env file.** Configure server-only
environment secrets in Vercel. Existing Vite variables may include a URL, but
service role credentials must never be prefixed `VITE_`.

## External setup still required

1. Create a Twilio account. Lease an SMS-enabled U.S. number using the Twilio
   console. You must approve the purchase; no number was acquired by this PR.
2. Submit accurate organization/campaign details for U.S. A2P 10DLC and wait
   for approval before sending SMS with a local number. Toll-free SMS requires
   its own verification. Make sure disclosures, HELP and STOP flows match the
   approved sender use case.
3. Apply `supabase/migrations/202610220001_earn_sms_consent.sql` after review.
   Configure the server-side variables above in the intended preview
   environment. No migrations are applied automatically by this branch.
4. Configure the Twilio Messaging webhook for `POST` to
   `FYNLIQ_SMS_WEBHOOK_URL`. Use the same exact public URL (including
   scheme, hostname, and trailing slash if any) in the environment variable,
   since Twilio signs the actual URL.
5. Enable an authorized preview environment and test with the approved sender.
   The model path uses the current OpenAI provider configuration; the
   custom-trained AI model has not yet been verified as an available API.

## Interactive conversation

- `JOIN` → consent disclosure and request to reply YES.
- `YES` after JOIN → subscribe to requested AI replies.
- `STOP`, `UNSUBSCRIBE`, etc. → opt out immediately.
- `START` → restart the two-step opt-in flow.
- `HELP` → support details.
- Any other message before consent → invitation to JOIN.
- After consent, messages go through the existing AI provider, which provides
  **general earning ideas**, not live income opportunities or autonomous
  execution. Replies do not promise guaranteed income.

Twilio's platform-level opt-out handling may prevent messages after STOP even
if the customer later contacts the app. Respect platform suppression and do
not override it with separate sending APIs.

## Security / limitations

- `X-Twilio-Signature` verification uses the exact configured URL and every
  form parameter. Form field duplication, oversized payloads, wrong recipient,
  wrong method, and unsupported sender formats are rejected. Consider migrating
  to Twilio's official validation helper when adding the SDK.
- The phone identifier is an HMAC digest, never a raw number in Supabase.
- Consent persistence failures fail closed (503), not as an implicit opt-in.
- The webhook produces TwiML synchronously, with an 8.5-second AI call limit.
  **For real scale:** move AI calls to a durable idempotent queue and send via
  Twilio's REST API after the webhook has been acknowledged. Implement retries,
  rate limiting, monitoring, and message-SID deduplication. A Twilio retry
  could cause duplicate AI processing in this prototype.
- No automated outbound prospecting, marketing campaigns, scraping, application
  submissions, verified opportunity lookup, payment actions, earnings tracking,
  or persistent conversation history is included.
- SMS is not end-to-end encrypted and should not be used to send sensitive
  financial details or account credentials.
- Before a customer rollout, review disclosures, consent retention, incident
  logging, cost caps, and phone-number recycling risks.

## Local test command

```sh
node --test test/sms-earn.test.mjs
```

Tests use pure injected mocks and do not send texts or contact Supabase.
Existing project tests remain `npm test`.

## Next engineering steps

1. Implement a durable queue and message-SID idempotency with retries.
2. Build customer signup/verification and consent management in the fynliq
   frontend, binding a verified phone to a logged-in user *separately* from SMS.
3. Add user-controlled delete and data export, audit events and abuse controls.
4. Verify the custom-model endpoint, then add a configurable provider adapter.
5. Add licensed/authorized real opportunity feeds with attribution and
   freshness checks before advertising real opportunities to customers.

## Extended action commands (2026-10-22)

The SMS pilot now routes to `server/sms-actions.js` after core conversational consent:

- `UBER` / `RIDE`: official Uber handoff URL; customer sees and confirms all prices and booking in Uber.
- `DEALS`: returns a recently manually verified, unexpired catalog offer if an operator has configured one. Otherwise explicitly says there are no reviewed deals. This is **customer-requested only**.
- `DEALS JOIN` then `DEALS YES`: separate optional promotional preference; `DEALS STOP` opts out of promotional preferences but keeps support SMS. `STOP` opts out of all messaging. **No background promotional dispatch** is enabled.
- `TASK CAPTION: brief`, `TASK LISTING: brief`, `TASK REPLY: brief`: the existing AI generates a short ready-to-review deliverable, with an explicit label that it has **not** been submitted or paid.

Server-only `FYNLIQ_REVIEWED_DEALS_JSON` must be a manually curated array of offers with `reviewedByFynliq`, `reviewedAt`, `expiresAt`, `title` and an HTTPS `sourceUrl`. This catalog is not a live deals feed and must be checked by operations.

See `docs/EARN_AUTONOMOUS_TASKS.md` for the buyer-funded workflow required before the agent could truthfully earn money for customers. Full marketplace submission, earnings settlement, payout orchestration and proactive offer SMS do not exist yet.

Test suite: `node --test test/sms-earn.test.mjs test/sms-actions.test.mjs`.
