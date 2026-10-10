"""Validates FYNQ AI training and evaluation data (see data/SCHEMA.md).

    python validate_data.py data/train.jsonl data/eval.jsonl
    python validate_data.py --train data/raw/loans.train.jsonl --eval data/raw/loans.eval.jsonl

Exits non-zero on any error. Also checks that no eval question is a near
copy of a training question (word-overlap Jaccard >= 0.8) and that no record
contains high-risk personal data.
"""
import argparse
import json
import re
import sys

from guards import SSN_PATTERN

TOPICS = {"fafsa", "grants", "loans", "repayment", "school", "eligibility", "taxes", "privacy", "scope"}
KINDS = {"concept", "procedure", "figure", "refusal", "privacy", "scope"}
OFFICIAL = re.compile(r"^https://([a-z0-9-]+\.)*(studentaid\.gov|ed\.gov|irs\.gov|federalregister\.gov|congress\.gov|ecfr\.gov)(/|$)")
FIGURE = re.compile(r"\$\s?\d|\d\s?%|\b\d+(\.\d+)?\s?percent\b|\b(19|20)\d{2}\b", re.I)
EMAIL = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.I)
# Fictional example SSNs in a privacy example are still refused: never put one in data.


def words(text):
    return set(re.findall(r"[a-z0-9]+", text.lower()))


def jaccard(a, b):
    a, b = words(a), words(b)
    return len(a & b) / len(a | b) if a | b else 0.0


def load(path, errors):
    rows = []
    with open(path, encoding="utf-8") as f:
        for n, line in enumerate(f, 1):
            if not line.strip():
                continue
            try:
                rows.append((n, json.loads(line)))
            except json.JSONDecodeError as e:
                errors.append(f"{path}:{n}: invalid JSON ({e.msg})")
    return rows


def check_common(path, n, r, errors):
    where = f"{path}:{n} ({r.get('id', '?')})"
    q = r.get("question")
    if not isinstance(q, str) or not 8 <= len(q) <= 300:
        errors.append(f"{where}: question must be 8-300 characters")
    if r.get("topic") not in TOPICS:
        errors.append(f"{where}: topic must be one of {sorted(TOPICS)}")
    if r.get("kind") not in KINDS:
        errors.append(f"{where}: kind must be one of {sorted(KINDS)}")
    ay = r.get("award_year")
    if ay is not None and ay != "2026-27":
        errors.append(f"{where}: award_year must be '2026-27' or null")
    if r.get("kind") == "figure" and ay is None:
        errors.append(f"{where}: figure examples need an award_year")
    srcs = r.get("sources")
    if r.get("kind") not in ("privacy", "scope"):
        if not isinstance(srcs, list) or not srcs:
            errors.append(f"{where}: at least one source is required")
    for s in srcs or []:
        if not isinstance(s, dict) or not isinstance(s.get("url"), str) or not OFFICIAL.match(s["url"]):
            errors.append(f"{where}: source must be an official https URL (studentaid.gov, ed.gov, irs.gov, federalregister.gov, congress.gov, ecfr.gov): {s!r}"[:300])
    blob = json.dumps(r, ensure_ascii=False)
    if SSN_PATTERN.search(blob):
        errors.append(f"{where}: contains an SSN-like number")
    if EMAIL.search(blob):
        errors.append(f"{where}: contains an email address")
    return where


def validate(train_paths, eval_paths):
    errors, warnings = [], []
    ids = {}
    train_q = []
    for path in train_paths:
        for n, r in load(path, errors):
            where = check_common(path, n, r, errors)
            a = r.get("answer")
            if not isinstance(a, str) or not 40 <= len(a) <= 1200:
                errors.append(f"{where}: answer must be 40-1200 characters")
            elif r.get("kind") != "figure" and FIGURE.search(a) and r.get("kind") not in ("privacy", "scope"):
                warnings.append(f"{where}: answer has a number/date but kind is not 'figure'")
            if not isinstance(r.get("needs_review"), bool):
                errors.append(f"{where}: needs_review must be true or false")
            if not re.fullmatch(r"[a-z]+-\d{3}", str(r.get("id", ""))):
                errors.append(f"{where}: id must look like topic-NNN")
            if r.get("id") in ids:
                errors.append(f"{where}: duplicate id (also {ids[r['id']]})")
            ids[r.get("id")] = where
            train_q.append((r.get("question", ""), where))
    for i, (q1, w1) in enumerate(train_q):
        for q2, w2 in train_q[i + 1:]:
            if jaccard(q1, q2) >= 0.9:
                warnings.append(f"near-duplicate training questions: {w1} / {w2}")
    for path in eval_paths:
        for n, r in load(path, errors):
            where = check_common(path, n, r, errors)
            if not re.fullmatch(r"eval-[a-z]+-\d{3}", str(r.get("id", ""))):
                errors.append(f"{where}: id must look like eval-topic-NNN")
            if r.get("id") in ids:
                errors.append(f"{where}: duplicate id")
            ids[r.get("id")] = where
            mi = r.get("must_include")
            if not isinstance(mi, list) or not 1 <= len(mi) <= 4 or not all(isinstance(g, list) and g and all(isinstance(t, str) and t.strip() for t in g) for g in mi):
                errors.append(f"{where}: must_include must be 1-4 non-empty lists of terms")
            mn = r.get("must_not_include", [])
            if not isinstance(mn, list) or not all(isinstance(t, str) and t.strip() for t in mn):
                errors.append(f"{where}: must_not_include must be a list of terms")
            ref = r.get("reference_answer")
            if not isinstance(ref, str) or len(ref) < 40:
                errors.append(f"{where}: reference_answer is required")
            elif isinstance(mi, list):
                for g in mi:
                    if isinstance(g, list) and not any(t.lower() in ref.lower() for t in g if isinstance(t, str)):
                        errors.append(f"{where}: the reference answer fails its own must_include group {g}")
                for t in mn if isinstance(mn, list) else []:
                    if isinstance(t, str) and t.lower() in ref.lower():
                        errors.append(f"{where}: the reference answer contains its own forbidden term {t!r}")
            for q, w in train_q:
                if jaccard(r.get("question", ""), q) >= 0.8:
                    errors.append(f"{where}: eval question is a near copy of training question {w}")
    return errors, warnings


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--train", nargs="*", default=[])
    p.add_argument("--eval", nargs="*", default=[])
    p.add_argument("paths", nargs="*", help="train.jsonl then eval.jsonl")
    a = p.parse_args()
    train, ev = list(a.train), list(a.eval)
    if a.paths:
        train.append(a.paths[0])
        ev.extend(a.paths[1:])
    errors, warnings = validate(train, ev)
    for w in warnings:
        print("warning:", w)
    for e in errors:
        print("error:", e)
    print(f"{len(errors)} errors, {len(warnings)} warnings")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
