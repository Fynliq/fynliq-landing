import { useReveal } from '../../lib/useReveal';
import styles from './Section.module.css';

interface SectionProps {
  id: string;
  /** Small mono label above the heading. */
  eyebrow: string;
  title: string;
  lede?: string;
  /** Sits the section on the sunk surface instead of paper. */
  sunk?: boolean;
  children: React.ReactNode;
}

export function Section({ id, eyebrow, title, lede, sunk = false, children }: SectionProps) {
  const headingId = `${id}-title`;
  // The heading block arrives a beat ahead of the content it introduces.
  const { ref, shown } = useReveal<HTMLElement>();

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={`${styles.section} ${sunk ? styles.sunk : ''}`}
    >
      <div className={styles.inner}>
        <header className={`${styles.head} ${shown ? styles.shown : ''}`} ref={ref}>
          <span className={styles.eyebrow}>{eyebrow}</span>
          <h2 id={headingId} className={styles.title}>
            {title}
          </h2>
          {lede && <p className={styles.lede}>{lede}</p>}
        </header>
        {children}
      </div>
    </section>
  );
}
