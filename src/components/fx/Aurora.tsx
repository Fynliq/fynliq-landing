import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from '../../lib/motion';
import styles from './Aurora.module.css';

/** Decorative only — these hues are outside the money palette by design. */
const BLOBS = [
  { hue: '156, 230, 35', x: 0.22, y: 0.3, r: 0.62, sx: 0.00021, sy: 0.00013, ax: 0.16, ay: 0.11 },
  { hue: '34, 211, 238', x: 0.78, y: 0.26, r: 0.58, sx: -0.00017, sy: 0.00023, ax: 0.14, ay: 0.13 },
  { hue: '124, 92, 255', x: 0.6, y: 0.78, r: 0.66, sx: 0.00013, sy: -0.00019, ax: 0.18, ay: 0.1 },
];

interface AuroraProps {
  /** Alpha ceiling. The dark bands can carry far more colour than paper can. */
  tone?: 'light' | 'dark';
  className?: string;
}

/**
 * A drifting mesh gradient, drawn on a deliberately tiny canvas (160x110) and
 * scaled up under a CSS blur. At that size the whole field costs three radial
 * fills a frame, which is cheaper than one shadow repaint — and the blur means
 * nobody can tell it was ever low resolution.
 *
 * It stops when scrolled out of view or the tab is hidden, and under reduced
 * motion it paints a single static frame and never starts a loop.
 */
export function Aurora({ tone = 'light', className }: AuroraProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const w = (canvas.width = 160);
    const h = (canvas.height = 110);
    const peak = tone === 'dark' ? 0.95 : 0.8;

    const paint = (time: number) => {
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';

      for (const blob of BLOBS) {
        const cx = (blob.x + Math.sin(time * blob.sx) * blob.ax) * w;
        const cy = (blob.y + Math.cos(time * blob.sy) * blob.ay) * h;
        const radius = blob.r * w;

        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        gradient.addColorStop(0, `rgba(${blob.hue}, ${peak})`);
        gradient.addColorStop(1, `rgba(${blob.hue}, 0)`);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
      }
    };

    if (prefersReducedMotion()) {
      paint(0);
      return;
    }

    let frame = 0;
    let running = false;

    const loop = () => {
      paint(performance.now());
      frame = requestAnimationFrame(loop);
    };

    const setRunning = (next: boolean) => {
      if (next === running) return;
      running = next;
      if (next) loop();
      else if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    };

    // Only animate what is both on screen and in a visible tab.
    let onScreen = true;
    const sync = () => setRunning(onScreen && !document.hidden);

    const observer =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(([entry]) => {
            onScreen = entry.isIntersecting;
            sync();
          })
        : null;

    observer?.observe(canvas);
    document.addEventListener('visibilitychange', sync);
    paint(performance.now());
    sync();

    return () => {
      observer?.disconnect();
      document.removeEventListener('visibilitychange', sync);
      setRunning(false);
    };
  }, [tone]);

  return (
    <canvas
      ref={ref}
      className={[styles.aurora, styles[tone], className ?? ''].filter(Boolean).join(' ')}
      aria-hidden="true"
    />
  );
}
