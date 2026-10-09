# The FYNQ agent system

How one human developer works with Claude Code agents safely. The rules live
in `CLAUDE.md`. This document explains the design.

## Principles
1. **The human decides; agents gather evidence.** Merges, production writes
   and RED work need the human.
2. **Independent review.** Reviewers (qa, security, code-review) get the diff
   and the requirement, **never the author's reasoning**, so they don't inherit
   its assumptions.
3. **Minimum routing.** The orchestrator invokes only the specialists a task
   needs.
4. **Evidence over assertion.** A check that didn't run is reported as not run.
5. **Read-only production by default.** Supabase, Stripe (live) and Vercel are
   inspected, never changed, by agents.

## Agents

| Agent | Priority | Kind | Edits code? | Typical trigger |
| --- | --- | --- | --- | --- |
| engineering-orchestrator | high | planner/router | small/GREEN only | every non-trivial task |
| qa-agent | high | independent reviewer | tests only | YELLOW/RED changes |
| security-agent | high | independent reviewer | no | RED paths, auth/PII/payments |
| code-review-agent | high | independent reviewer | no | every PR |
| release-agent | high | gate | no | every PR, last |
| frontend-agent | on demand | implementer | `src/` | UI |
| backend-agent | on demand | implementer | `api/`, `server/` | API |
| supabase-agent | on demand | implementer | `supabase/` | schema/RPC (RED) |
| payments-agent | on demand | implementer | billing files | money (RED) |
| performance-agent | on demand | implementer | non-RED | measured perf problems |

Definitions are in `.claude/agents/*.md`. Each one states its role,
responsibilities, what it may inspect, what it may do, what requires approval,
the evidence it needs, its output format and when it escalates.

## Lifecycle of a change

```
request → orchestrator: requirement, files, risk class, plan
        → specialist(s) on a branch/worktree (parallel only if files don't overlap)
        → local tests + build
        → review packet = { requirement, git diff base...HEAD, affected files, test output }
             ├─ qa-agent         (fresh context)
             ├─ security-agent   (fresh context, if RED or sensitive paths)
             └─ code-review-agent(fresh context)
        → fixes → re-review of the changed hunks
        → release-agent gate table in the PR
        → HUMAN merges (merging to the live branch = deploy)
```

### Building a review packet (orchestrator)
```bash
git diff --stat origin/feat/connect-ask-backend...HEAD
git diff origin/feat/connect-ask-backend...HEAD
```
Pass this, plus the original requirement text and the CI and test output. **Do
not** paste the plan, the implementer's summary, or phrases like "this is
safe because…".

## Autonomy and risk
`ops/autonomy.yaml`: the maximum is **Level 3** (PR + preview). Levels 4
(merge) and 5 (production deploy) are disabled. Path rules map files to
GREEN, YELLOW or RED, and the highest class wins.

## Milestones
`ops/milestones.yaml` turns on analyses, monitoring and report sections as
FYNQ grows. Milestones **never deploy or enable features**. Each one is
detected nightly from authoritative aggregates (`ops_milestone_metrics()`:
accounts, successful reader uploads, My Aid views, live non-test payments) by
`scripts/ops/milestones.py`. Reaching one opens a "Milestone reached" issue in
the private ops repo for the human to acknowledge. State is kept there, not in
this public repo.

## What wakes each agent (`ops/agent-triggers.yaml`)

