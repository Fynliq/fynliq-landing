import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from './motion';

/** Expo out — the figure arrives fast, then settles onto its true value. */
const easeOut = (t: number) => 1 - Math.pow(2, -10 * t);

/**
 * Counts a figure up to its real value the first time it scrolls into view.
 *
 * The value passed in is the one the maths in `core/` produced; the animation
 * only ever approaches it and always lands exactly on it. Under reduced
 * motion, or without an observer, the figure is simply correct from the first
 * paint and no animation runs.
 */
export function useCountUp(value: number, format: (n: number) => string, enabled = true) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (!enabled || prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
      node.textContent = format(value);
      return;
    }

    let frame = 0;
    let started = false;

    const start = () => {
      if (started) return;
      started = true;
      const begin = performance.now();
      const duration = 1100;

      const step = (now: number) => {
        const t = Math.min(1, (now - begin) / duration);
        if (t >= 1) {
          // Land on the exact figure, never on a rounded approximation of it.
          node.textContent = format(value);
          frame = 0;
          return;
        }
        node.textContent = format(Math.round(value * easeOut(t)));
        frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    };

    node.textContent = format(0);

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          start();
          observer.disconnect();
        }
      },
      { threshold: 0.4 },
    );

    if (node.getBoundingClientRect().top < window.innerHeight) start();
    else observer.observe(node);

    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [value, format, enabled]);

  return ref;
}
