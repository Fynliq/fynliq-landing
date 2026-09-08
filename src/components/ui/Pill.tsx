import styles from './Pill.module.css';

export type PillTone = 'green' | 'gold' | 'rust' | 'neutral';

/**
 * A status pill. The glyph and the label carry the meaning; colour only
 * reinforces it, so the pill still reads with colour vision differences.
 */
const GLYPH: Record<PillTone, string> = {
  green: '\u2713',
  gold: '\u25CB',
  rust: '\u26A0',
  neutral: '',
};

interface PillProps {
  tone?: PillTone;
  children: React.ReactNode;
  /** Drop the glyph where the surrounding text already states the status. */
  glyph?: boolean;
}

export function Pill({ tone = 'neutral', children, glyph = true }: PillProps) {
  return (
    <span className={`${styles.pill} ${styles[tone]}`}>
      {glyph && GLYPH[tone] && (
        <span className={styles.glyph} aria-hidden="true">
          {GLYPH[tone]}
        </span>
      )}
      {children}
    </span>
  );
}
