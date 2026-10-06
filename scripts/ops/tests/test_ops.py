"""Tests for the FYNQ ops tooling. Standard library + PyYAML; no network.

    python3 -m unittest discover -s scripts/ops/tests -t scripts/ops
"""
from __future__ import annotations

import copy
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import health_check  # noqa: E402
import milestones as ms  # noqa: E402
import nightly  # noqa: E402
import report  # noqa: E402
import route_pr  # noqa: E402
import triggers  # noqa: E402
from opslib import GitHub, fetch_metrics, load_yaml, path_matches  # noqa: E402

FIX = HERE / "fixtures"
NOW = datetime(2026, 10, 8, 10, 30, tzinfo=timezone.utc)


def fixture(name: str, file: str) -> dict:
    return json.loads((FIX / name / file).read_text())


class RecordingGitHub(GitHub):
    """Records calls; answers reads from a dict. Fails the test on unexpected writes."""

    def __init__(self, reads: dict, allow_writes: bool = False):
        super().__init__("token")
        self.reads, self.calls, self.allow_writes = reads, [], allow_writes

    def request(self, method, path, body=None, params=None):
        self.calls.append((method, path, body))
        if method != "GET" and not self.allow_writes:
            raise AssertionError(f"unexpected write {method} {path}")
        for prefix, value in self.reads.items():
            if path.startswith(prefix):
                return copy.deepcopy(value)
        return [] if method == "GET" else {}


class GlobTests(unittest.TestCase):
    def test_globs(self):
        cases = [("src/billing/__tests__/client.test.ts", "**/__tests__/**", True),
                 ("server/billing.test.js", "**/*.test.*", True), ("docs/a/b.md", "docs/**", True),
                 ("serverx/beta.js", "server/**", False), ("src/a/b.ts", "src/*", False)]
        for path, pattern, expected in cases:
            self.assertEqual(path_matches(path, pattern), expected, (path, pattern))


class RoutePrTests(unittest.TestCase):
    def test_docs_only_is_green_without_qa(self):
        r = route_pr.plan(["docs/analytics-events.md", "README.md"])
        self.assertEqual(r["risk"], "GREEN")
        self.assertIn("code-review-agent", r["agents"])
        self.assertNotIn("qa-agent", r["agents"])

    def test_frontend_routes_frontend_and_qa(self):
        r = route_pr.plan(["src/components/Hero/Hero.tsx"])
        self.assertEqual(r["risk"], "YELLOW")
        for a in ("frontend-agent", "qa-agent", "code-review-agent", "release-agent"):
            self.assertIn(a, r["agents"])
        self.assertNotIn("security-agent", r["agents"])

    def test_payments_routes_payments_security_qa(self):
        r = route_pr.plan(["api/stripe-webhook.js"])
        self.assertEqual(r["risk"], "RED")
        for a in ("payments-agent", "security-agent", "qa-agent"):
            self.assertIn(a, r["agents"])

    def test_migration_routes_supabase_security_qa(self):
        r = route_pr.plan(["supabase/migrations/202611010001_x.sql"])
        self.assertEqual(r["risk"], "RED")
        for a in ("supabase-agent", "security-agent", "qa-agent"):
            self.assertIn(a, r["agents"])

    def test_auth_and_secrets_get_security(self):
        for f in ("server/account-login.js", ".env.example", "vercel.json", "src/auth/token.ts"):
            self.assertIn("security-agent", route_pr.plan([f])["agents"], f)

    def test_weakening_a_guard_test_is_red(self):
        self.assertEqual(route_pr.plan(["test/billing-integration.mjs"])["risk"], "RED")

    def test_unknown_paths_use_default_class(self):
        self.assertEqual(route_pr.plan(["something/new.txt"])["risk"], "YELLOW")

    def test_comment_never_claims_to_merge(self):
        body = route_pr.comment_for(route_pr.plan(["api/billing.js"]))
        self.assertIn(route_pr.MARKER, body)
        self.assertIn("nothing here merges or deploys", body)

    def test_apply_only_labels_and_comments(self):
        gh = RecordingGitHub({"/repos/o/r/issues/5/labels": [{"name": "risk:yellow"}], "/repos/o/r/issues/5/comments": []},
                             allow_writes=True)
        route_pr.apply(gh, "o/r", 5, route_pr.plan(["api/billing.js"]))
        writes = [(m, p) for m, p, _ in gh.calls if m != "GET"]
        self.assertTrue(all("/issues/5/" in p for _, p in writes), writes)
        self.assertFalse(any("merge" in p or "/pulls/" in p for _, p in writes))
        self.assertIn(("DELETE", "/repos/o/r/issues/5/labels/risk%3Ayellow"), writes)


