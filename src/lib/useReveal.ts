import { useEffect, useRef, useState } from 'react';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Reveals an element once it scrolls into view.
 *
 * The element is laid out at full size from the first paint and only its
 * opacity and a 12px offset animate, so revealing never shifts the layout.
 * Under `prefers-reduced-motion: reduce` it is visible immediately and no
 * observer is created at all.
 */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(() => prefersReducedMotion());

  useEffect(() => {
    if (shown) return;

    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }

    // Already on screen at mount — a tall viewport, a deep link, a restored
    // scroll position. Show it now rather than waiting for a callback that
    // may never come.
    if (node.getBoundingClientRect().top < window.innerHeight) {
      setShown(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          observer.disconnect();
        }
      },
      // Threshold 0: any sliver counts. A section can be taller than the
      // viewport, and requiring a ratio of a very tall element is the kind of
      // thing that leaves a block stuck invisible after an anchor jump.
      { rootMargin: '0px 0px -12% 0px', threshold: 0 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [shown]);

  return { ref, shown };
}
