#!/usr/bin/env python3
"""Evaluates ops/milestones.yaml against authoritative metrics.

Pure functions: evaluate() takes the metrics dict (ops_milestone_metrics) and
the previously reached state, and returns what is reached now and what is new.
Activation means "report it and open an issue for the human" -- never a deploy
or a production change.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from opslib import load_yaml

KNOWN_METRICS = {
    "registered_users", "unique_successful_uploaders", "qualified_sessions", "successful_non_test_payments",
    "visitors_last_24h", "visitors_daily_avg_7d", "api_requests_24h", "rate_limited_share_24h",
    "events_last_seen", "api_requests_last_seen",
}


def _ts(value) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _num(metrics: dict, name: str) -> float | None:
    value = metrics.get(name)
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def check(trigger: dict, metrics: dict, now: datetime) -> tuple[bool, str]:
    """Returns (met, human-readable progress)."""
    if "all" in trigger or "any" in trigger:
        parts = [check(t, metrics, now) for t in trigger.get("all", trigger.get("any", []))]
        met = all(p[0] for p in parts) if "all" in trigger else any(p[0] for p in parts)
        return met, "; ".join(p[1] for p in parts)
    if "events_seen" in trigger:
        seen = metrics.get("events_last_seen") or {}
        cutoff = now - timedelta(days=int(trigger.get("within_days", 7)))
        missing = [e for e in trigger["events_seen"] if not (_ts(seen.get(e)) and _ts(seen.get(e)) >= cutoff)]
        total = len(trigger["events_seen"])
        return not missing, f"{total - len(missing)}/{total} journey events seen" + (f" (missing: {', '.join(missing)})" if missing else "")
    if "seen_within_hours" in trigger:
        ts = _ts(metrics.get(trigger["seen_within_hours"]))
        ok = bool(ts and ts >= now - timedelta(hours=int(trigger.get("hours", 24))))
        return ok, f"{trigger['seen_within_hours']}: {'recent' if ok else 'not seen recently'}"
    name = trigger.get("metric")
    value = _num(metrics, name)
    target = float(trigger.get("at_least", 0))
    if value is None:
        return False, f"{name}: no data"
    if "ratio_to" in trigger:
        base = _num(metrics, trigger["ratio_to"]) or 0.0
        ratio = value / base if base > 0 else 0.0
        ok = ratio >= target and value >= float(trigger.get("min", 0))
        return ok, f"{name} {value:g} = {ratio:.1f}x {trigger['ratio_to']} (needs {target:g}x and {trigger.get('min', 0)}+)"
    pretty = f"{value:g}" if value >= 1 or value == 0 else f"{value:.2%}"
    goal = f"{target:g}" if target >= 1 else f"{target:.0%}"
    return value >= target, f"{name} {pretty}/{goal}"


def evaluate(metrics: dict, previous: dict | None = None, definitions: dict | None = None, now: datetime | None = None) -> dict:
    definitions = definitions if definitions is not None else load_yaml("ops/milestones.yaml")
    now = now or datetime.now(timezone.utc)
    previous = previous or {}
    reached_before = previous.get("reached", {})
    results = []
    for m in definitions.get("milestones", []):
        met, progress = check(m["trigger"], metrics or {}, now)
        sticky = m["id"] in reached_before and m["id"] != "high_traffic_mode"  # traffic mode can switch off
        results.append({
            "id": m["id"],
            "reached": met or sticky,
            "newly_reached": met and m["id"] not in reached_before,
            "progress": progress,
            "analyses_activated": m.get("analyses_activated", []) if (met or sticky) else [],
            "agents_activated": m.get("agents_activated", []) if (met or sticky) else [],
            "human_approval": m.get("human_approval"),
        })
    reached = {r["id"]: reached_before.get(r["id"], now.isoformat()) for r in results if r["reached"]}
    return {
        "evaluated_at": now.isoformat(),
        "milestones": results,
        "newly_reached": [r["id"] for r in results if r["newly_reached"]],
        "active_analyses": sorted({a for r in results for a in r["analyses_activated"]}),
        "state": {"reached": reached},
    }


def validate_definitions(definitions: dict) -> list[str]:
    """Problems with trigger syntax or unknown metric names (used by validate_ops.py)."""
    problems: list[str] = []

    def walk(trigger, where):
        if not isinstance(trigger, dict):
            problems.append(f"{where}: trigger must be a mapping")
            return
        if "all" in trigger or "any" in trigger:
            for i, t in enumerate(trigger.get("all", trigger.get("any", []))):
                walk(t, f"{where}[{i}]")
        elif "events_seen" in trigger:
            if not isinstance(trigger["events_seen"], list) or not trigger["events_seen"]:
                problems.append(f"{where}: events_seen must be a non-empty list")
        elif "seen_within_hours" in trigger:
            if trigger["seen_within_hours"] not in KNOWN_METRICS:
                problems.append(f"{where}: unknown metric {trigger['seen_within_hours']}")
        elif "metric" in trigger:
            if trigger["metric"] not in KNOWN_METRICS:
                problems.append(f"{where}: unknown metric {trigger['metric']}")
            if "ratio_to" in trigger and trigger["ratio_to"] not in KNOWN_METRICS:
                problems.append(f"{where}: unknown metric {trigger['ratio_to']}")
            if not isinstance(trigger.get("at_least"), (int, float)):
                problems.append(f"{where}: at_least must be a number")
        else:
            problems.append(f"{where}: unknown trigger form")

    for m in definitions.get("milestones", []):
        walk(m.get("trigger"), f"milestones.yaml: {m.get('id')}")
    return problems
