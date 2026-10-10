# Frontend UX audit

| | |
|---|---|
| **Audit date** | 10 October 2026 |
| **Code audited** | `main` at `53fd3a8`, plus the log-in copy change in PR #25 (`54e3c53`) |
| **Last checked against `main`** | 10 October 2026: every file and line reference below still matches `main` at `53fd3a8` |
| **Pages covered** | landing page, log-in, sign-up, the account gate, and `/beta` (My Aid: unlock, upload, analysing, results) |
| **Not in scope** | changing authentication, redirects, the account gate, the paywall, API contracts or the database |

Each item below carries one of three status labels:

- **✅ Implemented — in review:** code written and tested, in an open pull request, not merged.
- **⏳ Pending:** agreed as the next work, not started.
- **💡 Proposed:** recommended, not yet agreed.

---

## 1. Executive summary

This audit looked for the frontend changes that would most improve a student's first visit to Fynliq: signing up, reaching My Aid, and uploading a document. It covered usability, accessibility, responsive layout and conversion. It was done by reading the code, running the test suites, and driving the pages in a headless browser at four screen widths.

**The most important findings:**

1. **The upload button could look broken.** When the AI-processing consent box is unticked, "Analyse my aid" is disabled, but the note beside it says "1 file ready". A student has no way of knowing why they cannot continue, and this is the step where the product actually gets used. **✅ Fixed in PR #26, which is open and not merged.**
2. **Moving between pages is silent for keyboard and screen-reader users.** After each page change, keyboard focus stays on the page body and nothing announces the new page. This affects every page. **💡 Proposed** as the next accessibility fix.
3. **The upload page can be blank while the account's payment status loads.** No message is shown and the request has no time limit. **💡 Proposed.**

There are also four smaller fixes (findings 4, 5, 8 and 9) and three items that need a decision from the client (section 8).

Two repository issues affect how this work lands:

- **PR #26 is open against `feat/search-tabs-gradi`, not `main`.** Its contents are correct, but its base branch should be changed to `main` before it is merged. See [section 9](#9-next-steps).
- **`feat/connect-ask-backend` holds 31 commits that are not in `main`.** This is where PRs #3–#16 were merged. This audit was carried out on `main`, so those changes are not covered. See [section 7](#7-prioritised-roadmap).

---

## 2. Audit scope and methodology

### Files inspected

`App.tsx`, `router/router.tsx`, `pages/Auth.tsx`, `pages/BetaUpload.tsx`, `pages/UnlockMyAid.tsx`, `pages/CheckoutReturn.tsx`, `pages/BetaResults.tsx`, `pages/DocumentResults.tsx`, `pages/SummaryReview.tsx`, `components/beta/*`, `components/nav/*`, `components/auth/*`, `billing/BillingProvider.tsx`, `billing/client.ts`, `beta/analyzer.ts`, `styles/tokens.css`, `styles/base.css`, `README.md`, `package.json`.

### Checks performed

| Method | What it covered |
|---|---|
| **Code reading** | Every file listed above |
| **Unit tests** | `npm test` |
| **Browser checks** | Headless Chrome, driven by `puppeteer-core` (already a dev dependency), against the local `vite` dev server. One run set `VITE_FYNLIQ_ANALYZE_URL` to an unreachable local address so the upload page shows the consent checkbox, as production does. The check scripts were temporary and are not committed. |
| **Colour contrast** | WCAG ratios calculated from the hex values in `tokens.css` |

### Browser routes and viewport widths

| Route | 320px | 390px | 768px | 1440px |
|---|---|---|---|---|
| `/` | ✓ | ✓ | ✓ | ✓ |
| `/login` | ✓ | ✓ | ✓ | ✓ |
| `/signup` | ✓ | ✓ | ✓ | ✓ |
| `/beta` (upload, after sign-up) | ✓ | ✓ | ✓ | ✓ |

At those widths the browser checks recorded:

