# The answer service API

Everything Ask Fynliq needs from the backend, in one contract.

The page is finished and runs today against a local composer. Connecting a
real answer service is one environment variable and one endpoint that matches
the shape below — no frontend changes.

```
VITE_FYNLIQ_ASK_URL=https://api.fynliq.com/v1/ask
```

Unset, `src/ask/stubAsker.ts` answers from the question library in the build,
adds a paragraph computed from the student's own award by the tested functions
in `src/core/ask.ts`, and labels it honestly. Set, the flow POSTs to your
endpoint and renders what comes back.

---

## Contents

- [The one rule](#the-one-rule)
- [The request](#the-request)
- [The response](#the-response)
- [A worked example](#a-worked-example)
- [Errors](#errors)
- [Where the money maths belongs](#where-the-money-maths-belongs)
- [Checking your implementation](#checking-your-implementation)

---

## The one rule

**An answer may only call itself `personal` if it names the fields of the
student's own document it was read from.**

A response with `"basis": "personal"` and an empty `grounding` is rejected at
the boundary. Not warned about, not rendered with a caveat — rejected, with
the path named.

This is the rule the whole product exists to protect. A model that produces a
confident paragraph about somebody's refund with nothing behind it is the
failure mode that costs a student money, and "the backend said it was
grounded" is not evidence of grounding. If you cannot name the fields, the
answer is `general` and says so, which is a perfectly good answer.

---

## The request

`POST {VITE_FYNLIQ_ASK_URL}`

| | |
|---|---|
| Content-Type | `application/json` |
| Accept | `application/json` |

```jsonc
{
  "question": "why hasnt my refund hit",
  "analysis": { /* the AidAnalysis from the document reader, or null */ }
}
```

`analysis` is the structured read your own document reader returned — the same
object documented in [`ANALYSIS_API.md`](ANALYSIS_API.md), handed straight
back to you. The uploaded files are **not** sent: they are not kept past the
upload step and they are not this service's business.

`analysis` is `null` when the student has not uploaded anything. A `null` here
must never produce a `personal` answer.

The request carries an `AbortSignal`. A student who asks a second question
aborts the first, so treat a dropped connection as a cancelled job.

---

## The response

`200 OK`, `application/json`.

| Field | Type | Meaning |
|---|---|---|
| `paragraphs` | string[], non-empty | The answer, conclusion first. Rendered in order, one `<p>` each. |
| `basis` | `"personal"` \| `"general"` | Whether the student's own figures were used. |
| `grounding` | string[] | The fields read, e.g. `["semester.bill", "award.lines"]`. Required when `basis` is `personal`; empty otherwise. |
| `missing` | string \| null | What the student would have to add for this to become personal. Shown as a prompt to upload it. |
| `relatedIds` | string[] | Canonical question ids from `src/search/library.ts`. Unknown ids are dropped. |

Field paths in `grounding` are printed under the answer verbatim, in the
monospaced face, exactly as the existing Ask preview on the landing page does
it. Use the contract's own names — `semester.bill`, `award.lines[2].amount`,
`sai` — rather than prose. A student who wants to check a figure can then find
it on their own document.

`paragraphs[0]` is styled as the conclusion. Put the answer there and the
explanation after it, the way the rest of the product does.

---

## A worked example

A student who has uploaded an award letter and a statement asks about their
refund:

```json
{
  "paragraphs": [
    "On your own figures there is no credit balance to refund this term. Your bill is $8,200 and $6,400 of gift aid has been applied to it, which leaves $1,800 the school is still asking you for.",
    "Aid does not arrive in your account. It disburses to your school, which applies it to tuition, fees and anything else you are charged there.",
    "Federal rules give the school 14 days to pay a credit balance to you, counted from the day the balance appeared."
  ],
  "basis": "personal",
  "grounding": ["semester.bill", "semester.grantsApplied"],
  "missing": null,
  "relatedIds": ["refund-spend", "bill-gap", "verification"]
}
```

The same question from somebody who has uploaded nothing:

```json
{
  "paragraphs": [
    "Your aid pays the school first. Whatever is left over is a credit balance, and federal rules give your school 14 days to pay it out to you once that balance exists.",
    "Aid does not arrive in your account. It disburses to your school…"
  ],
  "basis": "general",
  "grounding": [],
  "missing": "your student account statement, which states this term's bill",
  "relatedIds": ["refund-spend", "bill-gap"]
}
```

The second one is not a degraded answer. It is the correct answer to a
question asked without the information needed to make it personal, and the
page presents it as exactly that.

---

## Errors

| Status | What the student sees |
|---|---|
| `4xx` | Your response body, verbatim, up to 200 characters. Write it for a student, not for a log. |
| `5xx` | "The answer service is not responding right now. Try again in a moment." |
| Network failure | "Fynliq could not reach the answer service." |
| Malformed JSON, or a body that fails the contract | The validator's message, with the offending path named. |

---

## Where the money maths belongs

Not here. Rule 1 of this codebase's architecture is that no component and no
model computes a dollar figure — every amount comes from a pure, tested
function in `src/core/`, covered by the suite.

So: do not add up a student's grants, do not work out what they still owe, and
do not decide how much they should accept. Those figures already exist, they
are already correct, and they are already on the screen the student came from:

```ts
breakDownAward(award)          // kept, repaid, uncovered
analyseOutcome(analysis)       // the headline, the term balance, the SAI reading
evaluateLoan(input, amount)    // the verdict and the ceiling
groundInAward(topic, analysis) // the grounded paragraph the stub composes
```

A model that re-derives a number the tested layer already produced is a model
that can disagree with the rest of the page in front of the person whose money
it is. Take the figures from the `analysis` you were handed, quote them, and
explain them.

---

## Checking your implementation

`src/ask/__tests__/contract.test.ts` is an executable version of this
document — including the personal-without-grounding rejection.

```bash
npm test
```

To run the site against your endpoint:

```bash
cp .env.example .env.local     # then fill in VITE_FYNLIQ_ASK_URL
npm run dev
```

Upload a document at `/beta`, then go to Ask Fynliq. If the badge above the
answer reads "Answered from your own documents" and the fields you named are
printed beneath it, you are connected.
