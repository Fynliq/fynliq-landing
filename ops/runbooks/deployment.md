# Runbook: deployment

Agents may **read** everything here. Every step marked 👤 is human-only.
Concrete project identifiers and security-hardening items are kept in the
operator's private notes, not in this public repository. Agents discover the
identifiers at runtime with read-only Vercel calls.

## How www.fynliq.com is actually deployed

| Thing | Value |
| --- | --- |
| `www.fynliq.com` | Alias to the **latest deployment of `feat/connect-ask-backend`** (the live branch) |
| `fynliq.com` | 308 → `www.fynliq.com` |
| `*.vercel.app` hosts | 308 → `www.fynliq.com` via `vercel.json` |
| Vercel "production" target | Builds `main`, which is behind the live branch and is not what students see |
| Live configuration | The live env vars (beta, Stripe, OpenAI) are scoped to the live branch |

Consequences:
- **Merging into `feat/connect-ask-backend` deploys to students within minutes,
  with live payments.** There's no staging step.
- `docs/DEPLOYMENT.md` ("builds from `main`") is out of date on this point.

## Recommended consolidation 👤 (separate, planned change; not done by agents)
1. Pick one release branch (rename `feat/connect-ask-backend` → `main`, or
   fast-forward `main` to it).
2. Move the live env vars to the **Production** environment, then point
   `www.fynliq.com` at production deployments of that branch.
3. Review env var scoping so production secrets exist only where production
   code runs.
4. Make GitHub branch protection (require PRs and the `CI` check, block force
   pushes) part of the release process.

## Shipping a PR
1. CI green on the PR (`.github/workflows/ci.yml`).
2. `release-agent` gate table in the PR, with all reviewers PASS.
3. If the PR needs a migration, 👤 apply it **before** merge (see
   `database.md`), unless the gate says "after".
4. If the PR needs env vars, 👤 set them on the right environment and branch
   scope **before** merge.
5. 👤 Merge. Vercel builds, and the branch alias moves `www.fynliq.com`. Note that
   this rebuild uses the env values current at build time.
6. Verify the live build (below).

## Shipping the phase 2 observability PR (once)
1. 👤 Apply `supabase/migrations/202610070001_observability.sql` in production
   **before** merging (see `database.md`). The code is safe without it
   (events are dropped), but data is lost until it's applied.
2. 👤 Optional, for the nightly reports: set `OPS_READ_TOKEN_SHA256` on the live
   env scope (see `ops/ops-repo-template/README.md`). Without it, the metrics
   view answers 401 and nothing else changes.
3. Merge, then verify: within minutes `api_requests` and `landing_view` rows
   appear (`select public.ops_milestone_metrics('')` through the read-only
   connector).

## Verify what's live
```bash
curl -s https://www.fynliq.com/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'
```
Compare with `dist/assets/` from `npm run build` of the merged commit. Status
codes prove nothing: the SPA rewrite returns 200 for everything. Repeated
automated requests trip Vercel's bot challenge (403
`X-Vercel-Mitigated: challenge`). That's rate limiting, not an outage.

Agents can also read the deployment list and aliases (read-only): the
`www.fynliq.com` alias should point at the newest READY deployment for the
merge SHA.

## Roll back 👤
- **Fastest:** in Vercel, point the `www.fynliq.com` alias at the previous READY
  deployment of the live branch. Agents can list candidates, but only the human
  reassigns the alias.
- **Durable:** revert the merge commit through a PR (agents may prepare it).
- If the bad release included a migration, see `database.md`. Code rollback
  doesn't undo schema changes.
- Payment emergency: see `payments.md` (the `PAYWALL_ENABLED` kill switch).
