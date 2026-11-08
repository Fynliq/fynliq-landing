"""Builds the training and evaluation files from the per-topic files in data/raw/.

    python build_dataset.py            # validate, then write the outputs below
    python build_dataset.py --check    # validate and confirm the outputs are up to date

Outputs:
  data/train.jsonl         reviewed examples only (needs_review false): what train.py uses
  data/review_queue.jsonl  examples waiting for a human (needs_review true); never trained on
  data/eval.jsonl          every held-out evaluation case
  data/MANIFEST.json       counts and SHA-256 of each output, so a training run can name its exact data

To clear an example after review, set "needs_review": false in its data/raw file
(fixing the answer first if needed) and rebuild.
"""
import argparse
import glob
import hashlib
import json
import os
import sys
from collections import Counter

from validate_data import validate

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "data", "raw")


def rows(paths):
    out = []
    for p in paths:
        with open(p, encoding="utf-8") as f:
            out.extend(json.loads(line) for line in f if line.strip())
    return sorted(out, key=lambda r: r["id"])


def dump(rs):
    return "".join(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n" for r in rs)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--check", action="store_true")
    a = p.parse_args()
    train_paths = sorted(glob.glob(os.path.join(RAW, "*.train.jsonl")))
    eval_paths = sorted(glob.glob(os.path.join(RAW, "*.eval.jsonl")))
    errors, warnings = validate(train_paths, eval_paths)
    for w in warnings:
        print("warning:", w)
    if errors:
        for e in errors:
            print("error:", e)
        sys.exit(f"{len(errors)} validation errors; nothing written")

    train = rows(train_paths)
    ev = rows(eval_paths)
    outputs = {
        "train.jsonl": dump([r for r in train if not r["needs_review"]]),
        "review_queue.jsonl": dump([r for r in train if r["needs_review"]]),
        "eval.jsonl": dump(ev),
    }
    reviewed = [r for r in train if not r["needs_review"]]
    manifest = {
        "dataset": "fynq-ai-financial-aid",
        "version": "1.0",
        "award_year": "2026-27",
        "counts": {
            "train": len(reviewed),
            "review_queue": len(train) - len(reviewed),
            "eval": len(ev),
            "train_by_topic": dict(sorted(Counter(r["topic"] for r in reviewed).items())),
            "train_by_kind": dict(sorted(Counter(r["kind"] for r in reviewed).items())),
            "eval_by_topic": dict(sorted(Counter(r["topic"] for r in ev).items())),
        },
        "sha256": {name: hashlib.sha256(body.encode()).hexdigest() for name, body in outputs.items()},
        "sources": sorted({s["url"] for r in train + ev for s in r.get("sources") or []}),
    }
    outputs["MANIFEST.json"] = json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"

    stale = []
    for name, body in outputs.items():
        path = os.path.join(HERE, "data", name)
        if a.check:
            if not os.path.exists(path) or open(path, encoding="utf-8").read() != body:
                stale.append(name)
        else:
            with open(path, "w", encoding="utf-8") as f:
                f.write(body)
    if a.check and stale:
        sys.exit(f"out of date: {', '.join(stale)}; run python build_dataset.py")
    c = manifest["counts"]
    print(f"{'checked' if a.check else 'wrote'}: train {c['train']}, review queue {c['review_queue']}, eval {c['eval']}, {len(manifest['sources'])} official sources")


if __name__ == "__main__":
    main()
