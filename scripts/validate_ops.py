#!/usr/bin/env python3
"""Validates the FYNQ agent operating system configuration.

Checks .claude/agents/*.md, .claude/settings.json, ops/autonomy.yaml,
ops/milestones.yaml, and that the runbooks and docs exist. Exits non-zero on
any failure. Needs only Python 3 and PyYAML (pip install pyyaml).

    python3 scripts/validate_ops.py
"""
import json
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover
    sys.exit("PyYAML is required: pip install pyyaml")

ROOT = Path(__file__).resolve().parent.parent
errors: list[str] = []


def fail(msg: str) -> None:
    errors.append(msg)


AGENTS = [
    "engineering-orchestrator", "frontend-agent", "backend-agent", "supabase-agent",
    "payments-agent", "qa-agent", "security-agent", "performance-agent",
    "code-review-agent", "release-agent",
]
# Reviewers must stay independent. They get no Agent tool, and the pure
# reviewers can't edit code. qa-agent may write tests only (stated in its file).
NO_EDIT = {"security-agent", "code-review-agent", "release-agent"}
NO_SPAWN = {"qa-agent", "security-agent", "code-review-agent", "release-agent"}
KNOWN_TOOLS = {"Read", "Grep", "Glob", "Bash", "Edit", "Write", "Agent", "WebFetch", "WebSearch", "NotebookEdit"}

# Each required element maps to a heading pattern it must appear under.
REQUIRED_SECTIONS = {
    "Role": r"^## Role\b",
    "Responsibilities": r"^## (Responsibilities|Owns)\b",
    "What it may inspect": r"^## May inspect\b",
    "Actions it may perform": r"^## May do\b",
    "Actions requiring human approval": r"^## Requires human approval\b",
    "Evidence before recommending": r"^## Evidence\b",
    "Output format": r"^## Output format\b",
    "Escalation conditions": r"^## Escalate\b",
}


def frontmatter(text: str, where: str) -> dict:
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        fail(f"{where}: missing YAML frontmatter")
        return {}
    try:
        data = yaml.safe_load(m.group(1)) or {}
    except yaml.YAMLError as e:
        fail(f"{where}: invalid frontmatter YAML: {e}")
        return {}
    return data


def check_agents() -> None:
    folder = ROOT / ".claude" / "agents"
    present = {p.stem for p in folder.glob("*.md")}
    for missing in sorted(set(AGENTS) - present):
        fail(f"agent missing: .claude/agents/{missing}.md")
    for extra in sorted(present - set(AGENTS)):
        fail(f"unexpected agent (add it to validate_ops.py if intended): {extra}")
    for name in AGENTS:
        path = folder / f"{name}.md"
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        where = str(path.relative_to(ROOT))
        fm = frontmatter(text, where)
        if fm.get("name") != name:
            fail(f"{where}: frontmatter name {fm.get('name')!r} != {name!r}")
        if not isinstance(fm.get("description"), str) or len(fm["description"]) < 40:
            fail(f"{where}: description missing or too short")
        tools = {t.strip() for t in str(fm.get("tools", "")).split(",") if t.strip()}
        if not tools:
            fail(f"{where}: tools must be listed explicitly (no implicit 'all tools')")
        if tools - KNOWN_TOOLS:
            fail(f"{where}: unknown tools {sorted(tools - KNOWN_TOOLS)}")
        if name in NO_EDIT and tools & {"Edit", "Write", "NotebookEdit"}:
            fail(f"{where}: reviewer must not have edit tools")
        if name in NO_SPAWN and "Agent" in tools:
            fail(f"{where}: reviewer must not spawn agents")
        for label, pattern in REQUIRED_SECTIONS.items():
            if not re.search(pattern, text, re.M):
                fail(f"{where}: missing section '{label}'")
        if name in {"qa-agent", "security-agent", "code-review-agent"} and not re.search(
                r"(never|not|NOT)[^.]{0,80}(author|implementer)'s (reasoning|rationale)", text):
            fail(f"{where}: reviewer must state it does not receive the author's reasoning")


