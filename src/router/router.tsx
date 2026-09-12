import { createContext, useCallback, useContext, useEffect, useState } from 'react';

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

interface RouterValue {
  path: Path;
  navigate: (to: Path, options?: NavigateOptions) => void;
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

  const navigate = useCallback((to: Path, options: NavigateOptions = {}) => {
    const next = normalise(to);
    const hash = options.hash ?? '';
    const unchanged = next === currentPath() && hash === window.location.hash;

    if (!unchanged) {
      const url = `${next}${hash}`;
      window.history[options.replace ? 'replaceState' : 'pushState']({}, '', url);
    }

    setPath(next);

    // A fresh route starts at the top. The browser restores scroll on back
    // and forward by itself, which is why this only runs on an explicit
    // navigation and not in the popstate handler.
    if (hash) scrollToHash(hash);
    else window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, []);

  useEffect(() => {
    const onPop = () => setPath(currentPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

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

  return <RouterContext.Provider value={{ path, navigate }}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (!value) throw new Error('useRouter must be used inside <Router>');
  return value;
}
