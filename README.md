<div align="center">

<img src="public/fynliq-mark.png" alt="Fynliq" width="72" />

# Fynliq — Beta Landing Page

**Know what your aid actually leaves you.**

A responsive landing experience for the Fynliq beta — a tool that reads a student's
financial aid award and shows what they keep, what they repay, what nothing is
covering, and how long the money in their account has to last.

[![Live](https://img.shields.io/badge/live-fynliq--landing.vercel.app-000?style=flat-square)](https://fynliq-landing.vercel.app)
[![React](https://img.shields.io/badge/React-18-149ECA?style=flat-square&logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vite.dev)
[![Tests](https://img.shields.io/badge/tests-23%20passing-0E7A45?style=flat-square)](#testing)

**[View the live site →](https://fynliq-landing.vercel.app)**

</div>

<br />

![Fynliq landing page hero](docs/screenshots/01-hero.png)

<br />

## Contents

- [What this is](#what-this-is)
- [Inside the page](#inside-the-page)
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
  data/demo.ts    The one demo student, used by every preview
  styles/         Design tokens and base layer
  components/
    ui/           Amount, Pill, Button, Card, Bar, Section, Skeleton, Logo
    fx/           Aurora, Coin3D, Stage3D, ScrollProgress
    Navbar/ Hero/ ProductPreview/ MoneyMetric/ FinancialCard/ AidBreakdown/
    LoanDecision/ GetMore/ TaskList/ AskPreview/ TrustSection/ CTA/ Footer/
  lib/            useReveal, useCopy, useCountUp, useScrollVar, useTilt, motion
```

Production build: **199 kB JS** (65 kB gzipped) and **42 kB CSS** (9 kB gzipped).

<br />

## Architecture: three rules

**1. All money maths lives in `core/` as tested pure functions.**
Nothing in a component computes a dollar figure. The runway, the weekly
safe-to-spend, the award split and the loan verdict are `if` statements and
division in `core/runway.ts`, `core/aid.ts` and `core/loan.ts`, covered by 23
tests. The landing page renders whatever those functions return, so the figures
on the page and the figures in the app cannot drift apart.

```ts
computeRunway(input, award)   // → RunwayReady | RunwayUnavailable
breakDownAward(award)         // → { kept, repaid, uncovered, … }
evaluateLoan(input, amount)   // → LoanVerdict ('covers' | 'extra' | 'costly')
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

23 tests across four suites, covering the money maths only — the layer where a
bug would show a student a wrong number.

| Suite | Covers |
|---|---|
| `core/__tests__/runway.test.ts` | Runway, safe weekly spend, unavailable states |
| `core/__tests__/aid.test.ts` | Award split into kept / repaid / uncovered |
| `core/__tests__/loan.test.ts` | Loan bands and the accept-up-to ceiling |
| `core/__tests__/money.test.ts` | Currency, deduction and range formatting |

<br />

## Deployment

Deployed on [Vercel](https://vercel.com) as a static Vite build.

```bash
vercel          # preview deployment
vercel --prod   # promote to production
```

Vercel auto-detects the framework: build command `vite build`, output directory
`dist`. No configuration file is required.

Screenshots in this README are regenerated from the live site with
`docs/screenshots.js` (Puppeteer driving the locally installed Chrome).

<br />

---

<div align="center">
<sub>Built with care for students who deserve a straight answer about their own money.</sub>
</div>
