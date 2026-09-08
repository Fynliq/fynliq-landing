import styles from './Skeleton.module.css';

interface SkeletonProps {
  /** Any CSS width. Match the content this stands in for. */
  width?: string;
  /** Any CSS height. Match the content this stands in for. */
  height?: string;
  radius?: string;
  className?: string;
}

export function Skeleton({
  width = '100%',
  height = '16px',
  radius,
  className,
}: SkeletonProps) {
  return (
    <span
      className={[styles.skeleton, className ?? ''].filter(Boolean).join(' ')}
      style={{ width, height, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}