def check_autonomy() -> None:
    path = ROOT / "ops" / "autonomy.yaml"
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    if data.get("max_autonomy_level") != 3:
        fail("autonomy.yaml: max_autonomy_level must be 3 unless a human changes this check")
    levels = {lv["level"]: lv for lv in data.get("levels", [])}
    if sorted(levels) != [0, 1, 2, 3, 4, 5]:
        fail("autonomy.yaml: levels 0-5 must all be defined")
    for lv in (4, 5):
        if levels.get(lv, {}).get("enabled") is not False:
            fail(f"autonomy.yaml: level {lv} must be enabled: false")
    for lv in range(0, 4):
        if lv <= data.get("max_autonomy_level", -1) and levels.get(lv, {}).get("enabled") is not True:
            fail(f"autonomy.yaml: level {lv} is within max but not enabled")
    for lv, spec in levels.items():
        if spec.get("enabled") and lv > data.get("max_autonomy_level", -1):
            fail(f"autonomy.yaml: level {lv} enabled above max_autonomy_level")
    if set(data.get("risk_classes", {})) != {"GREEN", "YELLOW", "RED"}:
        fail("autonomy.yaml: risk_classes must be exactly GREEN, YELLOW, RED")
    red = data.get("risk_classes", {}).get("RED", {})
    if not re.match(r"^required\b", str(red.get("human_approval", "")).strip()):
        fail("autonomy.yaml: RED must require human approval")
    if "security-agent" not in red.get("required_reviews", []):
        fail("autonomy.yaml: RED must require security-agent")
    for branch in ("main", "feat/connect-ask-backend"):
        if branch not in data.get("protected_branches", []):
            fail(f"autonomy.yaml: {branch} must be protected")
    if data.get("default_class") not in ("YELLOW", "RED"):
        fail("autonomy.yaml: default_class must be YELLOW or RED")
    for must in ("supabase/migrations/**", "server/billing.js", "api/stripe-webhook.js", "server/redact.js",
                 "api/analyze.js", "server/provider.js", ".claude/**", "CLAUDE.md", "ops/**",
                 "scripts/validate_ops.py", ".github/workflows/**", "vercel.json", ".vercelignore"):
        if must not in data.get("path_risk", {}).get("RED", []):
            fail(f"autonomy.yaml: {must} must be RED")


MILESTONES = [
    "instrumentation_complete", "25_registered_users", "10_unique_uploaders",
    "100_qualified_sessions", "10_real_payments", "250_registered_users",
    "500_registered_users", "high_traffic_mode",
]
MILESTONE_KEYS = ["trigger", "metrics_required", "agents_activated", "monitoring_activated",
                  "reports_activated", "human_approval"]
FORBIDDEN_MILESTONE_KEYS = {"deploy", "deploys", "enable_feature", "features_enabled", "release"}


def check_milestones() -> None:
    data = yaml.safe_load((ROOT / "ops" / "milestones.yaml").read_text(encoding="utf-8"))
    items = data.get("milestones", [])
    ids = [m.get("id") for m in items]
    if ids != MILESTONES:
        fail(f"milestones.yaml: ids must be {MILESTONES}, got {ids}")
    for m in items:
        for key in MILESTONE_KEYS:
            if key not in m or m[key] in (None, ""):
                fail(f"milestones.yaml: {m.get('id')}: missing {key}")
        if FORBIDDEN_MILESTONE_KEYS & set(m):
            fail(f"milestones.yaml: {m.get('id')}: milestones must not deploy or enable features")
        approval = str(m.get("human_approval", "")).strip().lower()
        if not approval or re.match(r"^(none|no|not required|n/?a)\b", approval):
            fail(f"milestones.yaml: {m.get('id')}: human_approval must name a human decision")
    if data.get("evaluation") not in ("manual", "scheduled_read_only"):
        fail("milestones.yaml: evaluation must be 'manual' or 'scheduled_read_only' (detection only, never deploys)")
    sys.path.insert(0, str(ROOT / "scripts" / "ops"))
    try:
        from milestones import validate_definitions  # noqa: E402
        for problem in validate_definitions(data):
            fail(problem)
    finally:
        sys.path.pop(0)


