#!/usr/bin/env python3
"""Hourly production health check (runs in the PRIVATE ops repo).

Reads the last hour of aggregates from the read-only metrics view, evaluates
the event triggers in ops/agent-triggers.yaml, and opens or updates one issue
per fired trigger in the ops repo, labelled with the agents to wake. A
payment webhook failure therefore reaches payments-agent within the hour, and
GitHub notifies the owner immediately. Read-only towards production.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone

import triggers
from nightly import ensure_private, iso
from opslib import GitHub, env, fetch_metrics


def check(metrics: dict | None) -> list[dict]:
    # Hourly: production signals only. CI/deploy/uptime facts belong to the nightly run.
    return [f for f in triggers.fire(metrics, {}) if f["event"] not in ("ci_failed", "deployment_failed", "uptime_failed")]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--metrics-url", default=env("FYNQ_METRICS_URL", "https://www.fynliq.com"))
    ap.add_argument("--repo", default="Fynliq/fynliq-landing")
    ap.add_argument("--ops-repo")
    ap.add_argument("--fixture", help="metrics JSON file (dry run)")
    ap.add_argument("--publish", action="store_true")
    args = ap.parse_args(argv)
    now = datetime.now(timezone.utc)
    if args.fixture:
        metrics = json.load(open(args.fixture, encoding="utf-8"))
    else:
        token = env("OPS_READ_TOKEN")
        if not token:
            print("OPS_READ_TOKEN is not set", file=sys.stderr)
            return 2
        metrics = fetch_metrics(args.metrics_url, token, iso(now - timedelta(hours=1)), iso(now))
    fired = check(metrics)
    print(json.dumps(fired, indent=2))
    if args.publish and fired:
        gh = GitHub(env("GITHUB_TOKEN"))
        ensure_private(gh, args.ops_repo, args.repo)
        open_issues = gh.paged(f"/repos/{args.ops_repo}/issues", state="open")
        for f in fired:
            title = f"[trigger] {f['event']}"
            body = f"{f['summary']} (hour ending {iso(now)})"
            existing = next((i for i in open_issues if i["title"] == title), None)
            if existing:
                gh.request("POST", f"/repos/{args.ops_repo}/issues/{existing['number']}/comments", {"body": body})
            else:
                gh.request("POST", f"/repos/{args.ops_repo}/issues", {
                    "title": title, "body": body + "\n\n_Investigate read-only; propose fixes as PRs; never change production._",
                    "labels": ["trigger"] + [f"agent:{a.removesuffix('-agent')}" for a in f["agents"]]})
    return 0


if __name__ == "__main__":
    sys.exit(main())
