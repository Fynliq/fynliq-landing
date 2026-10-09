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

### Uptime checks (`.github/workflows/uptime.yml`)
**Status: added, but NOT active yet.** Scheduled workflows run only from the
repository's default branch, which is currently `feat/search-tabs-gradi`. It
becomes active once a human sets the default branch to the live branch
(Settings → General → Default branch).

Every 15 minutes, GitHub Actions makes anonymous, read-only GETs to the
landing page and the guest-session, account-session, log-in, billing, reader
and webhook routes (`scripts/uptime-check.mjs`). Each probe confirms the page
or function is deployed and answers as expected. The session and log-in
routes also fail closed with 503 when server configuration is missing, so
those catch a broken env; billing and the reader only check configuration in
some paywall modes. None of this proves the database is healthy (anonymous
requests stop before any query).

- **Alert:** a failed run emails the person who last changed the schedule in
  the workflow file (GitHub's rule for scheduled workflows). The run's summary
  shows which check failed and the HTTP status.
- **First response:** open the failed run. If a route returns 503, check the
  live env vars (`deployment.md`), then recent deploys, then roll back the alias.
- **Inconclusive:** a Vercel bot challenge (403 + `x-vercel-mitigated`) is
  marked inconclusive, not down. If every check is challenged, the run fails,
  because nothing was verified.
- **Run it now:** `node scripts/uptime-check.mjs` locally, or (once active)
  Actions → Uptime → Run workflow.
- **Who gets the email:** GitHub emails the account that last changed the
  schedule or last re-enabled the workflow. Once active, the human should
  disable and re-enable "Uptime" in the Actions tab to become the recipient,
  and check that GitHub notifications for failed Actions runs are on.
- **Caveats:** GitHub may delay or skip scheduled runs under load, and it
  turns schedules off in public repos after 60 days without activity. A quiet
  inbox isn't proof of health; glance at the Actions tab now and then.

Error tracking and journey events are the next phase-2 items. Wire each new
alert to this runbook as it's added.
