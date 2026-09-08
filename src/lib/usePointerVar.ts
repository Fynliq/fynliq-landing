import { useEffect, useRef } from 'react';
import { clamp01, prefersReducedMotion, q } from './motion';

/**
 * Tracks the pointer across an element and publishes its position as the CSS
 * custom properties `--px` and `--py`, both 0..1.
 *
 * The value is eased toward the pointer rather than snapped to it, so a light
 * that follows the cursor trails slightly instead of sticking to it. The loop
 * runs only while there is distance left to close, and writes custom
 * properties directly, so moving the mouse never triggers a React render.
 *
 * Does nothing on coarse pointers — a highlight that tracks a finger is a
 * highlight sitting under the finger — or under reduced motion.
 */
export function usePointerVar<T extends HTMLElement>(ease = 0.12) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const fine =
      typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;
    if (!fine || prefersReducedMotion()) return;

    // Start centred so the light is somewhere sensible before first contact.
    let targetX = 0.5;
    let targetY = 0.5;
    let x = 0.5;
    let y = 0.5;
    let frame = 0;

    const write = () => {
      el.style.setProperty('--px', String(q(x)));
      el.style.setProperty('--py', String(q(y)));
    };

    const loop = () => {
      x += (targetX - x) * ease;
      y += (targetY - y) * ease;
      write();

      // Below a quarter of a percent the move is invisible; stop rather than
      // burn frames chasing the last of the easing curve.
      if (Math.abs(targetX - x) > 0.0025 || Math.abs(targetY - y) > 0.0025) {
        frame = requestAnimationFrame(loop);
      } else {
        frame = 0;
      }
    };

    const onMove = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      targetX = clamp01((event.clientX - rect.left) / rect.width);
      targetY = clamp01((event.clientY - rect.top) / rect.height);
      if (frame === 0) frame = requestAnimationFrame(loop);
    };

    // Listening on the window rather than the element keeps the light moving
    // while the pointer is over the product card sitting on top of it.
    window.addEventListener('pointermove', onMove, { passive: true });
    write();

    return () => {
      window.removeEventListener('pointermove', onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ease]);

  return ref;
}
