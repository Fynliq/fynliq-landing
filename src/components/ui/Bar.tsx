import { useReveal } from '../../lib/useReveal';
import styles from './Bar.module.css';

export interface BarSegment {
  label: string;
  value: number;
  tone: 'green' | 'gold' | 'rust';
}

interface BarProps {
  segments: BarSegment[];
  /** Screen-reader summary of what the bar shows. */
  caption: string;
  showLegend?: boolean;
}

/**
 * A stacked proportion bar. The legend repeats every segment in words, so the
 * bar is never the only way to read the split.
 */
export function Bar({ segments, caption, showLegend = true }: BarProps) {
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  // The bar wipes open the first time it is seen. Only a clip animates, so
  // the segments keep their true widths throughout and never separate.
  const { ref, shown } = useReveal<HTMLDivElement>();

  return (
    <div className={styles.wrap} ref={ref}>
      <div
        className={`${styles.track} ${shown ? styles.open : ''}`}
        role="img"
        aria-label={caption}
      >
        {segments.map((segment) => (
          <span
            key={segment.label}
            className={`${styles.fill} ${styles[segment.tone]}`}
            style={{ width: `${(segment.value / total) * 100}%` }}
          />
        ))}
      </div>
      {showLegend && (
        <ul className={styles.legend}>
          {segments.map((segment) => (
            <li key={segment.label} className={styles.item}>
              <span className={`${styles.dot} ${styles[segment.tone]}`} aria-hidden="true" />
              {segment.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
