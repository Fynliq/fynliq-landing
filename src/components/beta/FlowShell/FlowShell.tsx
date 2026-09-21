import { AccountButton } from '../../auth/AccountButton/AccountButton';
import { Logo } from '../../ui';
import { TabBar } from '../../nav/TabBar/TabBar';
import styles from './FlowShell.module.css';

const STEPS = ['Upload', 'Analyse', 'Your answer'] as const;

type StepState = 'done' | 'current' | 'todo';

/** Read out after the step name, so progress is not carried by colour alone. */
const STATE_NOTE: Record<StepState, string> = {
  done: 'done',
  current: 'current step',
  todo: 'not started',
};

interface FlowShellProps {
  /** 1-based, matching the visible numbering. */
  step: 1 | 2 | 3;
  children: React.ReactNode;
}

/**
 * The chrome the beta flow runs inside.
 *
 * Deliberately not the landing page's `Navbar`: that one is a fixed, scroll-lit
 * bar with section anchors, and none of those anchors exist here. A student
 * part-way through uploading their own financial documents should see one way
 * out and no invitations to wander.
 *
 * The tab bar at the foot is the exception, and a deliberate one. Upload is
 * the My Aid tab, so the student can always see where the other two are —
 * and once they have their answer, Search and Ask Fynliq are where it leads.
 */
export function FlowShell({ step, children }: FlowShellProps) {
  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#flow">
        Skip to content
      </a>

      <header className={styles.bar}>
        <div className={styles.barInner}>
          <a className={styles.home} href="/" aria-label="Fynliq, back to the home page">
            <Logo beta />
          </a>
          <div className={styles.right}>
            <a className={styles.back} href="/" aria-label="Back to the site">
              <span aria-hidden="true">&larr;</span>
              <span className={styles.backLabel} aria-hidden="true">
                Back to the site
              </span>
            </a>
            <AccountButton />
          </div>
        </div>
      </header>

      <nav className={styles.steps} aria-label="Progress">
        <ol className={styles.stepList}>
          {STEPS.map((label, index) => {
            const position = index + 1;
            const state: StepState =
              position < step ? 'done' : position === step ? 'current' : 'todo';

            return (
              <li
                key={label}
                className={`${styles.step} ${styles[state]}`}
                aria-current={state === 'current' ? 'step' : undefined}
              >
                <span className={styles.dot} aria-hidden="true">
                  {state === 'done' ? '✓' : position}
                </span>
                <span className={styles.stepLabel}>{label}</span>
                <span className="srOnly"> &mdash; {STATE_NOTE[state]}</span>
              </li>
            );
          })}
        </ol>
      </nav>

      <main id="flow" className={styles.main}>
        {children}
      </main>

      <footer className={styles.foot}>
        <p className={styles.disclaimer}>
          Educational guidance only. Fynliq is not affiliated with FAFSA, Federal Student Aid, the
          Department of Education, or your school. Your aid office and{' '}
          <a className={styles.link} href="https://studentaid.gov" target="_blank" rel="noreferrer noopener">
            studentaid.gov
          </a>{' '}
          remain the authoritative sources for your award.
        </p>
        <p className={styles.copy}>&copy; {new Date().getFullYear()} Fynliq</p>
      </footer>

      <TabBar current="aid" />
    </div>
  );
}
