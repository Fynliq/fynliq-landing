#!/usr/bin/env python3
"""FYNQ nightly autopilot: the deterministic part.

Reads product health and funnel metrics (read-only view), GitHub state (PRs,
CI, deployments, uptime, agent work), evaluates milestones and triggers, and
writes the CEO morning report and the engineering report. With --publish it
posts them as issues in the PRIVATE ops repository and opens one issue per
fired trigger / newly reached milestone, labelled with the agents to wake.

It never writes to production: metrics are read through a STABLE read-only
view, and the only writes are GitHub issues/comments in the ops repo (plus the
state files the calling workflow commits there).

    # dry run against fixtures, no network:
    python3 scripts/ops/nightly.py --fixtures scripts/ops/tests/fixtures/healthy --out /tmp/report
    # real run (in the private ops repo's workflow):
    OPS_READ_TOKEN=... GITHUB_TOKEN=... python3 scripts/ops/nightly.py \\
        --metrics-url https://www.fynliq.com --repo Fynliq/fynliq-landing \\
        --ops-repo OWNER/fynq-ops --state state --out out --publish
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import milestones as ms
import report
import triggers
from opslib import ROOT, GitHub, env, fetch_metrics, load_yaml

LIVE_BRANCH = "feat/connect-ask-backend"


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# -------------------------------------------------------------- gathering

def gather_metrics(base_url: str, token: str, now: datetime) -> dict:
    out = {}
    windows = {
        "today": (now - timedelta(days=1), now, "none"),
        "yesterday": (now - timedelta(days=2), now - timedelta(days=1), "none"),
        "week": (now - timedelta(days=7), now, "none"),
        "week_by_source": (now - timedelta(days=7), now, "source"),
        "week_by_device": (now - timedelta(days=7), now, "device"),
    }
    for key, (since, until, segment) in windows.items():
        try:
            out[key] = fetch_metrics(base_url, token, iso(since), iso(until), segment)
        except Exception as exc:  # report what is missing instead of failing the whole night
            out[key] = None
            out.setdefault("errors", []).append(f"{key}: {type(exc).__name__}")
    return out


def _labels(item) -> list[str]:
    return [l["name"] if isinstance(l, dict) else str(l) for l in item.get("labels", [])]


def _ci_state(gh: GitHub, repo: str, sha: str) -> str:
    try:
        runs = gh.get(f"/repos/{repo}/commits/{sha}/check-runs", per_page=50).get("check_runs", [])
    except Exception:
        return "unknown"
    if not runs:
        return "none"
    if any(r.get("conclusion") in ("failure", "timed_out", "cancelled", "action_required") for r in runs):
        return "failure"
    if all(r.get("status") == "completed" and r.get("conclusion") in ("success", "skipped", "neutral") for r in runs):
        return "success"
    return "pending"


def gather_github(gh: GitHub, repo: str, ops_repo: str | None, now: datetime, autonomy: dict) -> dict:
    since = now - timedelta(days=1)
    data: dict = {"protected_branches": autonomy.get("protected_branches", [])}

    prs = gh.paged(f"/repos/{repo}/pulls", state="open")
    data["open_prs"] = [{"number": p["number"], "title": p["title"], "draft": p.get("draft", False),
                         "labels": _labels(p), "ci": _ci_state(gh, repo, p["head"]["sha"]),
                         "created_at": p["created_at"]} for p in prs]

    runs = gh.paged(f"/repos/{repo}/actions/runs", limit=200, created=f">={iso(since)}")
    data["ci_failures"] = [{"name": r["name"], "branch": r["head_branch"], "conclusion": r["conclusion"], "url": r["html_url"]}
                           for r in runs if r.get("conclusion") in ("failure", "timed_out") and r.get("name") != "Uptime"]
    uptime = [r for r in runs if r.get("name") == "Uptime" and r.get("event") == "schedule"]
    data["uptime"] = {"runs": len(uptime), "failures": sum(1 for r in uptime if r.get("conclusion") == "failure")}

    try:
        head = gh.get(f"/repos/{repo}/commits/{LIVE_BRANCH}")
        statuses = gh.get(f"/repos/{repo}/commits/{head['sha']}/statuses", per_page=50) or []
        vercel = next((s for s in statuses if "vercel" in (s.get("context") or "").lower()), None)
        state = vercel.get("state") if vercel else "unknown"
        data["deploy"] = {"sha": head["sha"], "state": state,
                          "summary": {"success": "✅ live build deployed", "failure": "❌ latest deploy FAILED",
                                      "error": "❌ latest deploy errored", "pending": "⏳ deploying"}.get(state, "unknown")}
    except Exception:
        data["deploy"] = {"sha": "?", "state": "unknown", "summary": "unknown (could not read deployment status)"}

    data["migration_files"] = sorted(str(p.relative_to(ROOT)) for p in (ROOT / "supabase" / "migrations").glob("*.sql"))

    agent_issues, created, closed = [], 0, 0
    for r in [repo] + ([ops_repo] if ops_repo else []):
        try:
            items = gh.paged(f"/repos/{r}/issues", state="all", since=iso(since - timedelta(days=30)))
        except Exception:
            continue
        for it in items:
            labels = _labels(it)
            if "pull_request" in it or not any(l.startswith("agent:") for l in labels):
                continue
            if it.get("created_at", "") >= iso(since):
                created += 1
            if it.get("state") == "closed" and (it.get("closed_at") or "") >= iso(since):
                closed += 1
            if it.get("state") == "open":
                agent_issues.append({"repo": r, "number": it["number"], "title": it["title"], "labels": labels})
    data["agent_issues_open"] = agent_issues
    data["agents"] = {
        "investigations_completed": closed,
        "issues_created": created,
        "prs_created": sum(1 for p in data["open_prs"] if "agent-authored" in p["labels"] and p["created_at"] >= iso(since)),
        "prs_awaiting_approval": sum(1 for p in data["open_prs"] if not p["draft"] and p["ci"] == "success"
                                     and ("agents-reviewed" in p["labels"] or "risk:green" in p["labels"])),
    }
    return data


# ------------------------------------------------------------------- run

def run(metrics: dict, github: dict, previous_state: dict, now: datetime) -> dict:
    today = metrics.get("today")
    milestone_result = ms.evaluate((today or {}).get("milestones") or {}, previous_state)
    fired = triggers.fire(today, github)
    pending = report.pending_migrations(github.get("migration_files", []), (today or {}).get("applied_migrations"))
    date = now.astimezone(timezone.utc).strftime("%Y-%m-%d")
    ceo = report.build_ceo_report(today, metrics.get("yesterday"), metrics.get("week"), github, milestone_result,
                                  fired, pending, date)
    eng = report.build_engineering_report(today, metrics.get("yesterday"), github, milestone_result, fired, pending, date)
    if metrics.get("errors"):
        eng += "\n## Data gaps\n" + "\n".join(f"- metrics {e}" for e in metrics["errors"]) + "\n"
    snapshot = {  # aggregates only, for the private ops repo's history
        "date": date,
        "headline": report.headline_numbers(today),
        "fired": [f["event"] for f in fired],
        "milestones_reached": sorted(milestone_result["state"]["reached"]),
    }
    return {"date": date, "ceo": ceo, "engineering": eng, "fired": fired, "milestones": milestone_result,
            "pending_migrations": pending, "snapshot": snapshot}


def ensure_private(gh: GitHub, ops_repo: str, public_repo: str) -> None:
    """Business numbers may only go to a private repository that is not the app repo."""
    if ops_repo.lower() == public_repo.lower():
        raise SystemExit("Refusing to publish reports to the public app repository.")
    info = gh.get(f"/repos/{ops_repo}")
    if not info or info.get("private") is not True:
        raise SystemExit(f"Refusing to publish: {ops_repo} is not a private repository.")


def publish(gh: GitHub, ops_repo: str, result: dict) -> None:
    """Issues in the PRIVATE ops repo only. Idempotent per day / per trigger."""
    date = result["date"]
    open_issues = gh.paged(f"/repos/{ops_repo}/issues", state="open")

    def upsert(title: str, body: str, labels: list[str]):
        existing = next((i for i in open_issues if i["title"] == title and "pull_request" not in i), None)
        if existing:
            gh.request("POST", f"/repos/{ops_repo}/issues/{existing['number']}/comments", {"body": body})
        else:
            gh.request("POST", f"/repos/{ops_repo}/issues", {"title": title, "body": body, "labels": labels})

    for old in open_issues:  # yesterday's reports are superseded
        if any(l.get("name") in ("report:ceo", "report:engineering") for l in old.get("labels", [])) and date not in old["title"]:
            gh.request("PATCH", f"/repos/{ops_repo}/issues/{old['number']}", {"state": "closed"})
    upsert(f"FYNQ morning report — {date}", result["ceo"], ["report:ceo"])
    upsert(f"FYNQ engineering report — {date}", result["engineering"], ["report:engineering"])
    for f in result["fired"]:
        upsert(f"[trigger] {f['event']}", f"{f['summary']}\n\n_Detected by the nightly run on {date}. Agents: "
               + ", ".join(f["agents"]) + ". Investigate read-only; propose fixes as PRs; never change production._",
               ["trigger"] + [f"agent:{a.removesuffix('-agent')}" for a in f["agents"]])
    for mid in result["milestones"]["newly_reached"]:
        m = next(x for x in result["milestones"]["milestones"] if x["id"] == mid)
        upsert(f"Milestone reached: {mid}",
               f"Activated analyses: {', '.join(m['analyses_activated']) or 'none'}\n"
               f"Agents activated: {', '.join(m['agents_activated']) or 'none'}\n\n"
               f"**Human acknowledgement needed:** {m['human_approval']}\n\n"
               "_Nothing was deployed or changed in production. Close this issue to acknowledge._",
               ["milestone", "ceo-action"])


def load_fixtures(folder: Path) -> tuple[dict, dict]:
    def read(name):
        p = folder / name
        return json.loads(p.read_text()) if p.exists() else None
    metrics = {k: read(f"metrics_{k}.json") for k in ("today", "yesterday", "week")}
    github = read("github.json") or {}
    github.setdefault("migration_files", sorted(str(p.relative_to(ROOT)) for p in (ROOT / "supabase" / "migrations").glob("*.sql")))
    return metrics, github


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fixtures", help="folder of fixture JSON (dry run, no network)")
    ap.add_argument("--metrics-url", default=env("FYNQ_METRICS_URL", "https://www.fynliq.com"))
    ap.add_argument("--repo", default="Fynliq/fynliq-landing")
    ap.add_argument("--ops-repo")
    ap.add_argument("--state", help="folder for state/milestones.json and snapshots")
    ap.add_argument("--out", required=True)
    ap.add_argument("--publish", action="store_true", help="post issues to --ops-repo")
    ap.add_argument("--now", help="ISO time override (tests)")
    args = ap.parse_args(argv)

    now = datetime.fromisoformat(args.now.replace("Z", "+00:00")) if args.now else datetime.now(timezone.utc)
    state_dir = Path(args.state) if args.state else None
    previous = {}
    if state_dir and (state_dir / "milestones.json").exists():
        previous = json.loads((state_dir / "milestones.json").read_text())

    if args.fixtures:
        metrics, github = load_fixtures(Path(args.fixtures))
    else:
        token = env("OPS_READ_TOKEN")
        if not token:
            print("OPS_READ_TOKEN is not set", file=sys.stderr)
            return 2
        gh = GitHub(env("GITHUB_TOKEN"))
        metrics = gather_metrics(args.metrics_url, token, now)
        github = gather_github(gh, args.repo, args.ops_repo, now, load_yaml("ops/autonomy.yaml"))

    result = run(metrics, github, previous, now)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "ceo-report.md").write_text(result["ceo"], encoding="utf-8")
    (out / "engineering-report.md").write_text(result["engineering"], encoding="utf-8")
    (out / "result.json").write_text(json.dumps({k: result[k] for k in ("date", "fired", "milestones", "pending_migrations", "snapshot")},
                                                indent=2, default=str), encoding="utf-8")
    if state_dir:
        (state_dir / "snapshots").mkdir(parents=True, exist_ok=True)
        (state_dir / "milestones.json").write_text(json.dumps(result["milestones"]["state"], indent=2), encoding="utf-8")
        (state_dir / "snapshots" / f"{result['date']}.json").write_text(json.dumps(result["snapshot"], indent=2, default=str), encoding="utf-8")
    if args.publish:
        if args.fixtures or not args.ops_repo:
            print("--publish needs --ops-repo and real data", file=sys.stderr)
            return 2
        gh = GitHub(env("GITHUB_TOKEN"))
        ensure_private(gh, args.ops_repo, args.repo)
        publish(gh, args.ops_repo, result)
    print(result["ceo"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
