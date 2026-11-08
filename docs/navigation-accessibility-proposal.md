# Navigation accessibility: focus after a page change

| | |
|---|---|
| **Date** | 10 October 2026 |
| **Code inspected** | `docs/frontend-ux-audit` at `49a60e8` (application code identical to `main` at `53fd3a8`) |
| **Relates to** | [Frontend UX audit, finding 2](frontend-ux-audit.md#finding-2-page-changes-are-silent-to-keyboard-and-screen-reader-users--high-accessibility---proposed) |
| **Status** | 💡 Proposed. No application code has been changed. |
| **Not in scope** | URLs, redirects, authentication, the account gate, the paywall, API contracts |

Each statement below is marked with how it was established:

- **[Reproduced]**: observed in headless Chrome against the local `vite` dev server.
- **[Probed]**: the proposed focus behaviour was applied from the test harness to the real app in the browser. This checks how the browser behaves; it does not test the final implementation.
- **[Code]**: established by reading the code only.

---

## 1. Verified root cause

**Client-side navigation never moves focus, and nothing announces the new page.** [Code], confirmed by [Reproduced]

- `navigate()` ([`src/router/router.tsx:61-78`](../src/router/router.tsx#L61-L78)) pushes or replaces the history entry, calls `setPath`, and scrolls to the top or to a fragment. It never touches focus.
- The `popstate` handler ([`router.tsx:80-84`](../src/router/router.tsx#L80-L84)) only calls `setPath`. It also never touches focus.
- `Routes` ([`src/App.tsx:104-284`](../src/App.tsx#L104-L284)) returns a different page component for each route. Each page renders its own shell (`AuthShell`, `FlowShell`, `AppShell`, or the landing page's `Navbar`), so a page change unmounts the whole old tree, including the link that was just activated. When the focused element is removed, the browser moves focus to `<body>`.
- `document.title` is updated ([`App.tsx:195-199`](../src/App.tsx#L195-L199)), but screen readers do not announce a title change in a single-page app. There is no live region for page changes.

**A second form of the same bug:** `/login` ↔ `/signup` render the same `<Auth>` element in the same position, so React reuses it instead of remounting it. Focus therefore stays on the switch link, which now has different text. Focus is not lost, but the new page is not announced either. [Reproduced]

### Reproduced behaviour

Headless Chrome (puppeteer-core, already a dev dependency), 1280×900, local accounts (no `VITE_*` URLs set), keyboard-driven where noted. The scripts were temporary and are not committed.

| Scenario | Path after | `document.activeElement` | Next Tab goes to |
|---|---|---|---|
| Tab to "Join the beta" on `/`, press Enter, signed out (gate redirect) | `/login` | `BODY` | "Skip to content" |
| Tab to "Create one" on `/login`, press Enter | `/signup` | the same `<a>`, now reading "Log in" | n/a |
| Submit sign-up with Enter | `/beta` | `BODY` | "Skip to content" |
| Tab bar "Search", press Enter | `/search` | `BODY` | n/a |
| Browser Back | `/beta` | `BODY` | n/a |
| Browser Forward | `/search` | `BODY` | n/a |
| Signed in, Enter on "Join the beta" | `/beta` | `BODY` | n/a |

The gate's `replace: true` behaved as intended: `history.length` did not grow on the redirect.

---

## 2. Relevant components and code paths

### The router

- **Custom router, no library.** [`src/router/router.tsx`](../src/router/router.tsx) is about 125 lines. It provides `Router`, `useRouter()` and `navigate(to, { replace?, hash? })`.
- **Link clicks.** One delegated `click` listener on `document` ([`router.tsx:86-116`](../src/router/router.tsx#L86-L116)) intercepts plain left-clicks on same-origin anchors. It skips modifier clicks, `target`, `download`, and in-page `#fragment` links. The fragment links keep the browser's native behaviour.
- **Back and forward.** `popstate` → `setPath(currentPath())`. Scroll restoration is left to the browser on purpose ([`router.tsx:73-75`](../src/router/router.tsx#L73-L75)).

### Programmatic navigations (every `navigate()` call)

| Call site | Trigger | `replace` |
|---|---|---|
| [`App.tsx:184`](../src/App.tsx#L184) | Account gate: signed out on `/beta*`, `/search*` or `/ask` → `/login` | yes |
| [`App.tsx:188`](../src/App.tsx#L188) | Orphaned `/beta/results` (no analysis in memory) → `/beta` | yes |
| [`App.tsx:192`](../src/App.tsx#L192) | Unknown `/search/<slug>` → `/search` | yes |
| [`App.tsx:204`](../src/App.tsx#L204) | After log-in or sign-up, and `Resuming` for an already-signed-in visitor on `/login` → the intended page or `/beta` | yes |
| [`App.tsx:143`](../src/App.tsx#L143), [`:150`](../src/App.tsx#L150) | Analysis finished → `/beta/results`; "start again" → `/beta` | no |
| [`App.tsx:123-124`](../src/App.tsx#L123-L124) | `fynliq:clear-private` → `/`; `fynliq:load-document` → `/beta/results` | no |
| [`CheckoutReturn.tsx:41`](../src/pages/CheckoutReturn.tsx#L41) | Automatic, 2.2 s after the unlock is confirmed → `/beta` | yes |
| [`CheckoutReturn.tsx:47`](../src/pages/CheckoutReturn.tsx#L47), [`:73`](../src/pages/CheckoutReturn.tsx#L73) | Unlocked after cancel; "Continue to upload" → `/beta` | yes |
| [`Search.tsx:78`](../src/pages/Search.tsx#L78) | Picking a question → `/search/<slug>` | no |

### How the gate interacts with navigation [Code], confirmed by [Reproduced]

Some navigations arrive in **two hops**. Signed out, Enter on `/beta` goes:

1. `navigate('/beta')`, then `Routes` renders `<Holding>` (a `role="status"` "Checking your account…" with no `<main>` and no heading), or locks straight away.
2. The effect at [`App.tsx:179-185`](../src/App.tsx#L179-L185) runs `navigate('/login', { replace: true })`, and `<Auth>` renders.

The orphaned-results and unknown-slug redirects also hop. On an unknown `/search/<slug>`, `Routes` falls through and renders **`<Landing>` for one commit** before the redirect lands on `/search` [Code]. A naive "focus after every `navigate()`" would focus the wrong page's heading on the first hop and announce two headings.

### Page structure [Code], confirmed by [Probed]

- **Landmarks.** Every shell renders one `<main>` with an id (`#main`, `#account`, `#flow`, `#app`) and a "Skip to content" link that targets it. `BetaAdmin` has a `<main>` with no id. `Holding` has no `<main>`.
- **Headings.** Every route has **exactly one `<h1>`** (checked on `/`, `/login`, `/signup`, `/beta`, `/search`, `/ask`, `/gradi`, `/gradi/start`, `/beta/checkout`).
- **`<h1>` outside `<main>`.** On `/search`, `/gradi` and `/gradi/start`, the `<h1>` is in the `banner` slot, which `AppShell` renders outside `<main>`. A "`main h1`" selector would miss it.
- **Hero heading.** The landing `<h1>` ([`Hero.tsx:39`](../src/components/Hero/Hero.tsx#L39)) has an `aria-label` and animated `aria-hidden` words, so it has a clean accessible name when focused.
- **Focus styling.** One global rule, `:focus-visible { outline: 3px solid var(--green); outline-offset: 3px }` ([`base.css:72-76`](../src/styles/base.css#L72-L76)).
- **Reduced motion.** `html { scroll-behavior: smooth }`, switched to `auto` under `prefers-reduced-motion: reduce` ([`base.css:104-115`](../src/styles/base.css#L104-L115)). Confirmed in the browser: it reads `auto` when reduced motion is emulated.
- **Existing focus management.** Focus is moved only for form errors (`Auth.tsx:142-159`) and for click handlers (`SearchField`, `AskFynliq`). No page focuses anything on mount, and nothing uses `autoFocus`.
- **Existing live regions.** Each one covers a state change within a page (form messages, analysing, checkout status, `Holding`). None covers a page change.

---

## 3. Proposed implementation

### The change in one sentence

When the route path changes, through `navigate()` or Back/Forward, move focus to the new page's `<h1>` once that page is on screen, without scrolling. Add no live region.

### Why this shape

| Decision | Reason |
|---|---|
| **Focus the `<h1>`, falling back to `<main>`** | One `<h1>` on every route [Probed]. Focusing it makes a screen reader read the page name and "heading level 1". The next Tab goes to the first control of the page, not back to the header. `<main>` covers a moment with no heading (see §4, R3). |
| **`document.querySelector('h1')`, not `main h1`** | Three pages put their `<h1>` outside `<main>` (§2). |
| **No live region** | The audit suggested both focusing the heading and announcing the title. Doing both makes the screen reader say the page name twice. Focus alone announces it. |
| **Only when the path changes** | `navigate()` to the page you are already on (for example, `fynliq:clear-private` on `/`) keeps today's behaviour: it scrolls to the top and does nothing else. |
| **Also on Back/Forward** | Back and Forward currently drop focus to `<body>` [Reproduced]. With `preventScroll: true`, the browser's restored scroll position is untouched: probed at 1500px before and after [Probed]. The next Tab would start from the top either way; today it goes to "Skip to content". This changes how Back/Forward differs from the audit's original suggestion, which excluded them. |
| **Wait until the destination path is rendered** | This avoids the two-hop problem in §2. Focus moves once, on the final page of a redirect chain. |
| **Leave alone any focus the page set itself** | If anything other than `<body>`, or the element focused when the navigation started, has focus by then, the page chose it, so it stays. Nothing does this today; the check keeps a future `autoFocus` working. |
| **`preventScroll: true`** | The router already owns scrolling (scroll to top, scroll to fragment, browser restoration). Focus must not add a second scroll, which matters under reduced motion and with the fixed navbar's `scroll-padding-top`. |
| **`tabindex="-1"` set by the router, not in 12 page files** | One change instead of one per page. The heading can take focus from a script but is never a Tab stop. |
| **No new CSS** | The global `:focus-visible` ring already applies. Chrome showed it after keyboard navigation and hid it after a mouse click [Probed]. That matches how links and buttons behave today. |

### Code sketch for `src/router/router.tsx`

This is a sketch for review, not applied. The names follow the file's style.

```tsx
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

interface PendingFocus {
  /** The page being navigated to. A redirect overwrites it. */
  to: Path;
  hash: string;
  /** What had focus when the navigation started. */
  from: Element | null;
}

interface RouterValue {
  path: Path;
  navigate: (to: Path, options?: NavigateOptions) => void;
  /** Read by `useRouteFocus`; nothing else should touch it. */
  pendingFocus: React.MutableRefObject<PendingFocus | null>;
}

export function Router({ children }: { children: React.ReactNode }) {
  const [path, setPath] = useState<Path>(currentPath);
  const shown = useRef(path);
  const pendingFocus = useRef<PendingFocus | null>(null);

  // A change of page, and only a change of page, moves focus.
  const arrive = useCallback((next: Path, hash: string) => {
    if (next !== shown.current) {
      pendingFocus.current = { to: next, hash, from: document.activeElement };
    }
    shown.current = next;
    setPath(next);
  }, []);

  const navigate = useCallback((to: Path, options: NavigateOptions = {}) => {
    // ...unchanged history logic...
    arrive(next, hash);            // replaces setPath(next)
    // ...unchanged scroll logic...
  }, [arrive]);

  useEffect(() => {
    const onPop = () => arrive(currentPath(), window.location.hash);
    // ...
  }, [arrive]);

  // ...click listener unchanged...

  return (
    <RouterContext.Provider value={{ path, navigate, pendingFocus }}>{children}</RouterContext.Provider>
  );
}

/**
 * Moves focus to the new page's heading after a change of page.
 *
 * Called once, by whatever renders the pages. It runs after every render
 * of that component, but does nothing unless a navigation is waiting. It
 * waits until the path being navigated to is the one on screen, so a gate
 * redirect is announced once, on the page it lands on.
 */
export function useRouteFocus() {
  const { path, pendingFocus } = useRouter();

  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending || pending.to !== path) return;

    const fragment = pending.hash ? document.getElementById(pending.hash.slice(1)) : null;
    const target = fragment ?? document.querySelector('h1') ?? document.querySelector('main');
    // The account check is still drawing nothing; the next render tries again.
    if (!target) return;

    pendingFocus.current = null;

    // The new page put focus somewhere on purpose. Leave it there.
    const active = document.activeElement;
    if (active && active !== document.body && active !== pending.from) return;

    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    (target as HTMLElement).focus({ preventScroll: true });
  });
}
```

### Change to `src/App.tsx`

One line in `Routes`, after the existing redirect and title effects: `useRouteFocus();`.

### What does not change

URLs, `replace` flags, the click listener's rules, the scroll behaviour, the gate list, `intended`, `Holding`, `Resuming`, auth, billing and the paywall. There are no new dependencies and no configuration changes.

### Fragment navigations

The fragment branch is defensive. No link in the codebase today points to `/<other-page>#fragment`. In-page `#fragment` links never reach the router (`router.tsx:100`) [Code]. If one is added, focus goes to the fragment's element, which matches native fragment navigation.

---

## 4. Potential regressions, and how to test them

| # | Risk | Likelihood | How to test |
|---|---|---|---|
| R1 | **Focus taken during state changes on the same page** (analysing stages, form errors, billing refresh, search typing) | Low. Focus moves only when the path changes and a navigation is waiting. | On `/beta`, add a file and analyse: focus must stay on the control used until the route changes. Submit a bad log-in: focus must still go to the first bad field. Type in search: the input keeps focus. |
| R2 | **Two announcements across a redirect** (gate, orphaned results, unknown slug, `Resuming`) | Low. The path check waits for the final page. | Signed out, Enter on `/beta`: focus lands on "Welcome back" once. Visit `/search/not-a-question`: focus lands on the Search `<h1>`, never the landing `<h1>`. With a screen reader, listen for exactly one heading announcement. |
| R3 | **`/beta` while billing loads.** The page renders `FlowShell` with empty `<main>` ([`BetaUpload.tsx:137`](../src/pages/BetaUpload.tsx#L137)), so focus goes to `<main>`. If the account is locked, `<UnlockMyAid>` replaces that tree, `<main>` is remounted, and focus falls back to `<body>`. | Only in production with the paywall or pilot on. [Code], **not reproduced**: local runs have no billing endpoint. | Covered in §6. Test with `PAYWALL_ENABLED` or `PAYWALL_PILOT_EMAILS` on a preview deployment. |
| R4 | **Back/Forward scroll restoration broken** | Low. `preventScroll: true` keeps the restored scroll position [Probed]. | Scroll `/` to the bottom, open `/beta`, press Back. The scroll position must be restored, and focus must be on the hero `<h1>`. Repeat in Firefox and Safari. |
| R5 | **History entries changed** | None. History calls are untouched. | `history.length` before and after each gate redirect (unchanged with `replace`). Back from `/login` after a gate redirect goes to the page before the gated link. |
| R6 | **Heading focus ring looks wrong or is clipped** (large hero `<h1>`, dark banners on Search and Gradi, `outline-offset` inside a container with `overflow: hidden`) | Medium, visual only. **Not checked visually yet.** | Screenshot each route after keyboard navigation at 320, 390, 768 and 1440px. Contrast of the ring on dark banners was already measured at 3.56:1 (audit). |
| R7 | **A mouse click on heading text focuses the `<h1>`** (because it has `tabindex="-1"`) | Harmless: the ring does not show for a mouse focus [Probed]. Text selection still works. | Click and drag across the hero heading: text selects and no ring appears. |
| R8 | **Automatic checkout advance** (2.2 s timer → `/beta`) moves focus without a keypress | Intended. The page really changes, and today focus falls to `<body>`. | Tab to "Continue to upload" and wait: focus lands on the upload `<h1>`. |
| R9 | **React StrictMode runs effects twice in development** | None. The second run finds nothing waiting. | Covered by the dev-server runs. |
| R10 | **Stuck pending focus**: a navigation away and straight back in one batch leaves the path unchanged, so nothing renders and a later render could take focus | No current trigger [Code]. | Reviewed by reading the code. Add a test if a future flow can bounce A→B→A in one tick. |

---

## 5. Required browser and keyboard tests

### Automated browser test (puppeteer-core, already installed)

Proposed file: `test/navigation-focus.mjs`, alongside `test/beta-integration.mjs`, run against `npm run dev` or `npm run preview`. Adding an `npm run test:a11y` script is a `package.json` change, so it needs the client's agreement. Until then, run it with `node test/navigation-focus.mjs`. Unit tests in Vitest cannot cover this: there is no DOM environment (no jsdom or happy-dom), and adding one is a new dependency.

For each case, assert `document.activeElement`, whether it matches `:focus-visible`, `location.pathname`, `history.length`, `scrollY`, and the next Tab stop.

1. **Gate, keyboard.** Signed out, Tab to "Join the beta" and press Enter. Expect `/login`, focus on the `<h1>` "Welcome back", the ring visible, the next Tab on the email input, and `history.length` +1 (not +2).
2. **Login ↔ signup.** Enter on "Create one". Expect focus on the `<h1>` "Create your account", not on the switch link.
3. **Sign-up with Enter** → `/beta`. Expect focus on "Upload your aid summary", and the next Tab on the dropzone.
4. **Intended destination.** Signed out, open `/ask`, then log in. Expect `/ask` with focus on its `<h1>`.
5. **`Resuming`.** Signed in, open `/login`. Expect `/beta` with focus on its `<h1>`, and no announcement for the log-in page.
6. **Orphaned results.** Signed in, load `/beta/results`. Expect `/beta`. On a full page load, focus is the browser's, so nothing should be focused. Then navigate in the app from `/beta/results` to check the client-side path.
7. **Unknown slug.** Navigate in the app to `/search/nope`. Expect `/search`, with focus on the Search `<h1>`, never the landing `<h1>`.
8. **Tab bar.** Move between `/beta`, `/search` and `/ask`. Each lands on its own `<h1>`. Check `/search`, `/gradi` and `/gradi/start` especially, where the `<h1>` is outside `<main>`.
9. **Search pick.** Type, pick a suggestion with Enter. Expect `/search/<slug>` with focus on the question `<h1>`.
10. **Back/Forward.** Scroll `/` to 1500px, go to `/beta`, then Back. Expect `scrollY` ≈ 1500 and focus on the hero `<h1>`. Then Forward: focus on the upload `<h1>`.
11. **No change on the same page.** On `/beta`, add a file and start analysing. Focus must not move to the `<h1>` at any stage. A failed log-in still focuses the first bad field.
12. **Mouse.** Click a nav link. Focus moves to the `<h1>` and `:focus-visible` is false, so no ring.
13. **Modifier clicks untouched.** Ctrl-click and middle-click on an internal link do not navigate the current tab.
14. **In-page anchors untouched.** On `/`, Enter on "See how it works" (`#clarity`) scrolls natively, and the router does not take focus.
15. **Reduced motion.** Repeat 1, 3 and 10 with `prefers-reduced-motion: reduce` emulated. Expect no smooth scroll and the same focus results.
16. **Console clean.** No console errors or page errors in any case, which follows the existing harness convention.
17. **Widths.** Run 1, 3 and 8 at 320, 390, 768 and 1440px, and screenshot the focus ring (R6).

### Manual keyboard and screen-reader pass

| Pairing | What to check |
|---|---|
| NVDA + Chrome (Windows) | Exactly one announcement per page change: "<heading>, heading, level 1". Nothing read twice across the gate redirect. |
| VoiceOver + Safari (macOS) | Same. Also check Back/Forward. Safari supports `preventScroll` from version 15. |
| VoiceOver + Safari (iOS) | After a tab bar tap, VoiceOver's cursor moves to the heading. The fixed tab bar does not hide the focused heading. |
| TalkBack + Chrome (Android) | Same as iOS. |
| Keyboard only, Firefox | The ring shows on the heading after Enter on a link and not after a mouse click. The next Tab is the first control of the page. "Skip to content" can still be reached with Shift+Tab. |
| Keyboard only, Chrome at 200% zoom | The focused heading is visible, and the ring is not clipped. |

### Regression pass on the gate, auth and paywall (no behaviour may change)

Run these after the change and compare with `main`:

- `npm test` passes.
- `npm run test:beta` passes. `npm run test:billing` passes where its environment is available.
- Each existing `docs/*-screenshots.js` harness completes. They double as smoke tests of the full flow.

---

## 6. Open items and blockers

1. **R3 cannot be reproduced locally.** The locked-account swap to `UnlockMyAid` needs a billing endpoint with the paywall or pilot on. It needs a preview deployment with `PAYWALL_PILOT_EMAILS`. The cleanest fix is the audit's finding 3(a): give the loading state the same structure as the page it becomes. This proposal does not depend on it. Without it, that one path keeps today's behaviour after billing resolves.
2. **Heading text outside `<main>` on three pages.** It does not block this change, because the target is the first `<h1>` in the document. It is still a landmark issue for screen-reader users who jump by landmark. Fixing it means moving `AppShell`'s `banner` inside `<main>` or giving it a `role="region"` with a label. That is a separate change.
3. **Existing scroll behaviour, noted rather than changed.** `window.scrollTo({ behavior: 'auto' })` in `navigate()` follows the CSS `scroll-behavior`, which is `smooth` unless reduced motion is set. A new page can therefore glide to the top. This proposal adds no motion. Changing `'auto'` to `'instant'` would be a separate, one-word decision.
4. **Confirmations needed before coding.** Two decisions are needed:
   - whether Back/Forward should move focus, as recommended here, or be excluded, as the audit first suggested;
   - whether the client agrees to adding `test/navigation-focus.mjs` and, optionally, an npm script for it.
