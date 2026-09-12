<div align="center">

<img src="public/fynliq-mark.png" alt="Fynliq" width="72" />

# Fynliq — Beta

**Know what your aid actually leaves you.**

The Fynliq beta: a landing page that makes the argument, and the flow behind it
where a student uploads their own aid summary and gets their own answer back —
what they keep, what they repay, what nothing is covering, what their school is
actually asking for, and what to do next.

[![Live](https://img.shields.io/badge/live-fynliq--landing.vercel.app-000?style=flat-square)](https://fynliq-landing.vercel.app)
[![React](https://img.shields.io/badge/React-18-149ECA?style=flat-square&logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vite.dev)
[![Tests](https://img.shields.io/badge/tests-61%20passing-0E7A45?style=flat-square)](#testing)

**[View the live site →](https://fynliq-landing.vercel.app)**

</div>

<br />

![Fynliq landing page hero](docs/screenshots/01-hero.png)

<br />

## Contents

- [What this is](#what-this-is)
- [Inside the page](#inside-the-page)
- [The beta flow](#the-beta-flow)
- [Connecting the document reader](#connecting-the-document-reader)
- [Quick start](#quick-start)
- [Stack](#stack)
- [Architecture: three rules](#architecture-three-rules)
- [Design system](#design-system)
- [Motion and state](#motion-and-state)
- [Accessibility](#accessibility)
- [Data and disclaimers](#data-and-disclaimers)
- [Testing](#testing)
- [Deployment](#deployment)

<br />

## What this is

An award letter gives a student four rows and a total, and explains none of them.
This landing page is the argument for a product that does explain them — built to
the Fynliq Beta Design Handoff and speaking the same product language as the beta
prototype.

Every dollar figure on the page is computed by the same tested pure functions the
app would use, rendered from one demo student. The page is a live preview of the
product's reasoning, not a mockup of it.

<br />

## Inside the page

**Money clarity** — the runway, the weekly safe-to-spend, and the honest empty
state when there is no disbursement date to compute from.

![Money clarity section](docs/screenshots/02-clarity.png)

**Financial aid** — the award split line by line into money kept and money
repaid, with a glossary for the words the letter never defines.

![Financial aid breakdown](docs/screenshots/03-aid.png)

**Loan decision** — a slider where the verdict moves green → gold → rust as the
student steps past what they actually owe. The colour *is* the advice.

![Loan decision slider](docs/screenshots/04-loan.png)

**Get more** — categories and the questions worth asking before borrowing, not
invented scholarships with made-up deadlines.

![Get more free money](docs/screenshots/05-get-more.png)

**Deadlines** — the tasks that actually move money, ordered by what happens if
they are missed.

![Task list and deadlines](docs/screenshots/06-tasks.png)

**Ask** — plain-English answers to the questions students bring to a financial
aid office.

![Ask preview](docs/screenshots/07-ask.png)

### Mobile

<div align="center">
<img src="docs/screenshots/mobile-hero.png" alt="Fynliq on mobile" width="320" />
</div>

<br />

## The beta flow

Every **Join the beta** button leads to `/beta`, where a student uploads their
own documents and gets their own answer back.

```
/            Join the beta
/beta        Upload aid summary  →  Fynliq reads it
/beta/results                       Personalised answer and next steps
```

![The upload step](docs/screenshots/beta-01-upload.png)

**Upload** (`/beta`) takes a FAFSA Submission Summary, an award letter, a
student account statement, or a screenshot of any of them — dropped, chosen,
or pasted straight from the clipboard with <kbd>Ctrl</kbd>/<kbd>⌘</kbd> +
<kbd>V</kbd>, which is the fastest thing a student can produce from a portal.
Up to four files, since award documents run to several pages. Every refusal is
announced in words with the fix in it; a dropzone that silently swallows a file
is the most common way this kind of interface wastes somebody's afternoon.

**Analysing** walks four named stages — reading, finding the award lines,
checking them against the bill, writing the answer — with skeletons shaped like
the answer that replaces them, and a cancel button that actually aborts the
request.

![The answer](docs/screenshots/beta-03-answer.png)

**The answer** (`/beta/results`) opens with the conclusion, not with a
dashboard:

> **Your bill is covered — but the last $1,800 of it has to be borrowed.**
> $6,400 of gift aid was already applied to your bill of $8,200. Accepting
> $1,800 in loans clears the rest, and that is the figure to stop at.

Then what supports it: money kept, money repaid and the uncovered gap; the
award line by line; what the school is actually asking for this term and the
exact amount to accept; the Student Aid Index in plain English; **what Fynliq
could not read**, listed rather than guessed at; a glossary of the words on
their own document; and the next steps, ordered by what it costs to skip them.

![The full results page](docs/screenshots/beta-04-results-full.png)

The result is held in memory and nowhere else — not in `sessionStorage`, not in
the URL. Reloading `/beta/results` returns to the upload step rather than
restoring somebody's financial position from disk. It prints cleanly, because a
student who gets a straight answer usually needs to take it to somebody.

### On a phone

<div align="center">
<img src="docs/screenshots/beta-mobile-upload.png" alt="The upload step on mobile" width="300" />
<img src="docs/screenshots/beta-mobile-answer.png" alt="The answer on mobile" width="300" />
</div>

<br />

## Connecting the document reader

The flow is finished and runs today against a local stub. Connecting the real
reader is one environment variable:

```bash
VITE_FYNLIQ_ANALYZE_URL=https://api.fynliq.com/v1/analyze
```

Unset, `src/beta/stubAnalyzer.ts` serves the demo student — and the results page
says so, in a banner, at the top. A stub that dressed placeholder figures up as
somebody's real aid would be the worst thing this product could ship, so
`provenance: 'demo'` is part of the type and the banner is not optional.

Set, the flow POSTs the files as `multipart/form-data` and validates the JSON
that comes back before anything downstream sees it. A backend still under
construction fails loudly at the boundary with the offending path named
(`award.lines[2].amount: expected a finite number`) rather than quietly
rendering `$NaN` to somebody deciding how much to borrow.

**[The full request and response contract →](docs/ANALYSIS_API.md)** — with a
worked example, the error semantics, and the three rules the frontend enforces.
No frontend changes are needed to connect it.

<br />

## Quick start

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # typecheck + production build to dist/
npm run preview   # serve the production build
npm test          # the money maths
```

Requires Node 18+. No environment variables, no API keys, no backend — the page
runs entirely from the demo dataset in `src/data/demo.ts`.

<br />

## Stack

Vite + React + TypeScript, plain CSS with CSS Modules. No Tailwind, no CSS-in-JS,
no UI library.

```
src/
  core/           Money maths as pure, tested functions
  beta/           The upload seam: file rules, the wire contract, the readers
  router/         Three routes, sixty lines, no dependency
  pages/          Landing · BetaUpload · BetaResults
  data/demo.ts    The one demo student, used by every preview
  styles/         Design tokens, base layer and print
  components/
    ui/           Amount, Pill, Button, Card, Bar, Section, Skeleton, Logo
    fx/           Aurora, Coin3D, Stage3D, ScrollProgress
    beta/         FlowShell, Dropzone, Analyzing
    Navbar/ Hero/ ProductPreview/ MoneyMetric/ FinancialCard/ AidBreakdown/
    LoanDecision/ GetMore/ TaskList/ AskPreview/ TrustSection/ CTA/ Footer/
  lib/            useReveal, useCopy, useCountUp, useScrollVar, useTilt, motion
```

Production build: **240 kB JS** (78 kB gzipped) and **64 kB CSS** (12 kB
gzipped) — the whole beta flow, routing included, adds 41 kB JS and 22 kB CSS
raw over the landing page alone, and no new dependency.

Routing is a single delegated click listener rather than a `<Link>` component,
so every `<a href="/beta">` already on the page — inside `Button`, `Navbar`,
`CTA` — routes client-side without being rewritten, and still behaves like an
anchor for middle-click, ctrl-click and "open in new tab".

<br />

## Architecture: three rules

**1. All money maths lives in `core/` as tested pure functions.**
Nothing in a component computes a dollar figure — including on the results
page, where the figures belong to a real student. The runway, the award split,
the loan verdict, the headline answer and the next steps are `if` statements and
division in `core/`, covered by 61 tests. Every screen renders whatever those
functions return, so the figures on the page and the figures the reader
extracted cannot drift apart.

```ts
computeRunway(input, award)              // → RunwayReady | RunwayUnavailable
breakDownAward(award)                    // → { kept, repaid, uncovered, … }
evaluateLoan(input, amount)              // → LoanVerdict ('covers'|'extra'|'costly')
analyseOutcome(analysis)                 // → headline, term balance, SAI reading
buildNextSteps(analysis, outcome)        // → steps, ordered by what skipping costs
```

**2. Work-study is excluded from the runway.**
`spendableCash` reads only the student's cash. A test raises the work-study line
to $9,999 and asserts the runway does not move — work-study is wages for hours
worked, not a lump sum sitting in an account.

**3. No disbursement date means no weekly number.**
`computeRunway` returns `{ status: 'unavailable', reason: 'missing' | 'passed' }`
rather than a figure, and the Money clarity section renders that state beside the
normal one — so the honest empty state is visible on the page itself, not just
described in a doc.

<br />

## Design system

Every value comes from `src/styles/tokens.css`. Components reference tokens; the
built stylesheet contains no off-scale spacing and no raw brand hex outside the
token block.

| | |
|---|---|
| **Colour carries meaning** | Green `#0E7A45` is money kept · gold `#8A6410` is money repaid and estimates · rust `#B4382F` is money with nothing covering it. Never decorative. |
| **Lime `#9CE623` is logo only** | It appears in `public/fynliq-mark.png` and nowhere else. The token is declared for the record and referenced by no rule. |
| **Buttons** | `#1C1D1B` on `#FBFAF8`. No coloured fills, which would compete with what the semantic colours mean. |
| **Paper `#FBFAF8` is the page** | Pure white is used for cards only. |
| **Type** | Plus Jakarta Sans for headings and hero figures, Inter for body at 16px/1.55, JetBrains Mono for every dollar amount. Amounts are tabular and right-aligned in financial columns, via the `Amount` component. |
| **Sizes** | 52 / 40 / 32 / 25 / 21 / 17 / 16 / 15 / 14 / 13 only. |
| **Spacing** | The 4pt scale only; `--s-88` and `--s-112` are composed from it for section rhythm. |
| **Radii** | 14 inputs · 20 cards · 26 hero · 28 sheets · 999 pills. |

<br />

## Motion and state

`cubic-bezier(.32,.72,0,1)` throughout, at 140ms press / 260ms content / 380ms
sheets. Every tappable element presses to `scale(.97)` — buttons, nav links,
chips, copy buttons, glossary rows and the slider thumb.

Loading uses skeletons sized to the content they stand in for, never spinners.
`prefers-reduced-motion: reduce` collapses the durations, stops the skeleton
sweep, disables smooth scrolling and makes revealed sections visible at once.

**No layout shift.** The loan verdict renders all three bands stacked in one grid
cell with the inactive ones `visibility: hidden`, so the panel is always as tall
as the longest wording at any width — measured constant at 969px across all three
bands. Section reveals animate opacity and transform only, and reveal immediately
if they are already on screen when they mount.

<br />

## Accessibility

Semantic landmarks, a skip link, keyboard-operable controls, and a visible 3px
focus ring on every focusable element.

Financial status is never colour alone: each pill and verdict carries a glyph and
a sentence, and the loan slider exposes `aria-valuetext` with the amount and the
verdict so the change is announced as the value moves.

Verified with no horizontal overflow and no console errors at 320, 390, 768,
1024, 1440 and 1920px.

<br />

## Data and disclaimers

Every figure on the page is the prototype's demo student, labelled as demo
figures on screen and in the footer. Nothing is invented: the Get more section
lists categories and the questions to ask, not individual scholarships with
made-up deadlines, and says so on the page. Real listings need a verified data
source.

> Fynliq offers educational guidance only. It is not affiliated with FAFSA,
> Federal Student Aid, the U.S. Department of Education, or any school.

<br />

## Testing

```bash
npm test
```

61 tests across seven suites, covering the two layers where a bug would show a
student a wrong number: the money maths, and the boundary the student's own
figures cross to reach it.

| Suite | Covers |
|---|---|
| `core/__tests__/runway.test.ts` | Runway, safe weekly spend, unavailable states |
| `core/__tests__/aid.test.ts` | Award split into kept / repaid / uncovered |
| `core/__tests__/loan.test.ts` | Loan bands and the accept-up-to ceiling |
| `core/__tests__/money.test.ts` | Currency, deduction and range formatting |
| `core/__tests__/analysis.test.ts` | The headline answer, the term balance, the SAI bands, and the ordering of next steps |
| `beta/__tests__/files.test.ts` | What the upload accepts, and the words it turns a file away with |
| `beta/__tests__/contract.test.ts` | The wire contract — doubles as an executable spec for the backend |

<br />

## Deployment

Deployed on [Vercel](https://vercel.com) as a static Vite build.

```bash
vercel          # preview deployment
vercel --prod   # promote to production
```

Vercel auto-detects the framework: build command `vite build`, output directory
`dist`.

**`/beta` and `/beta/results` are client-side routes with no file behind them**,
so the host has to serve `index.html` for any path — otherwise a refresh or a
shared link on either one is a 404 from the host before the app ever loads.
That rewrite is committed for both hosts: `vercel.json` for Vercel, and
`public/_redirects` for Netlify.

To run against a document reader in development:

```bash
cp .env.example .env.local   # then fill in VITE_FYNLIQ_ANALYZE_URL
npm run dev
```

Screenshots in this README are regenerated with Puppeteer driving the locally
installed Chrome: `docs/screenshots.js` shoots the landing page, and
`docs/beta-screenshots.js` clicks through the beta flow.

The second one doubles as a smoke test. It joins the beta, uploads a file,
analyses it and reads the answer exactly as a student would, and fails on a
console error, on a horizontal overflow at 1440, 768 or 390px, or on a step that
never arrives — including the reload of `/beta/results`, which must fall back to
the upload step rather than show a stale or empty answer.

```bash
npm run build && npm run preview
SHOT_URL=http://localhost:4173 node docs/beta-screenshots.js
```

<br />

---

<div align="center">
<sub>Built with care for students who deserve a straight answer about their own money.</sub>
</div>
