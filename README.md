# Fynliq Beta — landing pages

A responsive landing experience for the Fynliq beta, built to the Fynliq Beta
Design Handoff and matching the beta prototype's product language.

```
npm install
npm run dev       # http://localhost:5173
npm run build     # typecheck + production build to dist/
npm run preview   # serve the production build
npm test          # the money maths
```

## Stack

Vite + React + TypeScript, plain CSS with CSS Modules. No Tailwind, no CSS-in-JS,
no UI library. The repository was empty, so nothing existing was displaced.

```
src/
  core/           Money maths as pure, tested functions
  data/demo.ts    The one demo student, used by every preview
  styles/         Design tokens and base layer
  components/
    ui/           Amount, Pill, Button, Card, Bar, Section, Skeleton, Logo
    Navbar/ Hero/ ProductPreview/ MoneyMetric/ FinancialCard/ AidBreakdown/
    LoanDecision/ GetMore/ TaskList/ AskPreview/ TrustSection/ CTA/ Footer/
  lib/            useReveal, useCopy
```

## The three rules from the handoff

**1. All money maths lives in `core/` as tested pure functions.** Nothing in a
component computes a dollar figure. The runway, the weekly safe-to-spend, the
award split and the loan verdict are `if` statements and division in
`core/runway.ts`, `core/aid.ts` and `core/loan.ts`, covered by 23 tests. The
landing page renders whatever those functions return, so the figures on the page
and the figures in the app cannot drift apart.

**2. Work-study is excluded from the runway.** `spendableCash` reads only the
student's cash. A test raises the work-study line to $9,999 and asserts the
runway does not move.

**3. No disbursement date means no weekly number.** `computeRunway` returns
`{ status: 'unavailable', reason: 'missing' | 'passed' }` rather than a figure,
and the Money clarity section renders that state beside the normal one so the
honest empty state is visible on the page itself, not just described.

## Design system

Every value comes from `src/styles/tokens.css`. Components reference tokens; the
built stylesheet contains no off-scale spacing and no raw brand hex outside the
token block.

- **Colour carries meaning.** Green `#0E7A45` is money kept, gold `#8A6410` is
  money repaid and estimates, rust `#B4382F` is money with nothing covering it.
  They are never decorative. The loan slider is the clearest case: the verdict
  moves green → gold → rust as the student steps past what they owe, and the
  colour *is* the advice.
- **Lime `#9CE623` is logo only.** It appears in `public/fynliq-mark.png` and
  nowhere else. The token is declared for the record and referenced by no rule.
- **Buttons are `#1C1D1B` on `#FBFAF8`.** No coloured fills, which would compete
  with what the semantic colours mean.
- **Paper `#FBFAF8` is the page.** Pure white is used for cards only.
- **Type:** Plus Jakarta Sans for headings and hero figures, Inter for body at
  16px/1.55, JetBrains Mono for every dollar amount. Amounts are tabular and
  right-aligned in financial columns, via the `Amount` component.
- **Sizes:** 52/40/32/25/21/17/16/15/14/13 only. **Spacing:** the 4pt scale only;
  `--s-88` and `--s-112` are composed from it for section rhythm.
- **Radii:** 14 inputs · 20 cards · 26 hero · 28 sheets · 999 pills.

## Motion and state

`cubic-bezier(.32,.72,0,1)` throughout, at 140ms press / 260ms content /
380ms sheets. Every tappable element presses to `scale(.97)` — buttons, nav
links, chips, copy buttons, glossary rows and the slider thumb.

Loading uses skeletons sized to the content they stand in for, never spinners.
`prefers-reduced-motion: reduce` collapses the durations, stops the skeleton
sweep, disables smooth scrolling and makes revealed sections visible at once.

**No layout shift.** The loan verdict renders all three bands stacked in one grid
cell with the inactive ones `visibility: hidden`, so the panel is always as tall
as the longest wording at any width — measured constant at 969px across all
three bands. Section reveals animate opacity and transform only, and reveal
immediately if they are already on screen when they mount.

## Accessibility

Semantic landmarks, a skip link, keyboard-operable controls, and a visible
3px focus ring on every focusable element. Financial status is never colour
alone: each pill and verdict carries a glyph and a sentence, and the loan slider
exposes `aria-valuetext` with the amount and the verdict so the change is
announced as the value moves. Verified with no horizontal overflow and no
console errors at 320, 390, 768, 1024, 1440 and 1920px.

## Data

Every figure on the page is the prototype's demo student, labelled as demo
figures on screen and in the footer. Nothing is invented: the Get more section
lists categories and the questions to ask, not individual scholarships with
made-up deadlines, and says so. Real listings need a verified data source.