def check_triggers() -> None:
    path = ROOT / "ops" / "agent-triggers.yaml"
    if not path.is_file():
        fail("missing ops/agent-triggers.yaml")
        return
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    known = set(AGENTS)
    for name in data.get("pr_always", []) + data.get("pr_green_skip", []):
        if name not in known:
            fail(f"agent-triggers.yaml: unknown agent {name}")
    for route in data.get("pr_routes", []):
        if not route.get("paths") or not route.get("agents"):
            fail(f"agent-triggers.yaml: route {route.get('name')} needs paths and agents")
        for a in route.get("agents", []):
            if a not in known:
                fail(f"agent-triggers.yaml: route {route.get('name')}: unknown agent {a}")
    for event, spec in (data.get("events") or {}).items():
        for a in (spec or {}).get("agents", []):
            if a not in known:
                fail(f"agent-triggers.yaml: event {event}: unknown agent {a}")
        if any(k in (spec or {}) for k in ("deploy", "merge", "apply", "write")):
            fail(f"agent-triggers.yaml: event {event}: triggers may only label, comment or open issues")


def check_settings() -> None:
    path = ROOT / ".claude" / "settings.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        fail(f".claude/settings.json: {e}")
        return
    deny = data.get("permissions", {}).get("deny", [])
    for rule in ("Bash(git push origin main:*)", "Bash(git push origin feat/connect-ask-backend:*)",
                 "Bash(git push --force origin main:*)", "Bash(git push --force origin feat/connect-ask-backend:*)", "Bash(gh pr merge:*)",
                 "mcp__Stripe__stripe_api_write", "mcp__Supabase__apply_migration",
                 "mcp__Vercel__request_promote", "mcp__Vercel__assign_alias"):
        if rule not in deny:
            fail(f".claude/settings.json: deny must include {rule}")
    hooks = (data.get("hooks") or {}).get("PreToolUse") or []
    guarded = [h for h in hooks if "Bash" in str(h.get("matcher", "")) and "mcp__" in str(h.get("matcher", ""))
               and any("guard.mjs" in str(x.get("command", "")) for x in h.get("hooks", []))]
    if not guarded:
        fail(".claude/settings.json: the PreToolUse production guard (.claude/hooks/guard.mjs) must cover Bash and mcp__ tools")
    if not (ROOT / ".claude" / "hooks" / "guard.mjs").is_file():
        fail("missing .claude/hooks/guard.mjs")
    allow = data.get("permissions", {}).get("allow", [])
    if set(allow) & set(deny):
        fail(".claude/settings.json: a rule is both allowed and denied")


REQUIRED_FILES = [
    "CLAUDE.md",
    "ops/runbooks/auth.md", "ops/runbooks/payments.md", "ops/runbooks/database.md",
    "ops/runbooks/deployment.md", "ops/runbooks/incident-response.md",
    "docs/architecture.md", "docs/critical-user-flows.md", "docs/agent-system.md",
]


def check_files_and_links() -> None:
    for rel in REQUIRED_FILES:
        if not (ROOT / rel).is_file():
            fail(f"missing file: {rel}")
    # Every backticked repo path in the new docs must exist (catches stale references).
    scan = ["CLAUDE.md", *REQUIRED_FILES[1:], *[f".claude/agents/{a}.md" for a in AGENTS]]
    pattern = re.compile(r"`((?:\.claude|ops|docs|server|api|src|test|supabase|scripts|\.github)/[A-Za-z0-9_./-]+\.[a-z]{2,4})`")
    for rel in scan:
        path = ROOT / rel
        if not path.is_file():
            continue
        for ref in pattern.findall(path.read_text(encoding="utf-8")):
            if "*" in ref or "<" in ref or "YYYY" in ref:  # globs and placeholders
                continue
            if not (ROOT / ref).exists():
                fail(f"{rel}: references missing path {ref}")


# Workflows that may hold a job-level write token, and exactly which scopes.
# They run trusted code from the base branch only and write labels/comments/issues.
JOB_PERMISSIONS = {
    "pr-router.yml": {"pull-requests": "write", "issues": "write", "contents": "read"},
    "ci-failure.yml": {"issues": "write", "actions": "read", "contents": "read"},
}


