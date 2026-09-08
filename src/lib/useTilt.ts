import { useEffect, useRef } from 'react';
import { prefersReducedMotion, q } from './motion';

interface TiltOptions {
  /** Maximum rotation in degrees at the edge of the element. */
  max?: number;
  /** Keeps a resting pose when the pointer is away, so the object reads as 3D. */
  restX?: number;
  restY?: number;
}

/**
 * Turns an element into a physical object: it rotates in 3D toward the
 * pointer and eases back to its resting pose when the pointer leaves.
 *
 * Writes `--rx` / `--ry` (degrees) and `--mx` / `--my` (0-1 pointer position,
 * for a specular highlight) onto the element. Touch pointers are ignored —
 * there is no hover on a phone and a tilt that fires on tap reads as a bug.
 */
export function useTilt<T extends HTMLElement>({ max = 9, restX = 0, restY = 0 }: TiltOptions = {}) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || prefersReducedMotion()) return;

    let frame = 0;
    let rx = restX;
    let ry = restY;
    let targetX = restX;
    let targetY = restY;
    let mx = 0.5;
    let my = 0.5;
    let targetMx = 0.5;
    let targetMy = 0.5;

    const draw = () => {
      frame = 0;
      // Critically damped-ish follow: the object lags the pointer slightly,
      // which is what makes it feel like it has mass.
      rx += (targetX - rx) * 0.12;
      ry += (targetY - ry) * 0.12;
      mx += (targetMx - mx) * 0.12;
      my += (targetMy - my) * 0.12;

      node.style.setProperty('--rx', `${q(rx)}deg`);
      node.style.setProperty('--ry', `${q(ry)}deg`);
      node.style.setProperty('--mx', String(q(mx)));
      node.style.setProperty('--my', String(q(my)));

      if (
        Math.abs(targetX - rx) > 0.01 ||
        Math.abs(targetY - ry) > 0.01 ||
        Math.abs(targetMx - mx) > 0.001 ||
        Math.abs(targetMy - my) > 0.001
      ) {
        frame = requestAnimationFrame(draw);
      }
    };

    const wake = () => {
      if (frame === 0) frame = requestAnimationFrame(draw);
    };

    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const rect = node.getBoundingClientRect();
      targetMx = (event.clientX - rect.left) / rect.width;
      targetMy = (event.clientY - rect.top) / rect.height;
      // Pointer right of centre tips the right edge away: rotateY follows x,
      // rotateX opposes y, which is how a real panel behaves.
      targetY = (targetMx - 0.5) * 2 * max;
      targetX = -(targetMy - 0.5) * 2 * max;
      wake();
    };

    const leave = () => {
      targetX = restX;
      targetY = restY;
      targetMx = 0.5;
      targetMy = 0.5;
      wake();
    };

    node.style.setProperty('--rx', `${restX}deg`);
    node.style.setProperty('--ry', `${restY}deg`);
    window.addEventListener('pointermove', move, { passive: true });
    node.addEventListener('pointerleave', leave);

    return () => {
      window.removeEventListener('pointermove', move);
      node.removeEventListener('pointerleave', leave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [max, restX, restY]);

  return ref;
}