- horizontal overflow
- keyboard tab order on `/login`
- where focus lands after navigating
- focus after a failed log-in and a failed sign-up
- the consent state on `/beta` with one file added
- interactive targets smaller than 24px at 390px
- the message shown when an analysis fails

---

## 3. Findings and evidence

### Summary

| # | Finding | Where | Severity | Effort | How verified | Status |
|---|---|---|---|---|---|---|
| 1 | Analyse button disabled with no stated reason; consent checkbox 13×13px and unstyled | `/beta` upload | **High** | S | Browser | ✅ PR #26 (open) |
| 2 | Page changes leave focus on `<body>` and are not announced | All routes | **High** (accessibility) | M | Browser | 💡 Proposed |
| 3 | Upload page blank while billing status loads, with no timeout | `/beta` | Medium | S | Code reading | 💡 Proposed |
| 4 | Sign-up "passwords do not match" focuses the password field, not the confirmation field | `/signup` | Medium | XS | Browser | 💡 Proposed |
| 5 | "Back to the site" in the auth header overflows by 2px at 320px | `/login`, `/signup` | Low | XS | Browser | 💡 Proposed |
| 6 | Upload page label reads "Join the beta" for someone who already has an account | `/beta` | Low | XS | Code reading | 💡 Proposed (client copy) |
| 7 | The `$1` unlock is not mentioned before sign-up | Landing → `/beta` | Medium (trust) | S | Code reading | Client decision |
| 8 | `DocumentResults.tsx` and `SummaryReview.tsx` are not imported anywhere | `src/pages/` | Low (maintenance) | XS | Code search | 💡 Proposed |
| 9 | README is out of date: says 221 tests, and "no runtime dependency beyond React" | `README.md` | Low | XS | Code reading + test run | 💡 Proposed |

Severity reflects how many students are affected and how badly. Effort is relative: XS is under an hour, S is half a day, M is one to two days with review.

### Checked and found sound

- **Contrast.** `--low` on paper is 4.84:1, gold on paper 5.15:1, and the green focus ring on `--ink` is 3.56:1. That clears the 3:1 minimum for focus indicators.
- **Overflow.** No page overflows at 390, 768 or 1440px.
- **Keyboard.** Tab order on `/login` is logical, and every stop shows a focus ring.
- **Form errors.** Log-in errors are specific, and focus moves to the first field that needs fixing.
- **Feedback.** File rejections and analysis errors are announced in a live region.
- **Analysing state.** It has named stages, a live status line and a working cancel button.
- **Search.** It has distinct loading, empty and failed states (`pages/Search.tsx:263–304`). This was checked by reading the code only.

---

### Finding 1: the Analyse button is disabled with no explanation · High · ✅ PR #26 (open)

