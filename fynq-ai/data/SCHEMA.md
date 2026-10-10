# FYNQ AI dataset format (v1)

Two JSON Lines files, one JSON object per line, UTF-8.

## Training examples: `train.jsonl`

```json
{
  "id": "loans-012",
  "question": "My school says I can borrow unsubsidized loans. Does interest start right away?",
  "answer": "Yes. Interest on a Direct Unsubsidized Loan starts adding up from the day the money is paid out, including while you're in school ...",
  "topic": "loans",
  "kind": "concept",
  "award_year": "2026-27",
  "sources": [{ "url": "https://studentaid.gov/...", "title": "Subsidized and Unsubsidized Loans", "section": "Interest" }],
  "needs_review": false
}
```

| Field | Rules |
|---|---|
| `id` | `<topic>-NNN`, unique. |
| `question` | How a real student, parent or advisor would ask it. 8 to 300 characters. No personal information. |
| `answer` | Plain English, 2 to 6 sentences (max 1,200 characters). Accurate to the cited source. Never decides one person's eligibility or award; explains the rule and who decides. Points to StudentAid.gov or the school's financial aid office when the reader must act or confirm. |
| `topic` | One of: `fafsa`, `grants`, `loans`, `repayment`, `school`, `eligibility`, `taxes`, `privacy`, `scope`. |
| `kind` | `concept` (how something works), `procedure` (how to do something), `figure` (contains a dollar amount, rate, percentage, limit or date), `refusal` (declines to decide/predict for an individual, or a harmful request), `privacy` (the user shares or asks for sensitive data), `scope` (not about financial aid). |
| `award_year` | `"2026-27"` when the answer depends on rules for that award year (always for `figure`), otherwise `null`. Figures change every year, so `figure` examples are refreshed each award year. |
| `sources` | At least one official source the answer was checked against: studentaid.gov, fsapartners.ed.gov, ed.gov, irs.gov, federalregister.gov, congress.gov, ecfr.gov. Not needed for `privacy`/`scope`. |
| `needs_review` | `true` if anything is uncertain, recently changed or interpreted. A human must review before training. |

## Evaluation cases: `eval.jsonl` (held out, never trained on)

```json
{
  "id": "eval-loans-004",
  "question": "Can a new grad student still take out a Grad PLUS loan for fall 2026?",
  "topic": "loans",
  "kind": "concept",
  "award_year": "2026-27",
  "must_include": [["no longer", "not available", "ended", "eliminated"], ["July 1, 2026", "2026"]],
  "must_not_include": ["you are eligible", "guaranteed"],
  "reference_answer": "...",
  "sources": [{ "url": "...", "title": "...", "section": "..." }]
}
```

- `must_include`: groups of alternatives. **Every** group must match, and **any** term inside a group counts (case-insensitive). Use 1 to 3 groups that capture the key facts, not the wording.
- `must_not_include`: phrases that would make the answer wrong or unsafe (a wrong fact, a promise of eligibility, repeating an SSN).
- `reference_answer`: a correct answer, for human or model graders.
- Eval questions must test facts in a way that is not a copy or close paraphrase of any training question.

Content rules for both files: public, official US-government material only (public domain); no student records, no real names, no data from FYNQ users.

## Build

The per-topic files in `data/raw/` are the source of truth. `python build_dataset.py` validates them and writes `train.jsonl` (reviewed only), `review_queue.jsonl` (needs_review true; never trained on), `eval.jsonl` and `MANIFEST.json`. Don't edit the built files by hand.
