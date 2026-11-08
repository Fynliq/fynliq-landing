import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/**
 * A router in sixty lines, because the site has three routes and a stated rule
 * against pulling in a library for something this size.
 *
 * The one idea worth knowing: navigation is intercepted with a single
 * delegated click listener rather than a `<Link>` component. Every
 * `<a href="/beta">` already on the page — including the ones inside `Button`,
 * `Navbar` and `Footer` — routes client-side without being rewritten, and an
 * anchor still behaves like an anchor for middle-click, ctrl-click and
 * "open in new tab".
 */

export type Path = string;

interface NavigateOptions {
  /** Replaces the current entry instead of pushing a new one. */
  replace?: boolean;
  /** A `#fragment` to scroll to once the destination has painted. */
  hash?: string;
}

/** A change of page whose heading has not been given focus yet. */
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

const RouterContext = createContext<RouterValue | null>(null);

/** `/beta/` and `/beta` are the same route. `/` stays `/`. */
function normalise(pathname: string): Path {
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

const currentPath = (): Path =>
  typeof window === 'undefined' ? '/' : normalise(window.location.pathname);

/**
 * Scrolls to a fragment after the destination has mounted.
 *
 * Two frames, not one: the first lets React commit the new route, the second
 * lets the browser lay it out. Without the wait the target element does not
 * exist yet and the jump is silently dropped.
 */
function scrollToHash(hash: string) {
  const id = hash.replace(/^#/, '');
  if (!id) return;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ block: 'start' });
    });
  });
}

export function Router({ children }: { children: React.ReactNode }) {
  const [path, setPath] = useState<Path>(currentPath);
  const shown = useRef(path);
  const pendingFocus = useRef<PendingFocus | null>(null);

  // A change of page, and only a change of page, moves focus. Navigating to
  // the page already on screen scrolls to the top as before and nothing more.
  const arrive = useCallback((next: Path, hash: string) => {
    if (next !== shown.current) {
      pendingFocus.current = { to: next, hash, from: document.activeElement };
    }
    shown.current = next;
    setPath(next);
  }, []);

  const navigate = useCallback((to: Path, options: NavigateOptions = {}) => {
    const next = normalise(to);
    const hash = options.hash ?? '';
    const unchanged = next === currentPath() && hash === window.location.hash;

    if (!unchanged) {
      const url = `${next}${hash}`;
      window.history[options.replace ? 'replaceState' : 'pushState']({}, '', url);
    }

    arrive(next, hash);

    // A fresh route starts at the top. The browser restores scroll on back
    // and forward by itself, which is why this only runs on an explicit
    // navigation and not in the popstate handler.
    if (hash) scrollToHash(hash);
    else window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [arrive]);

  useEffect(() => {
    // Back and forward change the page too, so they move focus as well; the
    // focus never scrolls, which leaves the browser's restored offset alone.
    const onPop = () => arrive(currentPath(), window.location.hash);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [arrive]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      // Anything but a plain left click is the browser's business, not ours.
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = (event.target as Element | null)?.closest?.('a');
      if (!anchor) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;

      const href = anchor.getAttribute('href');
      if (!href) return;
      // In-page fragments keep the native smooth scroll from base.css.
      if (href.startsWith('#')) return;

      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;

      event.preventDefault();
      navigate(url.pathname, { hash: url.hash });
    };

    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [navigate]);

  return (
    <RouterContext.Provider value={{ path, navigate, pendingFocus }}>{children}</RouterContext.Provider>
  );
}

export function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (!value) throw new Error('useRouter must be used inside <Router>');
  return value;
}

/**
 * Moves focus to the new page's heading after a change of page.
 *
 * Without it, the link that was just followed unmounts with the old page and
 * focus falls to `<body>`: a screen reader says nothing and the next Tab
 * starts from the top. Focusing the `<h1>` announces the page by name, once,
 * so there is deliberately no live region repeating the title.
 *
 * Called once, by whatever renders the pages. It runs after every render of
 * that component and does nothing unless a navigation is waiting. It waits
 * until the path being navigated to is the one on screen, so a gate redirect
 * is announced on the page it lands on rather than on the one it passed.
 */
export function useRouteFocus() {
  const { path, pendingFocus } = useRouter();
  const release = useRef<(() => void) | null>(null);

  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending || pending.to !== path) return;

    // The first `<h1>`, not `main h1`: three pages draw theirs in a banner
    // above `<main>`.
    const fragment = pending.hash ? document.getElementById(pending.hash.slice(1)) : null;
    const target = fragment ?? pageHeading();
    // The account check is still drawing nothing; the next render tries again.
    if (!target) return;

    pendingFocus.current = null;

    // The new page put focus somewhere on purpose. Leave it there.
    const active = document.activeElement;
    if (active && active !== document.body && active !== pending.from) return;

    release.current?.();
    placeFocus(target);
    release.current = followHeading(target, pendingFocus);
  });

  useEffect(() => () => release.current?.(), []);
}

/** How long a page has to settle before its heading is left to itself. */
const SETTLE_MS = 4000;

const pageHeading = (): HTMLElement | null => {
  const found = document.querySelector('h1') ?? document.querySelector('main');
  return found instanceof HTMLElement ? found : null;
};

function placeFocus(target: HTMLElement) {
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
}

/**
 * Keeps focus on the heading while the page settles.
 *
 * `/beta` swaps its own contents straight after arriving: the billing check
 * starts once the page is up, replaces the upload card with an empty shell,
 * then puts it back or shows the unlock step instead. Each swap unmounts the
 * heading that had focus, and focus falls to `<body>`. Until then, focus
 * follows the page's heading. It only does that while nothing else has
 * focus, meaning focus is on `<body>` or on the `<main>` stand-in. It stops
 * at the first key press or touch, at the next navigation, or after
 * `SETTLE_MS`.
 */
function followHeading(
  placed: HTMLElement,
  pendingFocus: React.MutableRefObject<PendingFocus | null>,
): () => void {
  let held = placed;

  const observer = new MutationObserver(() => {
    if (pendingFocus.current) return stop();
    const active = document.activeElement;
    // Only the `<main>` stand-in gives way to a heading; a fragment target
    // the navigation asked for is left where it is.
    const ours = active === held && held.tagName === 'MAIN';
    if (active !== document.body && !ours) {
      // Still on the heading we placed, or the page or visitor chose something.
      if (active !== held) stop();
      return;
    }
    const next = pageHeading();
    if (next && next !== active) {
      placeFocus(next);
      held = next;
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  const timer = window.setTimeout(stop, SETTLE_MS);
  const interrupts = ['keydown', 'pointerdown'] as const;
  interrupts.forEach((type) => window.addEventListener(type, stop, true));

  function stop() {
    observer.disconnect();
    window.clearTimeout(timer);
    interrupts.forEach((type) => window.removeEventListener(type, stop, true));
  }

  return stop;
}
