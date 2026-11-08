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
`ops/milestones.yaml` turns on monitoring, reports and extra agent analysis as
FYNQ grows. Milestones **never deploy or enable features**. They start manual,
because most of the metrics they need (errors, uptime, qualified sessions)
aren't instrumented yet.

## Enforcement
The definitions are instructions. Hard enforcement is layered on top:
- `.claude/settings.json` denies the most dangerous tool calls for every Claude
  Code session in this repo: pushes, force pushes and deletes on protected
  branches; PR merges; Vercel promote, rollback, alias, env, domain, routing,
  firewall and deployment-creation tools; Supabase migration, edge-function and
  branch-merge tools; Stripe writes; and reading local `.env` files (`.env.example` stays readable).
  Prefix rules can be bypassed by unusual command spellings, and MCP tool
  names depend on each machine's server names (common spellings are listed), so
  treat this as defense in depth. `git push` to other branches, the `stripe` and
  `supabase` CLIs, and Supabase `execute_sql` and branching are set to *ask*.
- 👤 GitHub branch protection on `main` and `feat/connect-ask-backend` (require
  PR + `CI` check, no force push) is the strongest control. It must be configured
  by a repo admin, and nothing here should be assumed to replace it.
- Reviewer "read-only" is enforced by tool lists (no Edit, Write or Agent) plus
  instruction. Bash is still available to run tests.
- The CI workflow runs on every PR.

## Roadmap
1. **Phase 1 (this PR):** operating system, policies, runbooks, CI foundation.
2. **Phase 2:** observability and event instrumentation (errors, uptime, journey
   events, qualified sessions, automated E2E against a preview with test
   Stripe).
3. **Phase 3:** scheduled, read-only nightly analysis that opens issues and PRs
   only. It doesn't start until `instrumentation_complete` is reached and the
   human approves.

No overnight self-improvement until the app's behaviour can be measured
reliably.
