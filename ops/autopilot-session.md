# FYNQ autopilot session (Claude scheduled task)

The playbook a scheduled Claude session follows each morning, after the
private `fynq-ops` nightly workflow has written its reports. It runs as the
owner's GitHub account, so the **production guard hook**
(`.claude/hooks/guard.mjs`) is what keeps it at autonomy level 3. The hook
blocks merges, protected-branch pushes and production writes in every
permission mode, including auto-approve.

## Inputs (read-only)
1. The latest `report:ceo` and `report:engineering` issues in the private
   `fynq-ops` repo.
2. Open `trigger` and `milestone` issues in `fynq-ops`, and open `ci-failed`
   issues in `Fynliq/fynliq-landing`. The `agent:*` labels say which agents
   to wake.
3. Open PRs in `Fynliq/fynliq-landing` with their `risk:*` and `agent:*`
   labels (from the PR router) and CI state.

## What it may do (level 3 and below)
- Run the agents named by the labels, following `.claude/agents/*.md`.
  Reviewers (qa, security, code-review) get the PR **diff and requirement
  only**, in a fresh agent.
- Post review results as **PR comments**, and investigation notes as
  **comments on the trigger issue** in `fynq-ops`. Business numbers stay in
  `fynq-ops`; nothing with revenue or user counts is posted in the public repo.
- For a reproducible bug: write a failing regression test and a fix on a new
  branch, and open a PR against `feat/connect-ask-backend`. CI runs the tests,
  because the npm registry is blocked in Claude sessions.
- Create GitHub issues for things a human should decide.

## What it must never do
Merge or approve PRs, push to `main` or `feat/connect-ask-backend`, apply
migrations, write production data, change RLS, auth, Stripe or pricing,
issue refunds, rotate secrets, change Vercel configuration or env vars,
promote, roll back, or change repository settings. The guard blocks these.
If a task needs one, stop and say so in the summary.

## Order of work
1. **Payments first.** Any `webhook_failure` trigger → payments-agent and
   security-agent investigate read-only, using the reconciliation in
   `ops/runbooks/payments.md`.
2. **Production errors.** Error, AI-failure or auth-failure spikes →
   engineering-orchestrator picks the specialist.
3. **Failed CI or deploys** on protected branches → engineering-orchestrator
   finds the failing step.
4. **Open PRs** lacking the reviews their labels require → run those
   reviewers.
5. **Milestones** → only note the newly active analyses. Never change product
   behaviour.

## Output
End with one short message to the owner (SendUserMessage), at most 12 lines:
what was investigated, issues and PRs created (links), PRs awaiting approval,
and any decision only the human can make. If nothing needed attention, say so
in one line.
