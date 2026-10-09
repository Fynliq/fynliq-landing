"""Builds the CEO morning report and the engineering report from data.

Pure functions over plain dicts, so they are tested with fixtures. The two
reports are deliberately different: the CEO report is short and in plain
English; the engineering report lists the work, failures and risks.
"""
from __future__ import annotations

from typing import Any

MONEY_EVENTS_NOTE = "Payments and revenue come from the billing tables the verified Stripe webhook writes."


def _funnel(metrics: dict | None) -> dict:
    rows = (metrics or {}).get("funnel") or []
    return rows[0] if rows else {}


def _n(value) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def fmt_int(value) -> str:
    v = _n(value)
    return "n/a" if v is None else f"{int(round(v)):,}"


def fmt_pct(value) -> str:
    v = _n(value)
    return "n/a" if v is None else f"{v * 100:.1f}%"


def fmt_money(cents) -> str:
    v = _n(cents)
    return "n/a" if v is None else f"${v / 100:,.2f}"


def fmt_ms(value) -> str:
    v = _n(value)
    return "n/a" if v is None else (f"{v / 1000:.1f}s" if v >= 1000 else f"{int(v)}ms")


def delta(today, yesterday) -> str:
    t, y = _n(today), _n(yesterday)
    if t is None or y is None:
        return ""
    diff = t - y
    if diff == 0:
        return " (=)"
    return f" ({'+' if diff > 0 else ''}{int(diff) if float(diff).is_integer() else round(diff, 2)})"


def rate(num, den):
    n, d = _n(num), _n(den)
    return None if n is None or not d else n / d


# ---------------------------------------------------------------- summaries

def headline_numbers(metrics: dict | None) -> dict:
    f, rev, health = _funnel(metrics), (metrics or {}).get("revenue") or {}, (metrics or {}).get("health") or {}
    return {
        "visitors": f.get("visitors"),
        "accounts": f.get("signups"),
        "uploaders": f.get("uploaders"),
        "analyses": f.get("analyses"),
        "returning": f.get("returning_users"),
        "checkout_starts": rev.get("checkout_starters", f.get("checkout_starters")),
        "payments": rev.get("payments"),
        "revenue_cents": rev.get("revenue_cents"),
        "visitor_to_paid": rate(rev.get("payers"), f.get("visitors")),
        "checkout_to_paid": rate(rev.get("payers"), rev.get("checkout_starters")),
        "errors": health.get("errors_5xx"),
        "ai_failures": (health.get("ai") or {}).get("failed"),
        "payment_failures": (rev.get("payment_failures") or 0) + (rev.get("webhook_problems") or 0) if rev else None,
        "auth_failures": health.get("auth_failures"),
        "p95_ms": health.get("p95_ms"),
        "frontend_errors": health.get("frontend_errors"),
    }


LABELS = {
    "visitors": "visitors", "accounts": "new accounts", "uploaders": "unique uploaders", "analyses": "successful analyses",
    "payments": "payments", "revenue_cents": "revenue", "errors": "server errors", "ai_failures": "AI failures",
}


def biggest_change(today: dict, yesterday: dict) -> str:
    best, best_score = None, 0.0
    for key, label in LABELS.items():
        t, y = _n(today.get(key)), _n(yesterday.get(key))
        if t is None or y is None or (t < 3 and y < 3 and key != "payments"):
            continue
        if t == y:
            continue
        score = abs(t - y) / max(y, 1.0)
        if score > best_score:
            best, best_score = (label, t, y, key), score
    if not best:
        return "No meaningful change since yesterday (numbers are small or flat)."
    label, t, y, key = best
    show = (lambda v: fmt_money(v)) if key == "revenue_cents" else (lambda v: fmt_int(v))
    direction = "up" if t > y else "down"
    return f"{label.capitalize()} {direction}: {show(t)} vs {show(y)} the day before."


