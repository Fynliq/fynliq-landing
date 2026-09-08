import styles from './Coin3D.module.css';

/** Panels in the rim. 24 keeps the silhouette round without a visible facet. */
const RIM_SEGMENTS = 24;
const SEGMENTS = Array.from({ length: RIM_SEGMENTS }, (_, i) => i);
/** Coin thickness in px. Also the width of every rim panel. */
const THICKNESS = 18;

interface Coin3DProps {
  /** Diameter in px. Rim geometry is derived from it. */
  size?: number;
  className?: string;
}

/**
 * A genuinely three-dimensional coin: two faces on the Z axis and a rim of 24
 * panels standing on the circumference, all in one `preserve-3d` context. It
 * is a solid, not a sprite, so the edge is really there as it turns.
 *
 * Rim geometry: `rotateZ(θ) translateX(r)` walks to a point on the circle with
 * local X pointing radially outward; the trailing `rotateY(90deg)` then lays
 * the panel down tangentially, so its width becomes the coin's thickness and
 * its height runs along the circumference.
 *
 * Decorative — it carries the logo and says nothing about money, so it is
 * hidden from assistive technology.
 */
export function Coin3D({ size = 132, className }: Coin3DProps) {
  const radius = size / 2;
  // One slice of the circumference, plus a hair of overlap so no seam shows.
  const segmentHeight = (Math.PI * size) / RIM_SEGMENTS + 1;

  return (
    <div
      className={[styles.scene, className ?? ''].filter(Boolean).join(' ')}
      style={
        {
          '--size': `${size}px`,
          '--seg-h': `${segmentHeight}px`,
          '--thick': `${THICKNESS}px`,
          '--half': `${THICKNESS / 2}px`,
        } as React.CSSProperties
      }
      aria-hidden="true"
    >
      <div className={styles.coin}>
        <div className={`${styles.face} ${styles.front}`}>
          <img className={styles.mark} src="/fynliq-mark.png" alt="" />
        </div>

        <div className={styles.rim}>
          {SEGMENTS.map((i) => (
            <span
              key={i}
              className={styles.segment}
              style={{
                transform: `rotateZ(${(360 / RIM_SEGMENTS) * i}deg) translateX(${radius}px) rotateY(90deg)`,
              }}
            />
          ))}
        </div>

        <div className={`${styles.face} ${styles.back}`}>
          <img className={styles.mark} src="/fynliq-mark.png" alt="" />
        </div>
      </div>
    </div>
  );
}
