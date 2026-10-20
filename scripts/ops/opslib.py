"""Shared helpers for FYNQ ops tooling. Standard library + PyYAML only.

Nothing in scripts/ops ever writes to production: the only network calls are
GETs to the read-only metrics view and to the GitHub REST API, plus (when
explicitly enabled by the caller) creating labels, comments and issues on
GitHub.
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]


def load_yaml(rel: str) -> dict:
    return yaml.safe_load((ROOT / rel).read_text(encoding="utf-8")) or {}


def _glob_regex(pattern: str) -> "re.Pattern[str]":
    out, i = [], 0
    while i < len(pattern):
        if pattern.startswith("**/", i):
            out.append("(?:.*/)?"); i += 3
        elif pattern.startswith("/**", i) and i + 3 == len(pattern):
            out.append("/.*"); i += 3
        elif pattern.startswith("**", i):
            out.append(".*"); i += 2
        elif pattern[i] == "*":
            out.append("[^/]*"); i += 1
        elif pattern[i] == "?":
            out.append("[^/]"); i += 1
        else:
            out.append(re.escape(pattern[i])); i += 1
    return re.compile("^" + "".join(out) + "$")


def path_matches(path: str, pattern: str) -> bool:
    """Glob match: ** spans directories, * stays within one path segment."""
    return bool(_glob_regex(pattern).match(path))


class GitHub:
    """Minimal GitHub REST client. Read calls work without a token on public repos."""

    def __init__(self, token: str | None = None, api: str = "https://api.github.com", opener=None):
        self.token = token
        self.api = api.rstrip("/")
        self.opener = opener or urllib.request.urlopen

    def request(self, method: str, path: str, body: dict | None = None, params: dict | None = None):
        url = f"{self.api}{path}"
        if params:
            url += "?" + urllib.parse.urlencode(params)
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Accept", "application/vnd.github+json")
        req.add_header("X-GitHub-Api-Version", "2022-11-28")
        req.add_header("User-Agent", "fynq-ops")
        if self.token:
            req.add_header("Authorization", f"Bearer {self.token}")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        with self.opener(req, timeout=30) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else None

    def get(self, path: str, **params):
        return self.request("GET", path, params=params or None)

    def paged(self, path: str, limit: int = 300, **params):
        out, page = [], 1
        while len(out) < limit:
            batch = self.get(path, per_page=100, page=page, **params)
            items = batch.get("workflow_runs", batch.get("items", [])) if isinstance(batch, dict) else (batch or [])
            out.extend(items)
            if len(items) < 100:
                break
            page += 1
        return out[:limit]


def fetch_metrics(base_url: str, token: str, since: str, until: str, segment: str = "none", opener=None) -> dict:
    """GET the read-only aggregate view. The token is sent only to the FYNQ origin."""
    parsed = urllib.parse.urlparse(base_url)
    if parsed.scheme != "https" and parsed.hostname not in ("localhost", "127.0.0.1"):
        raise ValueError("metrics URL must be https")
    query = urllib.parse.urlencode({"view": "ops", "since": since, "until": until, "segment": segment})
    req = urllib.request.Request(f"{base_url.rstrip('/')}/api/beta-admin?{query}", method="GET")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("User-Agent", "fynq-ops-nightly")
    with (opener or urllib.request.urlopen)(req, timeout=60) as resp:
        return json.loads(resp.read())


def env(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name)
    return value if value else default
