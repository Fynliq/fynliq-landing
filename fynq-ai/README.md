# FYNQ AI 1.0: financial-aid model

FYNQ AI is a small open-weight model (base: Qwen2.5-1.5B-Instruct) fine-tuned with LoRA to explain US college financial aid. LoRA adapters are FYNQ training artifacts; the base weights remain under their own license.

**Status: not trained yet.** The dataset and grading suite are ready. A training run needs a GPU and the CEO's approval of the spend.

## Dataset v1 (2026-27 award year)

| | Count |
|---|---|
| Training examples, reviewed (`data/train.jsonl`) | 381 |
| Waiting for human review (`data/review_queue.jsonl`, never trained on) | 64 |
| Held-out test cases (`data/eval.jsonl`) | 126 |
| Official sources cited (`data/MANIFEST.json`) | 118 |

- **Topics:** FAFSA and SAI, grants, loans, repayment, school (aid offers, refunds, SAP, R2T4), eligibility and dependency, taxes, privacy, and scope/safety.
- **Sources:** official US-government material only (2026-27 FSA Handbook, Electronic Announcements and Dear Colleague Letters, eCFR, the Federal Register, IRS, ED, StudentAid.gov PDFs), which is public domain. No FYNQ user data, no student records, no real names.
- **Law changes:** the 2025 law changes (Public Law 119-21), most effective July 1, 2026, are included and were checked against official sources. Examples that depend on rules still being litigated or not finalized are in the review queue.
- **Fact-check:** an independent fact-check of every figure (116) plus a 40-record sample found no wrong figures. Its 7 wording and citation corrections, and 15 grading fixes, are applied.
- **Format and rules:** `data/SCHEMA.md`.

### Workflow

```bash
python validate_data.py --train data/raw/*.train.jsonl --eval data/raw/*.eval.jsonl   # schema, sources, PII, train/eval overlap
python build_dataset.py            # writes train.jsonl, review_queue.jsonl, eval.jsonl, MANIFEST.json
python -m unittest test_grading test_guards
python evaluate.py --backend reference   # the suite accepts its own reference answers (126/126)
```

The per-topic files in `data/raw/` are the source of truth. To clear a review-queue example, a human checks it against its sources, fixes the answer if needed, sets `"needs_review": false` and rebuilds. `train.py` refuses to train on anything still under review.

**Every award year:** refresh `figure` examples (dollar amounts, rates, limits, dates) from the new FSA Handbook and announcements, and bump `award_year`.

## Grading and the release gate

`evaluate.py` asks the model each test question, then `grading.py` checks:
- **Facts:** every `must_include` group must match. Each group lists alternatives, so different wording is fine.
- **Wrong answers:** no `must_not_include` phrase may be asserted. A phrase that only appears negated ("not the 2025 return") doesn't count.
- **Leaks:** no SSN-like numbers or email addresses anywhere in the answer.

**Release gate (all required):**
- overall at least 85%;
- privacy 100%;
- safety (refusals, privacy, scope) at least 95%;
- figures at least 85%;
- zero leaks.

FYNQ AI should also beat the current production model before it replaces it.

```bash
# Baseline: the current production fallback model (needs FYNQ's OpenAI key, sent with store:false)
OPENAI_API_KEY=... python evaluate.py --backend openai --model "$FYNQ_FALLBACK_MODEL"
# Base model before fine-tuning, and the trained adapter (GPU machine)
python evaluate.py --backend local --adapter none --out reports/base.jsonl
python evaluate.py --backend local --adapter artifacts/fynq-ai-1-lora --out reports/fynq-ai.jsonl
```

Keyword grading is a floor, not proof of quality. Before launch, a person also reads a sample of answers, especially the figures and the refusals.

## Training run (GPU machine, after approval)

```bash
cd fynq-ai
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python build_dataset.py --check          # the data matches MANIFEST.json
python train.py --epochs 3               # LoRA r=16 on Qwen2.5-1.5B-Instruct
python evaluate.py --backend local       # must print GATE PASSED
```

- **Size:** about 380 short examples is a small job. One modern GPU with 24 GB or more of memory should finish in minutes to an hour. Get the price from the provider before starting.
- **Record keeping:** keep `MANIFEST.json`'s hashes with the run, so every adapter names its exact data.
- **Bigger base model:** a 7B-class model will likely answer better at a higher serving cost. That's a decision for after the 1.5B pilot's results.

## Serving

```bash
export FYNQ_INFERENCE_KEY='set-a-long-random-secret-in-your-host'
uvicorn serve:app --host 0.0.0.0 --port 8000
```

- Use `POST /v1/financial-aid` with `Authorization: Bearer <secret>` and the JSON body `{"question": "What is SAI?"}`.
- Keep the GPU server private behind FYNQ Cloud's gateway, with TLS and limits.
- Never commit secrets, personal financial-aid records or trained artifacts (`artifacts/` and `reports/` are git-ignored).
- Pin dependency versions before production.
