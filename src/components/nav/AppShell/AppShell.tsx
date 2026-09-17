import { Logo } from '../../ui';
import { AccountButton } from '../../../accounts/AccountProvider';
import { TabBar, type TabId } from '../TabBar/TabBar';
import styles from './AppShell.module.css';

interface AppShellProps {
  /**
   * Which tab this page belongs to. Omitted for a page that sits outside the
   * three — the bar still shows, with nothing marked current.
   */
  tab?: TabId;
  /** Runs full-bleed above the padded body — the dark search hero uses it. */
  banner?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * The chrome the three tabbed pages run inside.
 *
 * Deliberately not `FlowShell`: that one carries the upload → analyse →
 * answer step counter, which is a progress bar through a task. These pages
 * are not a task and have no last step, so they get a persistent tab bar
 * instead — you can be on any of them indefinitely, and any of them leads to
 * the other two.
 */
export function AppShell({ tab, banner, children }: AppShellProps) {
  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#app">
        Skip to content
      </a>

      <header className={styles.bar}>
        <div className={styles.barInner}>
          <a className={styles.home} href="/" aria-label="Fynliq, back to the home page">
            <Logo beta />
          </a>
          <a className={styles.back} href="/">
            <span aria-hidden="true">&larr;</span> Back to the site
          </a>
          <AccountButton />
        </div>
      </header>

      {banner}

      <main id="app" className={styles.main}>
        {children}
      </main>

      <footer className={styles.foot}>
        <p className={styles.disclaimer}>
          Educational guidance only. Fynliq is not affiliated with FAFSA, Federal Student Aid, the
          Department of Education, or your school. Rules described here are general; your aid office
          and{' '}
          <a
            className={styles.link}
            href="https://studentaid.gov"
            target="_blank"
            rel="noreferrer noopener"
          >
            studentaid.gov
          </a>{' '}
          remain the authoritative sources for your own award.
        </p>
        <p className={styles.copy}>&copy; {new Date().getFullYear()} Fynliq</p>
      </footer>

      <TabBar current={tab} />
    </div>
  );
}