def biggest_problem(today_metrics: dict | None, github: dict, fired: list[dict]) -> str:
    order = ["webhook_failure", "uptime_failed", "deployment_failed", "error_spike", "ai_failure_spike",
             "ci_failed", "auth_failure_spike", "frontend_error_spike"]
    by_name = {f["event"]: f for f in fired}
    for name in order:
        if name in by_name:
            return by_name[name]["summary"]
    if not today_metrics:
        return "The metrics view could not be read, so tonight's numbers are missing."
    return "No production problems detected in the last 24 hours."


FUNNEL_STEPS = [
    ("visitors", "signups", "visitors who create an account"),
    ("signups", "uploaders", "new accounts that upload a document"),
    ("uploaders", "result_viewers", "uploaders who see their results"),
    ("result_viewers", "checkout_starters", "people who see results and start checkout"),
    ("checkout_starters", "payers", "checkouts that end in payment"),
]


def biggest_opportunity(week_metrics: dict | None) -> str:
    f = _funnel(week_metrics)
    worst = None
    for a, b, words in FUNNEL_STEPS:
        top, bottom = _n(f.get(a)), _n(f.get(b))
        if not top or top < 5 or bottom is None:
            continue
        r = bottom / top
        if worst is None or r < worst[0]:
            worst = (r, a, b, words, top, bottom)
    if not worst:
        return "Not enough traffic yet to find a reliable bottleneck (needs 5+ people at a step over 7 days)."
    r, _, _, words, top, bottom = worst
    return (f"The weakest step this week: only {int(bottom)} of {int(top)} {words} ({r:.0%}). "
            "That is where an improvement would pay off most. (Measurement only: no changes are made automatically.)")


def ceo_action(github: dict, milestones: dict, fired: list[dict], pending_migrations: list[str]) -> list[str]:
    reasons = []
    red = [p for p in github.get("open_prs", []) if "risk:red" in p.get("labels", []) and not p.get("draft")]
    ready = [p for p in red if p.get("ci") == "success"]
    if ready:
        reasons.append(f"{len(ready)} high-risk PR(s) passed checks and are waiting for your approval: "
                       + ", ".join(f"#{p['number']} {p['title']}" for p in ready[:3]) + ".")
    for mid in milestones.get("newly_reached", []):
        m = next((x for x in milestones.get("milestones", []) if x["id"] == mid), {})
        reasons.append(f"Milestone reached: {mid}. To acknowledge: {m.get('human_approval', '')}")
    if any(f["event"] in ("webhook_failure", "uptime_failed", "deployment_failed") for f in fired):
        reasons.append("A production problem needs a decision (see Biggest current problem).")
    if pending_migrations:
        reasons.append(f"{len(pending_migrations)} database migration(s) are merged but not applied in production: "
                       + ", ".join(pending_migrations[:3]) + ". Only you can apply them.")
    return reasons


