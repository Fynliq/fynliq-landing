import { useEffect, useRef } from 'react';
import { clamp01, onScrollFrame, prefersReducedMotion, q } from './motion';

/**
 * Publishes the element's travel through the viewport as a `--p` custom
 * property on that element, from 0 (its top is about to enter at the bottom)
 * to 1 (its bottom has just left at the top).
 *
 * CSS reads `--p` to drive parallax, depth and rotation. Nothing re-renders.
 * Under reduced motion `--p` is pinned to 0.5 — the neutral, mid-travel pose —
 * so any transform built on it resolves to its resting state.
 */
export function useScrollVar<T extends HTMLElement>(property = '--p') {
  const ref = useRef<T>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (prefersReducedMotion()) {
      node.style.setProperty(property, '0.5');
      return;
    }

    return onScrollFrame(() => {
      const rect = node.getBoundingClientRect();
      const span = window.innerHeight + rect.height;
      if (span <= 0) return;
      const travelled = window.innerHeight - rect.top;
      node.style.setProperty(property, String(q(clamp01(travelled / span))));
    });
  }, [property]);

  return ref;
}
