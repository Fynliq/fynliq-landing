#!/usr/bin/env python3
"""Classifies a pull request and names the agents that must review it.

    python3 scripts/ops/route_pr.py --files changed.txt            # print the plan
    python3 scripts/ops/route_pr.py --repo O/R --pr 17 --apply      # label + comment (needs GITHUB_TOKEN)

Risk class comes from ops/autonomy.yaml (path_risk; highest class wins; files
matching nothing get default_class). Agents come from ops/agent-triggers.yaml.
With --apply it sets labels (risk:*, agent:*) and keeps ONE sticky comment
updated. It never approves, merges or changes code.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

from opslib import GitHub, load_yaml, path_matches

ORDER = {"GREEN": 0, "YELLOW": 1, "RED": 2}
MARKER = "<!-- fynq-agent-router -->"
AGENT_ORDER = ["engineering-orchestrator", "frontend-agent", "backend-agent", "supabase-agent", "payments-agent",
               "performance-agent", "security-agent", "qa-agent", "code-review-agent", "release-agent"]


def risk_for(path: str, autonomy: dict) -> str:
    rules = autonomy.get("path_risk", {})
    for cls in ("RED", "YELLOW", "GREEN"):
        if any(path_matches(path, pattern) for pattern in rules.get(cls, [])):
            return cls
    return autonomy.get("default_class", "YELLOW")


def plan(files: list[str], autonomy: dict | None = None, triggers: dict | None = None) -> dict:
    autonomy = autonomy if autonomy is not None else load_yaml("ops/autonomy.yaml")
    triggers = triggers if triggers is not None else load_yaml("ops/agent-triggers.yaml")
    per_file = {f: risk_for(f, autonomy) for f in files}
    risk = max(per_file.values(), key=lambda c: ORDER[c]) if per_file else "GREEN"
    agents: set[str] = set(triggers.get("pr_always", []))
    matched: list[str] = []
    for route in triggers.get("pr_routes", []):
        if any(path_matches(f, p) for f in files for p in route.get("paths", [])):
            agents.update(route.get("agents", []))
            matched.append(route["name"])
    if risk == "GREEN":
        agents.difference_update(triggers.get("pr_green_skip", []))
    if risk == "RED":
        agents.add("security-agent")  # RED always gets an independent security review
    agents.add("release-agent")
    ordered = [a for a in AGENT_ORDER if a in agents] + sorted(agents - set(AGENT_ORDER))
    return {
        "risk": risk,
        "agents": ordered,
        "routes": matched,
        "red_files": sorted(f for f, c in per_file.items() if c == "RED"),
        "human_approval": "required before merge" if risk == "RED" else "human merges",
    }


def labels_for(result: dict) -> list[str]:
    return [f"risk:{result['risk'].lower()}"] + [f"agent:{a.removesuffix('-agent')}" for a in result["agents"]]


def comment_for(result: dict) -> str:
    lines = [MARKER, f"### Agent routing: **{result['risk']}**", ""]
    lines.append("Independent reviews required (each gets the diff and requirement only, never the author's reasoning):")
    lines += [f"- [ ] `{a}`" for a in result["agents"]]
    if result["red_files"]:
        lines += ["", "RED files (human approval required before merge):"]
        lines += [f"- `{f}`" for f in result["red_files"][:30]]
    lines += ["", "_Set by `scripts/ops/route_pr.py` from `ops/autonomy.yaml` and `ops/agent-triggers.yaml`. "
              "Reviews are run by the scheduled FYNQ agent sessions; nothing here merges or deploys._"]
    return "\n".join(lines)


def apply(gh: GitHub, repo: str, pr: int, result: dict) -> None:
    current = {l["name"] for l in gh.get(f"/repos/{repo}/issues/{pr}/labels") or []}
    stale = sorted(l for l in current if (l.startswith("risk:") or l.startswith("agent:")) and l not in labels_for(result))
    for name in stale:
        gh.request("DELETE", f"/repos/{repo}/issues/{pr}/labels/{name.replace(':', '%3A')}")
    gh.request("POST", f"/repos/{repo}/issues/{pr}/labels", {"labels": labels_for(result)})
    body = comment_for(result)
    existing = [c for c in gh.paged(f"/repos/{repo}/issues/{pr}/comments") if MARKER in (c.get("body") or "")]
    if existing:
        gh.request("PATCH", f"/repos/{repo}/issues/comments/{existing[0]['id']}", {"body": body})
    else:
        gh.request("POST", f"/repos/{repo}/issues/{pr}/comments", {"body": body})


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--files", help="file with one changed path per line")
    ap.add_argument("--repo")
    ap.add_argument("--pr", type=int)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args(argv)
    gh = GitHub(os.environ.get("GITHUB_TOKEN"))
    if args.files:
        files = [l.strip() for l in open(args.files, encoding="utf-8") if l.strip()]
    elif args.repo and args.pr:
        files = [f["filename"] for f in gh.paged(f"/repos/{args.repo}/pulls/{args.pr}/files")]
    else:
        ap.error("--files or --repo/--pr required")
    result = plan(files)
    print(json.dumps(result, indent=2))
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write(comment_for(result).replace(MARKER, "") + "\n")
    if args.apply:
        try:
            apply(gh, args.repo, args.pr, result)
        except Exception as exc:  # fork PRs get a read-only token: the summary still has the plan
            print(f"Could not label/comment ({type(exc).__name__}); plan is in the job summary.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