def build_ceo_report(today: dict | None, yesterday: dict | None, week: dict | None, github: dict, milestones: dict,
                     fired: list[dict], pending_migrations: list[str], date: str) -> str:
    t, y = headline_numbers(today), headline_numbers(yesterday)
    agents = github.get("agents", {})
    deploy = github.get("deploy", {})
    actions = ceo_action(github, milestones, fired, pending_migrations)
    progress = [f"- {m['id']}: {'✅ reached' if m['reached'] else m['progress']}" for m in milestones.get("milestones", [])]
    lines = [
        f"# FYNQ — MORNING REPORT ({date})",
        "",
        "## Growth",
        f"New visitors: {fmt_int(t['visitors'])}{delta(t['visitors'], y['visitors'])}",
        f"New accounts: {fmt_int(t['accounts'])}{delta(t['accounts'], y['accounts'])}",
        f"Unique uploaders: {fmt_int(t['uploaders'])}{delta(t['uploaders'], y['uploaders'])}",
        f"Successful analyses: {fmt_int(t['analyses'])}{delta(t['analyses'], y['analyses'])}",
        f"Returning users: {fmt_int(t['returning'])}{delta(t['returning'], y['returning'])}",
        "",
        "## Revenue",
        f"Checkout starts: {fmt_int(t['checkout_starts'])}{delta(t['checkout_starts'], y['checkout_starts'])}",
        f"Successful payments: {fmt_int(t['payments'])}{delta(t['payments'], y['payments'])}",
        f"Revenue: {fmt_money(t['revenue_cents'])}",
        f"Visitor → paid: {fmt_pct(t['visitor_to_paid'])}",
        f"Checkout → paid: {fmt_pct(t['checkout_to_paid'])}",
        "",
        "## Product Health",
        f"Errors: {fmt_int(t['errors'])} server, {fmt_int(t['frontend_errors'])} browser",
        f"AI failures: {fmt_int(t['ai_failures'])}",
        f"Payment failures: {fmt_int(t['payment_failures'])}",
        f"Auth failures: {fmt_int(t['auth_failures'])}",
        f"p95 latency: {fmt_ms(t['p95_ms'])}",
        f"Deployment status: {deploy.get('summary', 'unknown')}",
        "",
        "## Agents",
        f"Investigations completed: {agents.get('investigations_completed', 0)}",
        f"Issues created: {agents.get('issues_created', 0)}",
        f"PRs created: {agents.get('prs_created', 0)}",
        f"PRs awaiting approval: {agents.get('prs_awaiting_approval', 0)}",
        "",
        f"**Biggest change since yesterday:** {biggest_change(t, y)}",
        "",
        f"**Biggest current problem:** {biggest_problem(today, github, fired)}",
        "",
        f"**Highest-value opportunity:** {biggest_opportunity(week)}",
        "",
        "**Milestone progress:**",
        *progress,
        "",
        f"**CEO action required: {'YES' if actions else 'NO'}**",
        *[f"- {a}" for a in actions],
        "",
        f"_Last 24h vs the 24h before, UTC. {MONEY_EVENTS_NOTE} Admin/test accounts and Stripe test mode excluded._",
    ]
    if today is None:
        lines.insert(2, "> ⚠️ The metrics view could not be reached; numbers below are missing. See the engineering report.")
    return "\n".join(lines) + "\n"


# ------------------------------------------------------------- engineering

# Applied in production before migration tracking existed (see ops/runbooks/database.md).
APPLIED_BEFORE_TRACKING = {"closed_beta"}


def pending_migrations(repo_files: list[str], applied: list[str] | None) -> list[str]:
    """Repo migration files with no matching applied name in production.

    Production names were sometimes chosen by hand (for example
    "account_sessions_stay_logged_in" for 202609210002_stay_logged_in.sql), so a
    file counts as applied when either name contains the other.
    """
    if applied is None:
        return []
    applied_names = [a.lower() for a in applied]
    out = []
    for f in sorted(repo_files):
        base = f.rsplit("/", 1)[-1].removesuffix(".sql")
        name = (base.split("_", 1)[1] if "_" in base else base).lower()
        if name in APPLIED_BEFORE_TRACKING:
            continue
        if not any(name in a or a in name for a in applied_names):
            out.append(base)
    return out