def check_workflows() -> None:
    folder = ROOT / ".github" / "workflows"
    if not (folder / "ci.yml").is_file():
        fail("missing .github/workflows/ci.yml")
    for path in sorted(folder.glob("*.y*ml")):
        name = path.name
        text = path.read_text(encoding="utf-8")
        data = yaml.safe_load(text) or {}
        triggers = data.get(True, data.get("on", {}))  # YAML 1.1 parses the key `on` as True
        if "pull_request_target" in (triggers or {}):
            fail(f"{name}: pull_request_target is not allowed (runs untrusted code with secrets)")
        if re.search(r"\bsecrets\s*[.\[]|toJSON\(\s*secrets", text):
            fail(f"{name}: workflows must not use secrets")
        if data.get("permissions") != {"contents": "read"}:
            fail(f"{name}: top-level permissions must be exactly contents: read")
        allowed = JOB_PERMISSIONS.get(name, {})
        for job_name, job in data.get("jobs", {}).items():
            if "permissions" in job:
                extra = {k: v for k, v in (job["permissions"] or {}).items() if allowed.get(k) != v and not (v == "read")}
                if not allowed or extra:
                    fail(f"{name}: job {job_name} may not widen permissions beyond {allowed or 'contents: read'} (got {job['permissions']})")
            if allowed and job.get("permissions") and any(t in (triggers or {}) for t in ("push", "schedule")):
                fail(f"{name}: write permissions are only allowed on pull_request / workflow_run triggers")
            for step in job.get("steps", []):
                uses = step.get("uses")
                if uses and not re.search(r"@[0-9a-f]{40}$", uses):
                    fail(f"{name}: action not pinned to a commit SHA: {uses}")
                if uses and "checkout" in uses and (step.get("with") or {}).get("persist-credentials") is not False:
                    fail(f"{name}: actions/checkout must set persist-credentials: false")
        if name == "ci.yml":
            runs = " ".join(str(s.get("run", "")) for j in data.get("jobs", {}).values() for s in j.get("steps", []))
            for cmd in ("npm ci", "npm run build", "vitest run", "node --test", "npm run test:beta",
                        "npm run test:billing", "test/attribution-integration.mjs", "test/observability-integration.mjs",
                        "scripts/validate_ops.py", "scripts/ops/tests/test_ops.py", "scripts/ops/nightly.py --fixtures"):
                if cmd not in runs:
                    fail(f"ci.yml: required step missing: {cmd}")


# Identifiers and secrets that must never be committed in these public files.
LEAK_PATTERNS = {
    "Stripe account id": r"\bacct_[A-Za-z0-9]{10,}",
    "Stripe secret key": r"\b(sk|rk)_(live|test)_[A-Za-z0-9]{10,}",
    "webhook secret": r"\bwhsec_[A-Za-z0-9]{10,}",
    "Vercel project id": r"\bprj_[A-Za-z0-9]{20,}",
    "Vercel team id": r"\bteam_[A-Za-z0-9]{20,}",
    "Supabase project ref": r"\b[a-z]{20}\.supabase\.co\b|(?<![A-Za-z0-9_/.-])[a-z]{20}(?![A-Za-z0-9_/.-])",
    "JWT": r"\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}",
}


def check_no_leaks() -> None:
    files = [ROOT / "CLAUDE.md", ROOT / ".claude" / "settings.json"]
    for folder in (".claude/agents", "ops", "docs", ".github"):
        files += [p for p in (ROOT / folder).rglob("*") if p.is_file() and p.suffix in {".md", ".yaml", ".yml", ".json"}]
    new_docs = {"architecture.md", "agent-system.md", "critical-user-flows.md"}
    for path in files:
        if path.parent.name == "docs" and path.name not in new_docs:
            continue  # pre-existing docs are out of scope for this check
        text = path.read_text(encoding="utf-8")
        for label, pattern in LEAK_PATTERNS.items():
            if re.search(pattern, text):
                fail(f"{path.relative_to(ROOT)}: contains a {label}; keep it out of the public repo")


def main() -> int:
    check_agents()
    check_autonomy()
    check_milestones()
    check_triggers()
    check_settings()
    check_files_and_links()
    check_workflows()
    check_no_leaks()
    if errors:
        print(f"ops validation FAILED ({len(errors)}):")
        for e in errors:
            print(f"  - {e}")
        return 1
    print(f"ops validation passed: {len(AGENTS)} agents, autonomy, {len(MILESTONES)} milestones, settings, {len(REQUIRED_FILES)} files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