class MilestoneTests(unittest.TestCase):
    def metrics(self, **over):
        m = fixture("healthy", "metrics_today.json")["milestones"]
        m.update(over)
        return m

    def test_definitions_are_valid(self):
        self.assertEqual(ms.validate_definitions(load_yaml("ops/milestones.yaml")), [])

    def test_thresholds(self):
        r = ms.evaluate(self.metrics(registered_users=24, unique_successful_uploaders=9), now=NOW)
        reached = {m["id"] for m in r["milestones"] if m["reached"]}
        self.assertNotIn("25_registered_users", reached)
        self.assertNotIn("10_unique_uploaders", reached)
        r = ms.evaluate(self.metrics(registered_users=25, unique_successful_uploaders=10), now=NOW)
        reached = {m["id"] for m in r["milestones"] if m["reached"]}
        self.assertIn("25_registered_users", reached)
        self.assertIn("10_unique_uploaders", reached)
        self.assertIn("daily_funnel_analysis", r["active_analyses"])

    def test_newly_reached_only_once(self):
        first = ms.evaluate(self.metrics(), now=NOW)
        self.assertIn("25_registered_users", first["newly_reached"])
        second = ms.evaluate(self.metrics(), previous=first["state"], now=NOW)
        self.assertEqual(second["newly_reached"], [])

    def test_reached_milestones_are_sticky_except_traffic_mode(self):
        first = ms.evaluate(self.metrics(visitors_last_24h=1000, visitors_daily_avg_7d=100), now=NOW)
        self.assertIn("high_traffic_mode", first["newly_reached"])
        later = ms.evaluate(self.metrics(registered_users=3, visitors_last_24h=90), previous=first["state"], now=NOW)
        reached = {m["id"] for m in later["milestones"] if m["reached"]}
        self.assertIn("25_registered_users", reached)
        self.assertNotIn("high_traffic_mode", reached)

    def test_traffic_ratio_needs_minimum_volume(self):
        r = ms.evaluate(self.metrics(visitors_last_24h=50, visitors_daily_avg_7d=2), now=NOW)
        self.assertFalse(next(m for m in r["milestones"] if m["id"] == "high_traffic_mode")["reached"])

    def test_instrumentation_needs_recent_events(self):
        stale = self.metrics()
        stale["events_last_seen"] = {k: "2026-09-01T00:00:00Z" for k in stale["events_last_seen"]}
        r = ms.evaluate(stale, now=NOW)
        m = next(m for m in r["milestones"] if m["id"] == "instrumentation_complete")
        self.assertFalse(m["reached"])
        self.assertIn("missing", m["progress"])

    def test_missing_metrics_never_reach(self):
        r = ms.evaluate({}, now=NOW)
        self.assertEqual([m for m in r["milestones"] if m["reached"]], [])

    def test_activation_never_deploys(self):
        for m in load_yaml("ops/milestones.yaml")["milestones"]:
            self.assertFalse({"deploy", "release", "enable_feature"} & set(m), m["id"])


