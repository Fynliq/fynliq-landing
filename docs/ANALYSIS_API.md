# The document reader API

Everything the beta flow needs from the backend, in one contract.

The frontend is finished and runs today against a local stub. Connecting the
real reader is one environment variable and one endpoint that matches the shape
below — no frontend changes.

```
VITE_FYNLIQ_ANALYZE_URL=https://api.fynliq.com/v1/analyze
```

Unset, the flow runs on `src/beta/stubAnalyzer.ts` and the results page states
on screen that the figures are demo ones. Set, it POSTs to your endpoint and
renders what comes back.

---

## Contents

- [The request](#the-request)
- [The response](#the-response)
- [A worked example](#a-worked-example)
- [Errors](#errors)
- [Three rules the frontend enforces](#three-rules-the-frontend-enforces)
- [What the frontend does with your response](#what-the-frontend-does-with-your-response)
- [Checking your implementation](#checking-your-implementation)

---

## The request

`POST {VITE_FYNLIQ_ANALYZE_URL}`

| | |
|---|---|
| Content-Type | `multipart/form-data` (set by the browser, boundary included) |
| Accept | `application/json` |
| Field name | `files` — repeated once per file |
| Files per request | 1 to 4 |
| Size per file | up to 10 MB |
| Types | `application/pdf`, `image/png`, `image/jpeg`, `image/webp`, `image/heic` |

HEIC is on the list because it is what an iPhone produces by default. If your
reader cannot handle it, return a `4xx` with a message saying so — the flow
shows that message to the student verbatim.

The request carries an `AbortSignal`. A student who presses Cancel aborts the
fetch, so treat a dropped connection as a cancelled job and bill nothing for it.

CORS: the browser sends this cross-origin from the site's domain. The endpoint
needs `Access-Control-Allow-Origin` for that domain and must answer the
preflight `OPTIONS`.

---

## The response

`200 OK`, `application/json`.

### Top level

| Field | Type | Notes |
|---|---|---|
| `document` | object | Required. See below. |
| `student` | object | Required. Both fields may be `null`. |
| `sai` | number \| null | Student Aid Index. `null` when the document did not state it. May be negative. |
| `award` | object | Required. See below. |
| `semester` | object \| null | This term's bill. `null` when not stated. May be omitted entirely. |
| `unread` | array | What you could not find. May be omitted; defaults to `[]`. |

### `document`

| Field | Type | Notes |
|---|---|---|
| `fileNames` | string[] | Echoed back and shown to the student, so they can confirm you read the right file. |
| `kind` | string | One of `fafsa-submission-summary`, `award-letter`, `account-statement`, `unknown`. |
| `readAt` | string | ISO-8601. Parsed with `new Date()`. |
| `confidence` | number | `0`–`1`. **Below `0.7` the whole result is presented as needing to be checked**, and a "check these figures" step is pushed to the top of the next-step list. |

### `student`

| Field | Type |
|---|---|
| `firstName` | string \| null |
| `school` | string \| null |

Send `null` rather than an empty string. Neither field is required to produce
an answer, and the flow does not ask for them anywhere.

### `award`

| Field | Type | Notes |
|---|---|---|
| `year` | string | e.g. `"2026-27"`. Shown verbatim. |
| `source` | string | Where the figures came from, e.g. `"FAFSA Submission Summary"`. |
| `costOfAttendance` | number \| null | **Required key.** `null` means the document did not state it — omitting the key is rejected. |
| `lines` | array | One per row of the award. At least one. |

### `award.lines[]`

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable within the response; used as a React key. |
| `label` | string | The row as the letter names it, e.g. `"Federal Pell Grant"`. |
| `meaning` | string | One plain-English sentence, shown under the label. No trailing full stop. |
| `kind` | string | `grant`, `subsidized-loan`, `unsubsidized-loan` or `work-study`. |
| `amount` | number | Whole dollars for the full award year. |
| `verified` | boolean | True when read from the student's own document. |

`kind` is what every downstream figure turns on: `grant` is money kept, the two
loan kinds are money repaid, and `work-study` is held out of every total. There
is no "other" — if a row does not fit one of the four, leave it out and list it
under `unread`.

### `semester`

All four are whole dollars **for this term**, not the year.

| Field | Notes |
|---|---|
| `bill` | What the school is charging this term. |
| `grantsApplied` | Gift aid already applied against that bill. |
| `subsidizedAvailable` | Subsidized loan money the student may still accept this term. |
| `unsubsidizedAvailable` | Unsubsidized loan money they may still accept this term. |

Send `null` for the whole object rather than zeros. Zeros mean "offered
nothing", which is a different and much worse answer than "we don't know".

### `unread[]`

| Field | Notes |
|---|---|
| `field` | What is missing, named the way a student would name it: `"Next disbursement date"`. |
| `where` | Where it is normally printed, so they can supply it: `"Your school's disbursement calendar."` |

This array is a feature, not an error channel. It is rendered as its own panel
and turned into a next step. **Anything you could not read belongs here rather
than guessed at.**

---

## A worked example

```json
{
  "document": {
    "fileNames": ["fafsa-summary.pdf", "award-letter.pdf"],
    "kind": "fafsa-submission-summary",
    "readAt": "2026-09-12T09:30:00.000Z",
    "confidence": 0.94
  },
  "student": { "firstName": "Sam", "school": "State University" },
  "sai": 0,
  "award": {
    "year": "2026-27",
    "source": "FAFSA Submission Summary",
    "costOfAttendance": 26600,
    "lines": [
      {
        "id": "pell",
        "label": "Federal Pell Grant",
        "meaning": "Free money, never repaid",
        "kind": "grant",
        "amount": 7395,
        "verified": true
      },
      {
        "id": "institutional",
        "label": "Undergrad institutional grant",
        "meaning": "Your school's own money, never repaid",
        "kind": "grant",
        "amount": 5405,
        "verified": true
      },
      {
        "id": "sub",
        "label": "Direct subsidized loan",
        "meaning": "Repaid. No interest while enrolled",
        "kind": "subsidized-loan",
        "amount": 5500,
        "verified": true
      },
      {
        "id": "unsub",
        "label": "Direct unsubsidized loan",
        "meaning": "Repaid. Interest starts immediately",
        "kind": "unsubsidized-loan",
        "amount": 2000,
        "verified": true
      },
      {
        "id": "work-study",
        "label": "Federal work-study",
        "meaning": "Wages for hours worked. Not a lump sum",
        "kind": "work-study",
        "amount": 2400,
        "verified": true
      }
    ]
  },
  "semester": {
    "bill": 8200,
    "grantsApplied": 6400,
    "subsidizedAvailable": 2750,
    "unsubsidizedAvailable": 1000
  },
  "unread": [
    {
      "field": "Next disbursement date",
      "where": "Your school's disbursement calendar, or the refund date on your student account."
    }
  ]
}
```

From that, with no further input, the results page produces:

> **Your bill is covered — but the last $1,800 of it has to be borrowed.**
> $6,400 of gift aid was already applied to an $8,200 bill. Accepting $1,800 in
> loans clears the rest, and that is the figure to stop at: you were offered
> $3,750, and the difference is money you would repay without owing it.

plus the three headline figures ($12,800 kept · $7,500 repaid · $6,300
uncovered), the term balance, the SAI reading, and six ordered next steps.

---

## Errors

| Status | How the flow presents it |
|---|---|
| `4xx` | Your response body, shown to the student **verbatim**, in a rust panel. Keep it short, plain and actionable — "This page does not show your award amounts. Upload the Accept/Decline page instead." Body is truncated at 200 characters. |
| `5xx` | A fixed message: the reader is not responding, files were not stored, try again. Your body is not shown. |
| Network failure | A fixed message about the connection. |
| Malformed JSON | A format error naming the exact field path, e.g. `award.lines[2].amount: expected a finite number`. Visible to the student, so it should never happen in production. |

There is no partial-success status. A document you could only half read is a
`200` with a low `confidence` and a populated `unread` — that path is designed
for, and it renders well.

---

## Three rules the frontend enforces

These are checked in `src/beta/contract.ts` and will reject a response that
breaks them.

**1. A missing figure is `null`, never `0` and never omitted.**
`costOfAttendance` must be present as a key. `semester` may be `null` or absent
but not partially filled. Zero is a real financial answer and is never used to
mean "unknown".

**2. Every dollar figure is a finite number.**
Strings, `null` inside a line, `NaN` and `Infinity` are all rejected at the
boundary with the path named, rather than rendering as `$NaN` to somebody
deciding how much to borrow.

**3. A response cannot label itself as demo figures.**
`provenance` is forced to `"document"` on anything that arrives over the wire.
Only the local stub can mark itself demo, and when it does the results page
says so in a banner. Sending `"provenance": "demo"` is ignored.

---

## What the frontend does with your response

Nothing in a component computes a dollar figure. Your response is handed to
pure functions in `src/core/`, all of them covered by tests:

| Function | Produces |
|---|---|
| `breakDownAward(award)` | Money kept, money repaid, work-study, total offered, and the uncovered gap |
| `analyseOutcome(analysis)` | The headline answer, the term balance, the SAI reading, whether the read needs checking |
| `buildNextSteps(analysis, outcome)` | The ordered next steps, each one derived from a figure you sent |
| `evaluateLoan(input, amount)` | How much to accept, split subsidized first |

So the figures on the results page and the figures your reader extracted cannot
drift apart, and any disagreement is a bug in one place rather than two.

---

## Checking your implementation

The contract tests double as an executable spec:

```bash
npm test -- contract
```

`src/beta/__tests__/contract.test.ts` contains the worked example above and
every rejection case. If your response passes `parseAnalysis`, it will render.

To point the flow at a local backend while developing:

```bash
echo 'VITE_FYNLIQ_ANALYZE_URL=http://localhost:8000/analyze' > .env.local
npm run dev
```
