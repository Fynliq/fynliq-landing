# The search analytics API

Everything the Search page needs from the backend, in one contract.

The page is finished and runs today on sample figures. Connecting real search
demand is one environment variable and one endpoint that matches the shape
below — no frontend changes.

```
VITE_FYNLIQ_SEARCH_URL=https://api.fynliq.com/v1/search
```

Unset, the page runs on `src/search/sampleAnalytics.ts` and says on screen, in
a line under the ranking, that the volumes are sample figures. Set, it reads
your endpoint and ranks whatever comes back.

---

## Contents

- [What the frontend owns, and what you own](#what-the-frontend-owns-and-what-you-own)
- [Reading demand](#reading-demand)
- [The response](#the-response)
- [A worked example](#a-worked-example)
- [Reporting a search](#reporting-a-search)
- [Grouping queries into canonical questions](#grouping-queries-into-canonical-questions)
- [Rules the frontend enforces](#rules-the-frontend-enforces)
- [What the frontend does with your numbers](#what-the-frontend-does-with-your-numbers)
- [Checking your implementation](#checking-your-implementation)

---

## What the frontend owns, and what you own

| | |
|---|---|
| **Questions and answers** | The frontend. `src/search/library.ts` ships in the build. You never send answer text. |
| **How often each is searched** | You. |
| **Which phrasings mean the same question** | You, over history. The frontend does the same job live, for the query being typed. |
| **Rank, movement, trend, bar length** | The frontend, computed in `src/core/trending.ts` from your counts. Do not send positions. |

The last row matters. Send counts, not rankings. Every position on the page is
derived, so two clients looking at the same payload always agree, and a
ranking can never drift away from the numbers printed beside it.

---

## Reading demand

`GET {VITE_FYNLIQ_SEARCH_URL}`

| | |
|---|---|
| Accept | `application/json` |
| Auth | none — this is public, aggregate demand |
| Cadence | fetched once per page load, cancelled on unmount |

Nothing about a particular student is sent, because nothing about a particular
student is needed. Cache it as hard as you like; the page is not expecting
second-by-second freshness, and a ranking recomputed hourly is indistinguishable
from one recomputed continuously.

CORS: the browser sends this cross-origin from the site's domain, so the
endpoint needs `Access-Control-Allow-Origin` for that domain.

---

## The response

`200 OK`, `application/json`.

```jsonc
{
  "provenance": "live",              // "live" | "sample"
  "generatedAt": "2026-09-14T09:00:00.000Z",
  "questions": [ /* one row per canonical question */ ]
}
```

`provenance` is not decoration. `"sample"` makes the page state on screen that
the figures are not real demand. If you are serving seeded or synthetic data
during development, say `"sample"` — the alternative is a page that quietly
presents invented popularity to students as though other students produced it.

### `questions[]`

| Field | Type | Meaning |
|---|---|---|
| `id` | string | The canonical question id, from `src/search/library.ts`. |
| `searches30d` | integer ≥ 0 | Group total over the last 30 days. |
| `searches7d` | integer ≥ 0 | Group total over the last 7 days. |
| `searchesPrev7d` | integer ≥ 0 | Group total over the 7 days before those. |
| `daily` | integer[7] | Group totals per day, **oldest first**. |
| `variants` | object[] | The phrasings folded into this question. |

**Every count is the group total** — the canonical phrasing plus every variant
you clustered into it. `variants` is the evidence for that total, not an
amount to add to it.

### `questions[].variants[]`

| Field | Type | Meaning |
|---|---|---|
| `text` | string, non-empty | The phrasing as students typed it. |
| `searches30d` | integer ≥ 0 | Searches for that phrasing alone, last 30 days. |

Send the phrasings worth showing — the page prints them under the answer as
"Other ways students ask this", which is how the grouping proves itself to a
student rather than asking to be trusted. Six or so is plenty; the frontend
sorts them largest first.

Send nothing you would not put in front of the person who typed it. These are
raw queries: strip anything that looks like a name, an email, a student id or
an account number before it reaches this field.

---

## A worked example

```json
{
  "provenance": "live",
  "generatedAt": "2026-09-14T09:00:00.000Z",
  "questions": [
    {
      "id": "refund-arrival",
      "searches30d": 3184,
      "searches7d": 1042,
      "searchesPrev7d": 812,
      "daily": [135, 166, 168, 156, 155, 125, 137],
      "variants": [
        { "text": "when will my refund come", "searches30d": 669 },
        { "text": "where is my financial aid refund", "searches30d": 414 },
        { "text": "why hasn't my refund hit", "searches30d": 287 },
        { "text": "how long does a financial aid refund take", "searches30d": 191 }
      ]
    },
    {
      "id": "verification",
      "searches30d": 1544,
      "searches7d": 612,
      "searchesPrev7d": 268,
      "daily": [79, 98, 98, 91, 91, 73, 82],
      "variants": [
        { "text": "why was i selected for verification", "searches30d": 324 },
        { "text": "verification holding up my aid", "searches30d": 201 }
      ]
    }
  ]
}
```

That payload produces: `refund-arrival` at #1, and `verification` in the
Trending rail at 2.3× — because trending is measured on `searches7d` against
`searchesPrev7d`, not on `searches30d`.

---

## Reporting a search

`POST {VITE_FYNLIQ_SEARCH_URL}/events`

```json
{
  "query": "why hasnt my refund hit",
  "questionId": "refund-arrival",
  "kind": "search",
  "at": "2026-09-14T09:04:11.318Z"
}
```

| Field | Meaning |
|---|---|
| `query` | Exactly what was typed, or the canonical question when a row was clicked. |
| `questionId` | What the frontend matched it to, or `null` when nothing matched. |
| `kind` | `"search"` (typed or submitted) or `"open"` (opened from a ranked list). |
| `at` | Client clock. Do not trust it for ordering; stamp your own. |

Three things about this call:

**It is fire and forget.** Sent with `keepalive` so it survives the navigation
that usually follows, and every failure is swallowed. A student reading about
their refund must never see an error because a counter could not be
incremented. Return `202` and get on with your day.

**A `null` questionId is the most valuable row you will get.** It is a question
students keep typing that Fynliq has no answer for. Those queries are the
backlog for whoever writes the next answer — keep them.

**It carries nothing about the student's aid.** The search page has no access
to uploaded documents, by design. Do not join these events to anything that
does.

---

## Grouping queries into canonical questions

This is the half of the feature that only you can do, and the client's brief
states the requirement exactly:

> “When will my refund come?”, “Where is my financial aid refund?” and “Why
> hasn’t my refund hit?” should all contribute toward one canonical question:
> “When will my financial aid refund arrive?”

How you cluster is your business — embeddings and a similarity threshold,
normalised n-grams, a learned classifier, or a human reviewing an unmatched
queue. What the contract asks of you:

1. **One row per canonical question.** A duplicate `id` is rejected.
2. **Counts are group totals**, with variants folded in, never added on top.
3. **Send the phrasings back** in `variants` so the page can show its working.
4. **Unmatched queries stay unmatched.** Do not force a query into the nearest
   question to avoid a gap. A student who is confidently given the wrong
   financial answer is worse off than one who is told there is no answer yet.

The frontend does the same job live, for the query being typed, in
`src/search/match.ts` — scoring against the canonical wording, the seed
phrasings in the library, the phrasings you send back, and the answer text.
The two layers are complementary, not competing: yours learns from history and
survives phrasings nobody anticipated, and the frontend's works before your
response has arrived and when it cannot be reached at all.

---

## Rules the frontend enforces

Every response is validated by `src/search/contract.ts` before anything sees
it, and a failure names the exact path. These are not style preferences —
each one is a statement the interface makes on screen.

| Rule | Why |
|---|---|
| Counts are finite, whole and non-negative | A fractional search count means something upstream averaged. Searches are events. |
| `daily` has exactly 7 entries | It is drawn as a seven-day sparkline. |
| `daily` sums **exactly** to `searches7d` | The sparkline and the trend badge are drawn from these two, side by side. Close enough is how a chart ends up contradicting the number printed next to it. |
| `searches7d + searchesPrev7d ≤ searches30d` | Fourteen days cannot hold more searches than the thirty containing them. |
| Σ `variants[].searches30d` ≤ `searches30d` | A group whose parts exceed the whole means the clustering double-counted. |
| No duplicate `id` | A canonical question has one row. |
| `provenance` is `live` or `sample` | Nothing else is a claim the page knows how to make honestly. |

**Unknown ids are ignored, not an error.** The library ships with the frontend
build and your analytics are live, so the two will drift: you will know about
questions a deployed build has never heard of, and a newly deployed question
will have no history behind it. Both are normal. Unknown ids are dropped;
questions you do not mention rank at zero rather than vanishing from the page.

---

## What the frontend does with your numbers

All of it is in `src/core/trending.ts`, tested, and none of it is anywhere
else:

```ts
rankQuestions(demand)      // → rank, previousRank, movement, momentum
selectTrending(demand)     // → what is rising, floored so noise cannot trend
previousWindow(demand)     // → the 30-day window, slid back one week
momentum(demand)           // → searches7d / searchesPrev7d, or null for new
volumeShare(searches, top) // → the length of the bar on each row
searchProof(searches)      // → "842 searches in the past 30 days"
```

Two behaviours worth knowing when your numbers look surprising on screen:

**Position changes need no history table.** `previousRank` is computed by
sliding the 30-day window back one week — `searches30d - searches7d +
searchesPrev7d` — and ranking on that. You store nothing extra.

**Trending is floored.** A question needs at least `TREND_FLOOR` searches in
the week (40) before it can appear in the rail, however steep its rise. Three
people and a typo can double a count of two, and a Trending rail that promotes
that is one students learn to ignore.

---

## Checking your implementation

`src/search/__tests__/contract.test.ts` is an executable version of this
document. It asserts every rule above, and it round-trips the sample source
through the same validator your responses go through:

```bash
npm test
```

The fastest way to check a payload is to paste it into that suite and run it.
Any failure names the field and says what was wrong with it.

To run the site against your endpoint:

```bash
cp .env.example .env.local     # then fill in VITE_FYNLIQ_SEARCH_URL
npm run dev
```

If the ranking loads and the "sample figures" line under it is replaced by the
live wording, you are connected.