def build_engineering_report(today: dict | None, yesterday: dict | None, github: dict, milestones: dict,
                             fired: list[dict], pending: list[str], date: str) -> str:
    health = (today or {}).get("health") or {}
    prev = (yesterday or {}).get("health") or {}
    rev = (today or {}).get("revenue") or {}
    lines = [f"# FYNQ — Engineering report ({date})", ""]

    lines += ["## Triggers fired (last 24h)"]
    lines += [f"- **{f['event']}** → {', '.join(f['agents'])}: {f['summary']}" for f in fired] or ["- none"]

    lines += ["", "## Open agent work"]
    work = github.get("agent_issues_open", [])
    lines += [f"- {w['repo']}#{w['number']} {w['title']} ({', '.join(w['labels'])})" for w in work[:20]] or ["- none"]

    lines += ["", "## Failed tests / CI (last 24h)"]
    lines += [f"- {r['name']} on `{r['branch']}` ({r['conclusion']}): {r['url']}" for r in github.get("ci_failures", [])[:15]] or ["- none"]

    lines += ["", "## Security findings"]
    sec = [w for w in work if any(l in ("agent:security", "security") for l in w["labels"])]
    lines += [f"- {w['repo']}#{w['number']} {w['title']}" for w in sec] or ["- none open"]
    if any(f["event"] == "auth_failure_spike" for f in fired):
        lines.append("- Auth failure spike detected (see triggers).")

    lines += ["", "## Pending migrations"]
    lines += [f"- `{m}` is in the repo but not applied in production" for m in pending] or [
        "- none" if (today or {}).get("applied_migrations") is not None else "- unknown (metrics view unavailable)"]

    lines += ["", "## Payment concerns"]
    concerns = []
    if rev.get("webhook_problems"):
        concerns.append(f"{rev['webhook_problems']} webhook event(s) with a problem outcome: {rev.get('webhook_outcomes')}")
    if rev.get("duplicate_payments"):
        concerns.append(f"{rev['duplicate_payments']} duplicate payment(s) — review for refund (human decision)")
    events_paid = _funnel(today).get("payers")
    if _n(events_paid) is not None and _n(rev.get("payers")) is not None and events_paid != rev.get("payers"):
        concerns.append(f"Analytics shows {events_paid} payer(s) but billing tables show {rev.get('payers')}: reconcile")
    lines += [f"- {c}" for c in concerns] or ["- none"]

    lines += ["", "## Deployment"]
    deploy = github.get("deploy", {})
    lines.append(f"- Live branch head `{deploy.get('sha', '?')[:7]}`: {deploy.get('summary', 'unknown')}")
    up = github.get("uptime", {})
    lines.append(f"- Uptime checks (24h): {up.get('runs', 0)} runs, {up.get('failures', 0)} failed")

    lines += ["", "## Performance"]
    lines.append(f"- API p50 {fmt_ms(health.get('p50_ms'))}, p95 {fmt_ms(health.get('p95_ms'))} "
                 f"(yesterday p95 {fmt_ms(prev.get('p95_ms'))}); error rate {fmt_pct(health.get('error_rate'))}; "
                 f"DB errors {fmt_int(health.get('db_errors'))}")
    ai = health.get("ai") or {}
    lines.append(f"- AI reader: {fmt_int(ai.get('completed'))} ok / {fmt_int(ai.get('failed'))} failed, "
                 f"p50 {fmt_ms(ai.get('p50_ms'))}, p95 {fmt_ms(ai.get('p95_ms'))}")
    t95, y95 = _n(health.get("p95_ms")), _n(prev.get("p95_ms"))
    if t95 and y95 and t95 > 1.5 * y95 and t95 > 500:
        lines.append(f"- ⚠️ p95 regression: {fmt_ms(t95)} vs {fmt_ms(y95)}")
    slow = sorted(health.get("routes") or [], key=lambda r: -(_n(r.get("p95_ms")) or 0))[:5]
    lines += [f"  - `{r['route']}` p95 {fmt_ms(r.get('p95_ms'))}, {r.get('requests')} req, {r.get('errors_5xx')} 5xx" for r in slow]

    lines += ["", "## Open PRs by risk"]
    prs = github.get("open_prs", [])
    lines += [f"- #{p['number']} [{next((l.split(':')[1].upper() for l in p['labels'] if l.startswith('risk:')), 'UNROUTED')}] "
              f"{p['title']} — CI {p.get('ci', 'unknown')}{' (draft)' if p.get('draft') else ''}" for p in prs] or ["- none"]

    lines += ["", "## Milestones"]
    lines += [f"- {m['id']}: {'reached' if m['reached'] else 'not yet'} — {m['progress']}" for m in milestones.get("milestones", [])]
    if milestones.get("active_analyses"):
        lines.append(f"- Active analyses: {', '.join(milestones['active_analyses'])}")
    return "\n".join(lines) + "\n"
