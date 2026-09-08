/**
 * Shared motion plumbing.
 *
 * Everything scroll-driven on this page funnels through one rAF loop and one
 * passive scroll listener, rather than each component adding its own. The
 * subscribers write CSS custom properties straight onto their elements, so a
 * scroll never triggers a React render.
 */

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

type Frame = () => void;

const subscribers = new Set<Frame>();
let frame = 0;

function run() {
  frame = 0;
  for (const fn of subscribers) fn();
}

function schedule() {
  if (frame === 0) frame = requestAnimationFrame(run);
}

/**
 * Calls `fn` once now, then on every animation frame following a scroll or
 * resize. Returns an unsubscribe function.
 */
export function onScrollFrame(fn: Frame): () => void {
  if (subscribers.size === 0) {
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
  }
  subscribers.add(fn);
  fn();

  return () => {
    subscribers.delete(fn);
    if (subscribers.size === 0) {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }
  };
}

export const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Rounds to 4dp so we are not writing a fresh string on every sub-pixel move. */
export const q = (n: number) => Math.round(n * 1e4) / 1e4;
