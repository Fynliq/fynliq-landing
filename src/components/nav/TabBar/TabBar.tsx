import { useRouter } from '../../../router/router';
import styles from './TabBar.module.css';

/**
 * The three places a student can be.
 *
 * The order is the journey the client described, left to right: their own aid,
 * then what everybody else is asking, then their own question. Each tab leads
 * into the next, and no tab is a dead end.
 */
export type TabId = 'aid' | 'search' | 'ask';

interface Tab {
  id: TabId;
  label: string;
  href: string;
  /** Every route that should light this tab up. Longest prefix wins. */
  owns: string[];
  icon: React.ReactNode;
}

/*
 * Line icons, drawn inline.
 *
 * At 22px a stroked glyph reads better than a filled one and stays legible
 * against the glass, and inline SVG means no request and no icon dependency —
 * which this codebase does not have and is not getting.
 */
const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export const TABS: Tab[] = [
  {
    id: 'aid',
    label: 'My Aid',
    href: '/beta',
    owns: ['/beta'],
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" {...stroke}>
        <path d="M6 3.5h8.5L19 8v12.5H6z" />
        <path d="M14 3.5V8h5" />
        <path d="M9 13h7M9 16.5h4.5" />
      </svg>
    ),
  },
  {
    id: 'search',
    label: 'Search',
    href: '/search',
    owns: ['/search'],
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" {...stroke}>
        <circle cx="11" cy="11" r="6.25" />
        <path d="M15.6 15.6 20 20" />
      </svg>
    ),
  },
  {
    id: 'ask',
    label: 'Ask Fynliq',
    href: '/ask',
    owns: ['/ask'],
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" {...stroke}>
        <path d="M4.5 16.5V7.2A2.7 2.7 0 0 1 7.2 4.5h9.6A2.7 2.7 0 0 1 19.5 7.2v6.1a2.7 2.7 0 0 1-2.7 2.7H9.2L4.5 19.8z" />
        <path d="M9.6 9.1a2.4 2.4 0 1 1 2.9 2.35v1.05" />
      </svg>
    ),
  },
];

/** Which tab a path belongs to, or `null` for a page outside the three. */
export function tabForPath(path: string): TabId | null {
  const match = TABS.filter((tab) =>
    tab.owns.some((root) => path === root || path.startsWith(`${root}/`)),
  ).sort((a, b) => b.href.length - a.href.length)[0];

  return match?.id ?? null;
}

interface TabBarProps {
  /** Overrides the route-derived tab, for a page that belongs to one without living under it. */
  current?: TabId;
}

/**
 * Bottom navigation across the three pages.
 *
 * Fixed to the bottom at every width rather than turning into a top nav on
 * desktop: a student who learns where the tabs are on their phone should find
 * them in the same place on a laptop. On a wide screen it floats as a centred
 * pill instead of stretching edge to edge, which keeps it from reading as an
 * unfinished mobile layout.
 */
export function TabBar({ current }: TabBarProps) {
  const { path } = useRouter();
  const active = current ?? tabForPath(path);

  return (
    <nav className={styles.bar} aria-label="Sections">
      <ul className={styles.list}>
        {TABS.map((tab) => {
          const on = tab.id === active;
          return (
            <li key={tab.id} className={styles.item}>
              <a
                className={`${styles.tab} ${on ? styles.on : ''}`}
                href={tab.href}
                aria-current={on ? 'page' : undefined}
              >
                <span className={styles.icon}>{tab.icon}</span>
                <span className={styles.label}>{tab.label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
