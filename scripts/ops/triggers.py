"""Decides which production event triggers fired (ops/agent-triggers.yaml).

fire() is pure: metrics + GitHub facts in, a list of fired triggers out. Each
fired trigger names the agents to wake and a one-line plain-English summary.
"""
from __future__ import annotations

from opslib import load_yaml


def _n(value):
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def fire(metrics: dict | None, github: dict, config: dict | None = None) -> list[dict]:
    config = config if config is not None else load_yaml("ops/agent-triggers.yaml")
    events = config.get("events", {})
    health = (metrics or {}).get("health") or {}
    revenue = (metrics or {}).get("revenue") or {}
    fired: list[dict] = []

    def add(name: str, summary: str):
        spec = events.get(name)
        if spec:
            fired.append({"event": name, "agents": spec.get("agents", []), "summary": summary})

    ci = [r for r in github.get("ci_failures", []) if r.get("branch") in github.get("protected_branches", [])]
    if ci:
        add("ci_failed", f"CI failed {len(ci)} time(s) on a protected branch ({ci[0]['branch']}).")
    if github.get("deploy", {}).get("state") in ("failure", "error"):
        add("deployment_failed", "The latest Vercel deployment of the live branch failed; the site may be on an older build.")
    up = github.get("uptime", {})
    if up.get("failures"):
        add("uptime_failed", f"{up['failures']} of {up.get('runs', 0)} uptime checks failed in the last 24 hours.")

    when = events.get("error_spike", {}).get("when", {})
    requests, rate = _n(health.get("requests")), _n(health.get("error_rate"))
    if requests is not None and rate is not None and requests >= when.get("min_requests", 50) and rate >= when.get("error_rate_at_least", 0.05):
        add("error_spike", f"{rate:.1%} of {int(requests)} API requests failed with a server error.")

    when = events.get("frontend_error_spike", {}).get("when", {})
    fe = _n(health.get("frontend_errors"))
    if fe is not None and fe >= when.get("frontend_errors_at_least", 20):
        add("frontend_error_spike", f"{int(fe)} uncaught browser errors.")

    when = events.get("webhook_failure", {}).get("when", {})
    problems = (_n(revenue.get("webhook_problems")) or 0) + (_n(health.get("webhook_failures")) or 0)
    if problems >= when.get("webhook_problems_at_least", 1):
        add("webhook_failure", f"{int(problems)} Stripe webhook problem(s): payments may not have unlocked accounts.")

    when = events.get("ai_failure_spike", {}).get("when", {})
    ai = health.get("ai") or {}
    total = (_n(ai.get("completed")) or 0) + (_n(ai.get("failed")) or 0)
    sr = _n(ai.get("success_rate"))
    if sr is not None and total >= when.get("min_analyses", 10) and sr < when.get("ai_success_rate_below", 0.8):
        add("ai_failure_spike", f"The document reader succeeded only {sr:.0%} of {int(total)} times.")

    when = events.get("auth_failure_spike", {}).get("when", {})
    af = _n(health.get("auth_failures"))
    if af is not None and af >= when.get("auth_failures_at_least", 50):
        add("auth_failure_spike", f"{int(af)} failed log-ins (possible credential stuffing).")
    return fired