| Signal | Detected by | Agents woken | Delivered as |
| --- | --- | --- | --- |
| PR opened or updated | `.github/workflows/pr-router.yml` (routing code from the base branch) | code-review-agent + qa-agent always (qa skipped for GREEN), plus path routes below | `risk:*` and `agent:*` labels + one sticky PR comment |
| PR touches payments | router | payments-agent, security-agent, qa-agent | labels |
| PR touches `supabase/` | router | supabase-agent, security-agent, qa-agent | labels |
| PR touches auth, RLS or secrets | router | security-agent | labels |
| PR touches analytics/PII code | router | security-agent, qa-agent | labels |
| PR touches `src/` | router | frontend-agent, qa-agent | labels |
| PR touches `api/` or `server/` | router | backend-agent, qa-agent | labels |
| CI fails on a protected branch | `.github/workflows/ci-failure.yml` | engineering-orchestrator | `ci-failed` issue (public repo; no business data) |
| Error spike (>5% 5xx, 50+ requests) | hourly `health.yml` in fynq-ops | engineering-orchestrator, backend-agent | trigger issue in fynq-ops |
| Frontend error spike | hourly | engineering-orchestrator, frontend-agent | trigger issue |
| **Stripe webhook failure** (any) | hourly | **payments-agent, security-agent** | trigger issue + email |
| AI reader success below 80% | hourly | backend-agent | trigger issue |
| Auth failure spike | hourly | security-agent | trigger issue |
| Failed deploy, failed uptime | nightly | engineering-orchestrator | trigger issue |

Triggers only label, comment or open issues. They never merge, deploy or
write to production.

## Overnight
1. **10:30 UTC, `fynq-ops` nightly workflow** (deterministic, free):
   - reads health, funnel, revenue and milestone aggregates, plus GitHub
     state (PRs, CI, deploys, uptime, agent issues);
   - writes the **CEO morning report** and the **engineering report** as
     issues in the private repo;
   - opens trigger and milestone issues.

   It can be dry-run on fixtures:
   `python3 scripts/ops/nightly.py --fixtures scripts/ops/tests/fixtures/problems --out /tmp/r`.
2. **Then a Claude scheduled session** follows `ops/autopilot-session.md`:
   - wakes the labelled agents, which investigate read-only, review PRs and
     write regression tests and fixes as PRs;
   - comments on the trigger issues;
   - sends the owner a short summary.

   It never merges or touches production. The guard hook blocks it.

Why a private repo: this app repo is public, so Actions logs, artifacts and
issues here are public. Revenue and user counts go only to `fynq-ops`, and
the scripts refuse to publish to a repository that isn't private.

## Enforcement
The definitions are instructions. Hard enforcement is layered on top:
- **Guard hook (`.claude/hooks/guard.mjs`, `PreToolUse`).** It runs in every
  permission mode, including auto-approve and bypass, and fails closed. It
  blocks:
  - pushes, force pushes and deletes on protected branches;
  - PR merges by any route (`gh pr merge`, `gh api …/merge`, `…/merges`,
    auto-merge);
  - GitHub writes other than issues, comments, labels, reviews and opening or
    editing PRs;
  - Vercel and Supabase CLI production commands, the Stripe CLI, and direct
    HTTP calls to their APIs;
  - reads of `.env` files;
  - production MCP write tools;
  - any production SQL that isn't one read-only SELECT of `ops_*` or
    `*_metrics` functions.

  Tested in `test/guard.test.mjs`.
- **This matters because agents act as the owner's GitHub account** (push
  rights, no required approvals). Without the hook, an auto-approved session
  could merge a green PR through the API.
- `.claude/settings.json` deny and ask rules are a second layer for
  interactive sessions. Prefix rules can be bypassed by unusual spellings,
  which is why the hook exists.
- 👤 GitHub branch protection on `main` and `feat/connect-ask-backend` (PR
  plus `Build and tests` and `Ops config` checks, no force push, no bypass) is
  on. It blocks direct pushes, but not API merges of a green PR. The hook
  covers that.
- Production numbers are read through a bearer-token, aggregate-only view
  whose database calls run in read-only transactions.
- Reviewer "read-only" is enforced by tool lists (no Edit, Write or Agent)
  plus instruction. Bash stays available to run tests.

## Roadmap
1. **Phase 1 (done):** operating system, policies, runbooks, CI foundation.
2. **Phase 2 (this PR):**
   - canonical analytics events and the API health log;
   - the read-only metrics layer, PR routing and event triggers;
   - the nightly reports in a private repo, and the guard hook.
3. **Phase 3:** agents start *recommending* improvements (conversion,
   retention) from the measured funnel. It doesn't start until
   `instrumentation_complete` is reached, the numbers have been checked
   against reality, and the human approves.