class TriggerTests(unittest.TestCase):
    def test_healthy_fires_nothing(self):
        self.assertEqual(triggers.fire(fixture("healthy", "metrics_today.json"), fixture("healthy", "github.json")), [])

    def test_problems_wake_the_right_agents(self):
        fired = {f["event"]: f for f in triggers.fire(fixture("problems", "metrics_today.json"), fixture("problems", "github.json"))}
        self.assertEqual(fired["webhook_failure"]["agents"], ["payments-agent", "security-agent"])
        self.assertIn("engineering-orchestrator", fired["error_spike"]["agents"])
        self.assertIn("engineering-orchestrator", fired["deployment_failed"]["agents"])
        self.assertIn("engineering-orchestrator", fired["ci_failed"]["agents"])
        self.assertIn("security-agent", fired["auth_failure_spike"]["agents"])
        self.assertIn("backend-agent", fired["ai_failure_spike"]["agents"])

    def test_small_volume_does_not_fire_error_spike(self):
        m = fixture("healthy", "metrics_today.json")
        m["health"].update({"requests": 10, "error_rate": 0.5})
        self.assertNotIn("error_spike", [f["event"] for f in triggers.fire(m, {})])

    def test_ci_failure_on_feature_branch_is_ignored(self):
        g = fixture("healthy", "github.json")
        g["ci_failures"] = [{"name": "CI", "branch": "feat/x", "conclusion": "failure", "url": "u"}]
        self.assertEqual(triggers.fire(fixture("healthy", "metrics_today.json"), g), [])

    def test_hourly_check_only_production_signals(self):
        fired = [f["event"] for f in health_check.check(fixture("problems", "metrics_today.json"))]
        self.assertIn("webhook_failure", fired)
        self.assertNotIn("ci_failed", fired)


class ReportTests(unittest.TestCase):
    def run_fixture(self, name):
        metrics = {k: fixture(name, f"metrics_{k}.json") for k in ("today", "yesterday", "week")}
        g = fixture(name, "github.json")
        g["migration_files"] = ["supabase/migrations/202609170002_closed_beta.sql",
                                "supabase/migrations/202609210002_stay_logged_in.sql",
                                "supabase/migrations/202610070001_observability.sql"]
        return nightly.run(metrics, g, {}, NOW)

    def test_ceo_report_has_every_section_in_order(self):
        ceo = self.run_fixture("healthy")["ceo"]
        order = ["FYNQ — MORNING REPORT", "## Growth", "New visitors:", "New accounts:", "Unique uploaders:",
                 "Successful analyses:", "Returning users:", "## Revenue", "Checkout starts:", "Successful payments:",
                 "Revenue:", "Visitor → paid:", "Checkout → paid:", "## Product Health", "Errors:", "AI failures:",
                 "Payment failures:", "Auth failures:", "p95 latency:", "Deployment status:", "## Agents",
                 "Investigations completed:", "Issues created:", "PRs created:", "PRs awaiting approval:",
                 "Biggest change since yesterday:", "Biggest current problem:", "Highest-value opportunity:",
                 "Milestone progress:", "CEO action required:"]
        positions = [ceo.index(s) for s in order]
        self.assertEqual(positions, sorted(positions))
        self.assertIn("Revenue: $2.00", ceo)

    def test_reports_differ_and_ceo_stays_short(self):
        r = self.run_fixture("problems")
        self.assertNotEqual(r["ceo"], r["engineering"])
        self.assertLess(len(r["ceo"].splitlines()), 70)
        for section in ("Open agent work", "Failed tests", "Security findings", "Pending migrations",
                        "Payment concerns", "Deployment", "Performance", "Open PRs by risk"):
            self.assertIn(section, r["engineering"])

    def test_problems_require_ceo_action_in_plain_english(self):
        ceo = self.run_fixture("problems")["ceo"]
        self.assertIn("CEO action required: YES", ceo)
        self.assertIn("#22 Payments: retry webhook", ceo)
        self.assertIn("webhook", ceo.split("Biggest current problem:")[1].split("\n")[0].lower())

    def test_prod_named_migrations_are_not_pending(self):
        r = self.run_fixture("healthy")
        self.assertEqual(r["pending_migrations"], [])  # stay_logged_in matches account_sessions_stay_logged_in
        r = self.run_fixture("problems")
        self.assertEqual(r["pending_migrations"], ["202610070001_observability"])

    def test_missing_metrics_degrade_gracefully(self):
        r = nightly.run({"today": None, "yesterday": None, "week": None, "errors": ["today: URLError"]},
                        fixture("healthy", "github.json"), {}, NOW)
        self.assertIn("could not be reached", r["ceo"])
        self.assertIn("Data gaps", r["engineering"])

    def test_snapshot_holds_aggregates_only(self):
        snap = json.dumps(self.run_fixture("healthy")["snapshot"])
        self.assertNotIn("@", snap)
        self.assertLess(len(snap), 2000)


