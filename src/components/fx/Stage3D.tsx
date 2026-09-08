import { useTilt } from '../../lib/useTilt';
import styles from './Stage3D.module.css';

interface Stage3DProps {
  children: React.ReactNode;
  /** Maximum rotation in degrees at the edge of the stage. */
  max?: number;
  /** Resting pose, so the scene reads as 3D before anyone moves a pointer. */
  restX?: number;
  restY?: number;
  className?: string;
}

/**
 * A real 3D stage: one perspective, one `preserve-3d` world, and children
 * placed at different depths inside it. The whole world rotates toward the
 * pointer, so the layers move past each other with true parallax rather than
 * the faked kind you get from moving flat elements at different speeds.
 */
export function Stage3D({ children, max = 8, restX = 0, restY = 0, className }: Stage3DProps) {
  const ref = useTilt<HTMLDivElement>({ max, restX, restY });

  return (
    <div className={[styles.stage, className ?? ''].filter(Boolean).join(' ')}>
      <div ref={ref} className={styles.world}>
        {children}
      </div>
    </div>
  );
}

interface DepthProps {
  /** Optional: a depth layer may be a bare decorative plane. */
  children?: React.ReactNode;
  /** Distance toward the viewer, in px of 3D space. */
  z?: number;
  /** Offsets the idle float so layers do not bob in unison. */
  delay?: number;
  className?: string;
  style?: React.CSSProperties;
}

/** One plane inside a {@link Stage3D}, at depth `z`, breathing on its own clock. */
export function Depth({ children, z = 0, delay = 0, className, style }: DepthProps) {
  return (
    <div
      className={[styles.depth, className ?? ''].filter(Boolean).join(' ')}
      style={{ '--z': `${z}px`, '--fd': `${delay}ms`, ...style } as React.CSSProperties}
    >
      {children}
    </div>
  );
}
