import { useEffect, useRef } from 'react';
import { clamp01, onScrollFrame, q } from '../../lib/motion';
import styles from './ScrollProgress.module.css';

/**
 * A hairline at the top of the window showing how far through the page the
 * reader is. Purely informational chrome, so it is hidden from assistive
 * technology; the scrollbar already conveys this to anyone not looking at it.
 */
export function ScrollProgress() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    return onScrollFrame(() => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      const progress = scrollable > 0 ? clamp01(window.scrollY / scrollable) : 0;
      node.style.setProperty('--progress', String(q(progress)));
    });
  }, []);

  return <div ref={ref} className={styles.bar} aria-hidden="true" />;
}