class NightlyCliTests(unittest.TestCase):
    def test_dry_run_writes_files_and_state_without_network(self):
        with tempfile.TemporaryDirectory() as tmp:
            out, state = Path(tmp) / "out", Path(tmp) / "state"
            with redirect_stdout(io.StringIO()):
                code = nightly.main(["--fixtures", str(FIX / "healthy"), "--out", str(out), "--state", str(state),
                                     "--now", "2026-10-08T10:30:00Z"])
            self.assertEqual(code, 0)
            self.assertTrue((out / "ceo-report.md").exists())
            self.assertTrue((out / "engineering-report.md").exists())
            reached = json.loads((state / "milestones.json").read_text())["reached"]
            self.assertIn("25_registered_users", reached)
            with redirect_stdout(io.StringIO()):
                nightly.main(["--fixtures", str(FIX / "healthy"), "--out", str(out), "--state", str(state),
                              "--now", "2026-10-09T10:30:00Z"])
            again = json.loads((out / "result.json").read_text())
            self.assertEqual(again["milestones"]["newly_reached"], [])

    def test_publish_refused_for_fixtures(self):
        with tempfile.TemporaryDirectory() as tmp, redirect_stdout(io.StringIO()):
            self.assertEqual(nightly.main(["--fixtures", str(FIX / "healthy"), "--out", tmp, "--publish"]), 2)


class SafetyTests(unittest.TestCase):
    def test_never_publishes_to_the_public_repo(self):
        gh = RecordingGitHub({"/repos/Fynliq/fynliq-landing": {"private": False}})
        with self.assertRaises(SystemExit):
            nightly.ensure_private(gh, "Fynliq/fynliq-landing", "Fynliq/fynliq-landing")
        with self.assertRaises(SystemExit):
            nightly.ensure_private(RecordingGitHub({"/repos/me/ops": {"private": False}}), "me/ops", "Fynliq/fynliq-landing")
        nightly.ensure_private(RecordingGitHub({"/repos/me/ops": {"private": True}}), "me/ops", "Fynliq/fynliq-landing")

    def test_publish_writes_only_issues_in_the_ops_repo(self):
        metrics = {k: fixture("problems", f"metrics_{k}.json") for k in ("today", "yesterday", "week")}
        result = nightly.run(metrics, fixture("problems", "github.json"), {}, NOW)
        gh = RecordingGitHub({"/repos/me/ops/issues": []}, allow_writes=True)
        nightly.publish(gh, "me/ops", result)
        writes = [(m, p) for m, p, _ in gh.calls if m != "GET"]
        self.assertTrue(writes)
        self.assertTrue(all(p.startswith("/repos/me/ops/issues") for _, p in writes), writes)
        titles = [b["title"] for m, p, b in gh.calls if m == "POST" and p == "/repos/me/ops/issues"]
        self.assertIn("[trigger] webhook_failure", titles)
        self.assertIn("FYNQ morning report — 2026-10-08", titles)

    def test_metrics_token_only_over_https(self):
        with self.assertRaises(ValueError):
            fetch_metrics("http://www.fynliq.com", "t" * 40, "a", "b")

    def test_metrics_request_is_a_get_with_bearer(self):
        seen = {}

        class Resp(io.BytesIO):
            def __enter__(self): return self
            def __exit__(self, *a): return False

        def opener(req, timeout):
            seen["method"], seen["url"], seen["auth"] = req.get_method(), req.full_url, req.get_header("Authorization")
            return Resp(b'{"ok": true}')

        fetch_metrics("https://www.fynliq.com", "t" * 40, "2026-10-07T00:00:00Z", "2026-10-08T00:00:00Z", opener=opener)
        self.assertEqual(seen["method"], "GET")
        self.assertTrue(seen["url"].startswith("https://www.fynliq.com/api/beta-admin?view=ops"))
        self.assertEqual(seen["auth"], "Bearer " + "t" * 40)


if __name__ == "__main__":
    unittest.main()
