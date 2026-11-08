# Runbook: incident response

One human operator, assisted by agents. Agents **diagnose and recommend**; the
human **acts** on production.

## Severity
| Sev | Examples | Response |
| --- | --- | --- |
| SEV1 | Students see someone else's data. PII sent somewhere it shouldn't be. Payments taken without unlock at scale. Secret leaked. Site down. | Stop everything. Human acts immediately. |
| SEV2 | Upload or analysis broken for many users. Checkout failing. Webhook failing. | Same day. |
| SEV3 | A single feature degraded, a copy bug, slow pages. | Normal PR flow. |

## First 15 minutes
1. **Freeze merges** into `feat/connect-ask-backend` and `main` (human; agents
   stop opening PRs against them).
2. Establish what's live: the `www.fynliq.com` alias → deployment id → commit
   SHA (agents can read this).
3. Collect read-only evidence:
   - Vercel runtime errors and logs for `/api/*` around the start time.
   - Supabase logs (api, postgres, auth) and advisors.
   - Stripe events and webhook delivery attempts (GET only).
   - `/admin` metrics (via the human's admin session).
4. Mitigate with the smallest reversible lever (human):
   - Bad release → reassign the alias to the previous deployment
     (`deployment.md`).
   - Payments → `PAYWALL_ENABLED=false` (`payments.md`).
   - Abuse or cost spike → lower `BETA_MAX_QUESTIONS_PER_DAY` or
     `ASK_USER_MAX_PER_DAY`, or enable Vercel Attack Challenge Mode.
   - Everything API-side → `BETA_ENABLED=false` (fails closed with a 503
     message).
   - Secret leak → rotate at the source first, then update Vercel env, then
     redeploy.
5. Communicate: write down what students saw and for how long.

## PII / data-exposure (SEV1) specifics
- Don't copy affected personal data into chat, issues or PRs. Refer to row ids
  and counts.
- Preserve evidence: note log query ranges, and don't delete rows.
- The human decides on user notification and any legal steps.

## After
- Root cause, a regression test, and the fix through the normal PR flow (RED
  where applicable).
- A post-incident note in `docs/` (no PII): timeline, impact, cause, fix, and
  follow-ups.
- Add a monitor so the same failure alerts next time (ties into
  `ops/milestones.yaml` `instrumentation_complete`).

## Monitoring
Error tracking, uptime checks, alerting and log retention are the subject of
phase 2 (observability). Wire each alert to this runbook as it's added.
