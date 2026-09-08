import styles from './Grain.module.css';

interface GrainProps {
  className?: string;
}

/**
 * An animated film grain overlay.
 *
 * Deliberately has no JavaScript behind it: the noise is an SVG turbulence
 * filter the browser rasterises once, and the flicker is a stepped CSS
 * transform on the compositor. Nothing here reads layout, so it cannot stall
 * a frame however many of these end up on the page.
 */
export function Grain({ className }: GrainProps) {
  return <span className={[styles.grain, className ?? ''].filter(Boolean).join(' ')} aria-hidden="true" />;
}
