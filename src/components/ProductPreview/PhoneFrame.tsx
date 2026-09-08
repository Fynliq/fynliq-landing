import { useScrollVar } from '../../lib/useScrollVar';
import styles from './PhoneFrame.module.css';

const TABS = ['Home', 'Aid', 'Get more', 'Tasks', 'Ask'] as const;

interface PhoneFrameProps {
  /** Which of the five tabs this screen belongs to. */
  tab: (typeof TABS)[number];
  /** Title shown in the app's own bar. */
  title: string;
  children: React.ReactNode;
}

/**
 * A static rendering of one beta screen. It is decorative in the accessibility
 * tree only where it repeats copy already given in the surrounding section;
 * the figures themselves stay readable text.
 */
export function PhoneFrame({ tab, title, children }: PhoneFrameProps) {
  // Publishes the frame's travel through the viewport as `--p`, which the
  // stylesheet turns into a slow 3D turn. It is pinned to its neutral pose
  // under reduced motion.
  const ref = useScrollVar<HTMLDivElement>();

  return (
    <div className={styles.frame} ref={ref}>
      <div className={styles.bar}>
        <span className={styles.title}>{title}</span>
        <span className={styles.avatar} aria-hidden="true">
          J
        </span>
      </div>

      <div className={styles.screen}>{children}</div>

      <div className={styles.tabs} aria-hidden="true">
        {TABS.map((name) => (
          <span
            key={name}
            className={`${styles.tab} ${name === tab ? styles.tabOn : ''}`}
          >
            {name}
            {name === tab && <span className={styles.tabDot} />}
          </span>
        ))}
      </div>
    </div>
  );
}
