import { useReveal } from './lib/useReveal';
import styles from './App.module.css';

export type RevealVariant = 'up' | 'left' | 'right' | 'scale' | 'tilt';

interface RevealProps {
  children: React.ReactNode;
  /** Direction the element arrives from. */
  variant?: RevealVariant;
  /** Milliseconds to hold before starting, for hand-tuned sequences. */
  delay?: number;
  /**
   * Reveals each direct child in turn rather than the block as a whole. The
   * children keep their own layout; only their opacity and transform stagger.
   */
  stagger?: boolean;
  className?: string;
}

/**
 * Reveals a block as it enters the viewport.
 *
 * The element occupies its full space from the first paint and only opacity,
 * transform and filter animate, so a reveal can never shift the layout. Under
 * `prefers-reduced-motion: reduce` every variant collapses to "already
 * visible" and no observer is created.
 */
export function Reveal({
  children,
  variant = 'up',
  delay = 0,
  stagger = false,
  className,
}: RevealProps) {
  const { ref, shown } = useReveal<HTMLDivElement>();

  return (
    <div
      ref={ref}
      className={[
        styles.reveal,
        styles[variant],
        stagger ? styles.stagger : '',
        shown ? styles.shown : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={delay ? ({ '--delay': `${delay}ms` } as React.CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}
