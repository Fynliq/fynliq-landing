import styles from './Button.module.css';

type Variant = 'primary' | 'secondary' | 'quiet';

interface ButtonProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: Variant;
  full?: boolean;
  /** Renders a trailing arrow that nudges on hover. */
  arrow?: boolean;
  children: React.ReactNode;
}

/**
 * Every call to action on the landing page navigates, so this renders an
 * anchor. Press state is scale(.97), as required of every tappable element.
 */
export function Button({
  variant = 'primary',
  full = false,
  arrow = false,
  children,
  className,
  ...rest
}: ButtonProps) {
  return (
    <a
      className={[styles.btn, styles[variant], full ? styles.full : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
      {arrow && (
        <span className={styles.arrow} aria-hidden="true">
          &rarr;
        </span>
      )}
    </a>
  );
}
