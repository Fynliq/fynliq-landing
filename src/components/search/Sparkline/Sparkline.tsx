import styles from './Sparkline.module.css';

interface SparklineProps {
  /** Daily search counts, oldest first. */
  values: number[];
  /** Read out in place of the drawing, which is decoration to a screen reader. */
  label: string;
  width?: number;
  height?: number;
}

/**
 * Seven days of demand, drawn as one line.
 *
 * Inline SVG, no library — the whole chart is six line segments and a dot, and
 * pulling in a charting dependency to draw six line segments would be a
 * regression in a codebase with two runtime dependencies.
 *
 * Deliberately colourless. Green, gold and rust mean money kept, money repaid
 * and money uncovered in this product, and a rising search count means none of
 * those things; a green trend line here would quietly claim it did. The shape
 * carries the message, and the badge beside it says the same thing in words.
 *
 * No axis and no gridlines, on purpose: this is a shape, not a reading. The
 * exact figures are printed next to it, where they can be read precisely.
 */
export function Sparkline({ values, label, width = 96, height = 30 }: SparklineProps) {
  const pad = 3;
  const points = values.length > 1 ? values : [0, 0];

  const max = Math.max(...points);
  const min = Math.min(...points);
  // A flat week is drawn flat through the middle rather than divided by zero.
  const span = max - min || 1;

  const stepX = (width - pad * 2) / (points.length - 1);
  const coords = points.map((value, index) => {
    const x = pad + index * stepX;
    const y = max === min ? height / 2 : height - pad - ((value - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });

  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [lastX, lastY] = coords[coords.length - 1];
  const area = `${pad},${height} ${line} ${(width - pad).toFixed(1)},${height}`;

  return (
    <svg
      className={styles.spark}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
    >
      <polygon className={styles.area} points={area} />
      <polyline className={styles.line} points={line} />
      <circle className={styles.head} cx={lastX} cy={lastY} r="2.4" />
    </svg>
  );
}