**Where:** [`src/pages/BetaUpload.tsx:191-205`](../src/pages/BetaUpload.tsx#L191-L205) on `main`

**Evidence (browser, 390px, one file added, consent unticked, on `main`):**

```
consentPresent: true
checkboxSize:   13x13          ← native default, below the 24px minimum target
labelClass:     (none)         ← no styling class; 16px body text, 350×124 block
submitDisabled: true
submitDescribedBy: null
noteUnderButton: "1 file ready. This takes a few seconds."
```

**Why every real user sees it:** in production, `createAnalyzer()` defaults to `/api/analyze` (`beta/analyzer.ts`). That makes `analyzer.connected` true, so the consent checkbox is shown.

**What goes wrong:**

- The button is disabled while the box is unticked: `disabled={files.length === 0 || (analyzer.connected && !consent)}`.
- The note under the button only covers the no-file case. Once a file is added, it says "1 file ready" while the button stays disabled.
- The disabled button has no `aria-describedby`, so a screen reader announces it as dimmed and gives no reason.
- The label has no styling and sits flush against the button. The checkbox is 13×13px, and the OpenAI privacy link is 146×20px.

**User impact:** this is the step where the product gets used. A student who has signed up, may have paid `$1`, and has added a document sees a dead button next to a note saying they are ready. Some will retry, reload or leave. On a phone, the 13px checkbox is also hard to hit.

**Approval:** none needed for the fix as built, because the consent wording and the rule for when consent is required are unchanged. The one new sentence is listed in [section 8](#8-client-decisions-required).

---

### Finding 2: page changes are silent to keyboard and screen-reader users · High (accessibility) · 💡 Proposed

**Where:** [`src/router/router.tsx:61-78`](../src/router/router.tsx#L61-L78)

**Evidence (browser):**

- Focusing "Join the beta" on `/` and pressing Enter leads to `/login`, with `document.activeElement` left on `BODY`.
- After a successful sign-up, `/beta` loads with `activeElement` still on `BODY`.

`navigate()` scrolls to the top, and `App.tsx` updates `document.title`. Nothing moves focus or announces the new page, so the next Tab press starts from the top of the document.

**User impact:** after every page change, a keyboard or screen-reader user has to work out where they are. This affects the whole app.

**Recommendation:**

- After a navigation that is not a `#hash` jump or a back/forward step, move focus to the page's `<h1>` (made focusable with `tabIndex={-1}`) or to `<main>`.
- Announce `document.title` in one polite live region.
- Put this in the router or in `Routes`, so every page benefits from one change.

**Risk:** this touches the router that the account gate runs through. It needs a regression pass over the gate redirects, which use `navigate(..., { replace: true })`.

**Approval:** none.

---

### Finding 3: the upload page can stay blank · Medium · 💡 Proposed

**Where:** [`src/pages/BetaUpload.tsx:137`](../src/pages/BetaUpload.tsx#L137), [`src/billing/client.ts:62-71`](../src/billing/client.ts#L62-L71)

**Evidence (code reading only, not reproduced in a browser):**

- While `billing.loading` is true, the page renders `<FlowShell step={1}>{null}</FlowShell>`. That is the header, the step bar and an empty `<main>`, with no visible or announced status.
- `getBillingStatus` calls `fetch` with no timeout. Errors are handled, but a request that never finishes is not.
- The step bar first shows three steps with "Upload" current. For an account on the unlock journey, it then switches to four steps.

**User impact:** on a slow campus or mobile connection, the first thing a new user sees after signing up is an empty page.

**Recommendation, in two independent parts:**

- **(a)** Show a skeleton shaped like the upload card, with a `role="status"` line such as "Getting My Aid ready…". This uses the existing `Skeleton` component. **Approval:** none.
- **(b)** Add a timeout to the billing request that resolves to `null`, which the provider already treats as "behave as before". The server's 402 response remains the real gate. **Approval:** this touches billing code, so it is listed for the client in [section 8](#8-client-decisions-required).

---

### Finding 4: a sign-up mismatch focuses the wrong field · Medium · 💡 Proposed

**Where:** [`src/pages/Auth.tsx:142-143`](../src/pages/Auth.tsx#L142-L143)

**Evidence (browser):** a valid email and password with a mismatched confirmation produce one error, `Those two passwords do not match.`, attached to the confirmation field. But `activeElement` is the `password` field. The code focuses `emailRef`, or otherwise `passwordRef`; the confirmation field has no ref.

**User impact:** focus lands one field above the error, so a screen-reader user hears the password field with no error attached to it.

**Recommendation:** add a `confirmRef` and focus it when the confirmation is the first problem. This only moves focus; it does not change sign-up logic.

**Approval:** none.

---

### Finding 5: the auth header overflows at 320px · Low · 💡 Proposed

**Where:** [`src/components/auth/AuthShell/AuthShell.tsx:33`](../src/components/auth/AuthShell/AuthShell.tsx#L33)

**Evidence (browser):** at 320px, `/login` and `/signup` have `scrollWidth` 322, and the "Back to the site" link ends at x=322. `body { overflow-x: hidden }` hides the scrollbar, but the link's right edge is cut off.

**Recommendation:** `FlowShell` and `AppShell` already hide this text below 600px using `.backLabel` and keep an `aria-label`. Apply the same pattern in `AuthShell`.

**Approval:** none.

---

### Finding 6: "Join the beta" on the upload page · Low · 💡 Proposed

**Where:** [`src/pages/BetaUpload.tsx:143`](../src/pages/BetaUpload.tsx#L143)

**Evidence (code reading):** the small label above "Upload your aid summary" reads "Join the beta" for anyone not on the unlock journey. Everyone on this page is already logged in. The navbar already switches to "My aid" for signed-in users (`Navbar.tsx:78`).

**Recommendation:** change it to "My Aid". `feat/connect-ask-backend` already does this.

**Approval:** client, because it is product copy.

---

### Finding 7: the `$1` unlock first appears after sign-up · Medium (trust) · client decision

**Where:** landing page (`Hero`, `CTA`), sign-up copy in `pages/Auth.tsx`, and `pages/UnlockMyAid.tsx`

**Evidence (code reading):** no landing-page or sign-up text mentions a charge, and the sign-up intro says "no school, no phone number, no card". `UnlockMyAid` is clear about the `$1`, but a student only sees it after creating an account. On `main`, the paywall is off by default (`PAYWALL_ENABLED=false`) and limited to pilot emails.

**User impact:** once the paywall is switched on more widely, "no card" followed by a payment screen can read as a bait-and-switch. That cuts against the product's own principle of not hiding costs.

**Recommendation:** nothing to build until the client decides. See [section 8](#8-client-decisions-required).

---

### Finding 8: unused result pages · Low · 💡 Proposed

**Evidence (code search on `main`):** nothing in `src/` imports `src/pages/DocumentResults.tsx` or `src/pages/SummaryReview.tsx`. `BetaResults.tsx` imports only `SummaryReview.module.css`. Both pages use un-tokenised markup that a later contributor could copy by mistake.

**Recommendation:** confirm with the client that neither page is planned, then delete both in a separate tidy-up PR.

---

### Finding 9: README out of date · Low · 💡 Proposed

**Evidence:**

- The README badge and Testing section say **221** tests. `npm test` on `main` runs **337**, all passing, as checked on 10 October 2026.
- The Stack section says "no runtime dependency beyond React". `package.json` lists `@supabase/supabase-js`, `@vercel/analytics`, `pdfjs-dist` and `tesseract.js`.

**Recommendation:** fix in a docs-only change. The same out-of-date text is also on `feat/connect-ask-backend`.

---

### Environment note (not a UX finding)

In local development, every page load logs a `404` for `POST /api/beta-auth`, an endpoint that only exists on the deployed host. It does not affect the interface, but it makes the console-error checks in `docs/*-screenshots.js` noisy when they run against the dev server.

---

## 4. Recommended improvements

### Completed (implemented and tested, in review)

**Upload consent and disabled-state fix (finding 1).** It is in PR #26 (open, not merged) on branch `fix/upload-consent-state`, commit `6b95df8`. It changes four files:

- `src/pages/BetaUpload.tsx`
- `src/pages/BetaUpload.module.css`
- `src/beta/readiness.ts` (new)
- `src/beta/__tests__/readiness.test.ts` (new)

What it does:

- **A note that names the blocker.** One pure function, `uploadReadiness()`, decides both whether the button is enabled and what the note says, so the two cannot disagree:

  | State | Note |
  |---|---|
  | No files | "Add at least one file to continue." (unchanged) |
  | Files added, consent required, box unticked | **"Tick the box above to continue."** (new) |
  | Ready | "N file(s) ready. This takes a few seconds." (unchanged) |

- **The note is read with the button.** The button carries `aria-describedby` pointing at the note.
- **An easier consent control.** The label is now a full-width row above the button, styled with existing tokens (`--sunk`, `--line2`, `--r-input`). The checkbox is 20px and lines up with the first line of text. The whole label is the click target, at least 44px tall (127px at 390px wide).
- **What it does not change:** the consent wording, the privacy link, when consent is required, and the guard inside `start()`. No auth, billing, routing, API, environment or dependency changes.

### Proposed future changes

| Change | Finding | Approval |
|---|---|---|
| Move focus to the new page and announce it after each navigation | 2 | None |
| Skeleton and status line while billing status loads | 3a | None |
| Timeout on the billing status request | 3b | Client |
| Focus the confirmation field on a password mismatch | 4 | None |
| Hide the "Back to the site" text below 600px in `AuthShell` | 5 | None |
| Change the "Join the beta" label to "My Aid" on the upload page | 6 | Client (copy) |
| Delete `DocumentResults.tsx` and `SummaryReview.tsx` | 8 | Client confirms they are unused |
| Correct the README test count and dependency text | 9 | None |

---

## 5. Implementation status

These pull request statuses were read from GitHub's public API on 10 October 2026.

| PR | Branch → base | What it does | Status |
|---|---|---|---|
| [#25](https://github.com/Fynliq/fynliq-landing/pull/25) | `feat/login-newcomer-prompt` → `main` | Points newcomers to sign-up from the log-in screen (2 files: `Auth.tsx`, `Auth.module.css`) | Open, not merged |
| [#26](https://github.com/Fynliq/fynliq-landing/pull/26) | `fix/upload-consent-state` → **`feat/search-tabs-gradi`** | Upload consent and disabled-state fix (finding 1; 4 files) | Open, not merged. **Its base should be `main`**: see [section 9](#9-next-steps) |

No other finding has a pull request yet.

---

## 6. Testing and limitations

### Automated tests (actually run)

| Branch | `npm test` | `npm run build` | `npm run test:beta` |
|---|---|---|---|
| `main` (`53fd3a8`) | 337 passed (28 files) | Not run for this document | Not run for this document |
| `fix/upload-consent-state` (PR #26) | 342 passed (29 files), including 5 new `uploadReadiness` tests | Passed | 23 passed |

The five new tests cover: no files; files with consent not required; consent required but unticked; consent ticked; and a check that the function enables the button in exactly the same cases as the previous inline condition.

### Browser-tested behaviour

- **The audit findings marked "Browser" in section 3:** checked in headless Chrome against the audited code.
- **PR #26:** 28 of 28 checks passed in headless Chrome, before the PR was opened. They ran against two dev servers, one with consent required and one without, and confirmed:
  - the button is disabled and the note visible while consent is unticked
  - `aria-describedby` points at the note
  - clicking the label text or pressing Space ticks the box and enables the button
  - the label is at least 44px tall at 390px
  - the checkbox lines up with the first text line
  - nothing overflows horizontally at 320, 390, 768 or 1440px
  - with consent not required, no checkbox appears and the button enables as soon as a file is added
  - there are no page errors
- These browser checks were **not re-run** for this documentation update.

### Code-inspection findings (not reproduced in a browser)

- Finding 3: blank page while billing loads
- Finding 6: the "Join the beta" label
- Finding 7: `$1` messaging
- Finding 8: unused pages
- Finding 9: README drift
- Search's loading, empty and failed states

### Not tested

- `/beta/results` layout at any width
- `/search` and `/ask` in a browser
- the `$1` unlock and Stripe return pages (billing is off in local development)
- anything against a production backend, including production authentication
- **screen readers.** The accessibility findings come from browser DOM state (`document.activeElement`, ARIA attributes), not from listening to a screen reader.
- **`feat/connect-ask-backend`.** It has 31 commits and 91 changed files not in `main`, and was only spot-checked; see [section 7](#7-prioritised-roadmap).

### Known remaining issues in PR #26

- The focus ring on the inline "Privacy information" link slightly overlaps the line of text above it. This comes from the site-wide `:focus-visible` style (3px outline, 3px offset) and affects every inline link the same way, so PR #26 leaves it alone.
- `min-height: 44px` is a raw value because the spacing scale has no 44px step. The same file already uses a raw `min-height: 52px` for the submit button.

---

## 7. Prioritised roadmap

| Order | Work | Why this order | Depends on | Risk |
|---|---|---|---|---|
| 1 | **Merge PR #26** after changing its base to `main` | Highest impact; already built and tested | Client review of the new sentence; branch decision below | Low: one page, no logic change |
| 2 | **Focus and announcement on page change** (finding 2) | Affects every page for keyboard and screen-reader users | None | Medium: touches the router the account gate uses, so the gate needs a regression pass |
| 3 | **Skeleton while billing loads** (finding 3a) | First screen after sign-up | None | Low |
| 4 | **Small fixes bundle:** confirmation focus (4), 320px header (5), README (9) | Each is XS, all low risk | None | Low |
| 5 | **Billing timeout** (finding 3b) | Prevents a request that never ends | Client approval | Low to medium: billing code |
| 6 | **Copy and clean-up:** "My Aid" label (6), delete unused pages (8) | Low impact | Client decisions | Low |
| — | **`$1` messaging before sign-up** (finding 7) | Trust, before the paywall widens | Client pricing decision | — |

### Dependency: which branch is the integration line?

`feat/connect-ask-backend` holds 31 commits and 91 changed files that are not in `main`, including PRs #3–#16 (paywall copy, Earn tab, reader totals, preview-before-pay). A spot check of that branch on 10 October 2026 found:

- **Finding 1 is still present there.** The note does not mention the consent box. That branch also has **different consent wording** ("Send only the aid amounts to be read by AI (OpenAI)…") and an extra "locked" version of the note. PR #26 will therefore **conflict** with that branch when the two meet.
- Findings 2, 3, 4, 5, 8 and 9 are present there in the same form. This was checked by reading the code only; that branch was not run in a browser.
- Finding 6 is already fixed there: the label reads "My Aid".

This audit did not check which branch production deploys from. Until that is settled, work that targets `main` may need re-applying on `feat/connect-ask-backend`, or the reverse.

---

## 8. Client decisions required

| # | Decision | Context | Blocks |
|---|---|---|---|
| A | **Approve the new helper sentence "Tick the box above to continue."** | The only new user-facing text in PR #26 | Merging PR #26 |
| B | **Which branch is the integration line**, `main` or `feat/connect-ask-backend`, and which consent wording is final | The two branches have different consent text; PR #26 keeps `main`'s | Where PR #26 and later fixes land |
| C | **Whether to add a timeout to the billing status request** | Technical change to billing code; behaviour on failure is unchanged | Finding 3b |
| D | **How and where to tell students about the `$1` unlock before sign-up** | Pricing and marketing decision; the sign-up page currently says "no card" | Finding 7, and before the paywall widens |
| E | **Change the upload-page label from "Join the beta" to "My Aid"** | Product copy; already changed on `feat/connect-ask-backend` | Finding 6 |
| F | **Confirm `DocumentResults.tsx` and `SummaryReview.tsx` are not planned** | Both are unused on `main` | Finding 8 |

---

## 9. Next steps

**For the supervisor:**

1. **Change PR #26's base to `main`.** On GitHub, use **Edit** next to the PR title and pick `main` as the base. PR #26 currently targets `feat/search-tabs-gradi`. Its diff is still the intended four files, because `feat/search-tabs-gradi` is already contained in `main`, but merging it there would not put the fix on `main`.
2. **Get client decisions A and B** before merging PR #26.
3. **Review and merge PR #25** on its own; it does not depend on PR #26.

**For the development team:**

1. Once decision B is made, bring PR #26 onto the chosen integration branch. If that is `feat/connect-ask-backend`, resolve the consent-wording conflict using whichever wording the client confirms.
2. Start finding 2 (focus on page change) as the next PR, with a regression check of the account-gate redirects.
3. Bundle findings 3a, 4, 5 and 9 as a low-risk follow-up.
4. For each new PR, re-run `npm test`, `npm run build`, `npm run test:beta`, and the browser checks at 320, 390, 768 and 1440px.
5. Before the paywall is widened, add `/beta/results`, `/search`, `/ask`, the unlock flow and a screen-reader pass to the test plan. None of these has been tested yet.
