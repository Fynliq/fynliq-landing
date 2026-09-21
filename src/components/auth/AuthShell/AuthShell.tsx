import { Logo } from '../../ui';
import styles from './AuthShell.module.css';

interface AuthShellProps {
  /** Runs down the right on a wide screen, and is dropped on a phone. */
  aside?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * The chrome the account pages run inside.
 *
 * Neither `FlowShell` nor `AppShell`: this page is before both of them.
 * There is no step counter, because signing in is not step one of uploading
 * a document — and there is no tab bar, because the three tabs are exactly
 * what is on the other side of this screen and offering them here would be
 * offering a door that is locked.
 *
 * What is left is one way forward and one way back to the site.
 */
export function AuthShell({ aside, children }: AuthShellProps) {
  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#account">
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
        </div>
      </header>

      <main id="account" className={styles.main}>
        <div className={styles.split}>
          <div className={styles.form}>{children}</div>
          {aside && <div className={styles.aside}>{aside}</div>}
        </div>
      </main>

      <footer className={styles.foot}>
        <p className={styles.disclaimer}>
          Educational guidance only. Fynliq is not affiliated with FAFSA, Federal Student Aid, the
          Department of Education, or your school. Your aid office and{' '}
          <a
            className={styles.link}
            href="https://studentaid.gov"
            target="_blank"
            rel="noreferrer noopener"
          >
            studentaid.gov
          </a>{' '}
          remain the authoritative sources for your award.
        </p>
        <p className={styles.copy}>&copy; {new Date().getFullYear()} Fynliq</p>
      </footer>
    </div>
  );
}
