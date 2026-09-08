import styles from './Card.module.css';

interface CardProps extends React.HTMLAttributes<HTMLElement> {
  /** 26px radius and roomier padding, for the leading card in a group. */
  hero?: boolean;
  /** Hairline instead of shadow, for cards nested inside another card. */
  flat?: boolean;
  /** Sits on the sunk surface — totals rows, bar tracks, segmented groups. */
  sunk?: boolean;
  as?: 'div' | 'article' | 'li';
  children: React.ReactNode;
}

export function Card({
  hero = false,
  flat = false,
  sunk = false,
  as: Tag = 'div',
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <Tag
      className={[
        styles.card,
        hero ? styles.hero : '',
        flat ? styles.flat : '',
        sunk ? styles.sunk : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </Tag>
  );
}
