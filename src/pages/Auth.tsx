import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AuthShell } from '../components/auth/AuthShell/AuthShell';
import { TABS } from '../components/nav/TabBar/TabBar';
import { Card } from '../components/ui';
import { AuthError } from '../auth/accounts';
import { useAuth } from '../auth/AuthProvider';
import {
  PASSWORD_MAX,
  PASSWORD_RULES,
  confirmationProblem,
  emailProblem,
  passwordProblem,
} from '../auth/validate';
import styles from './Auth.module.css';

export type AuthMode = 'login' | 'signup';

interface AuthProps {
  mode: AuthMode;
  /**
   * Where the student was heading when they were stopped, phrased for the
   * screen — "Upload your aid summary". Absent when they came here directly.
   */
  destination?: string;
  /** Called once a session exists. The route change is the caller's business. */
  onAuthenticated: () => void;
}

const COPY = {
  login: {
    eyebrow: 'Log in',
    title: 'Welcome back',
    lede: 'Your aid, your searches and your answers are behind this one screen.',
    submit: 'Log in',
    working: 'Logging you in…',
    switchLead: 'No account yet?',
    switchLink: 'Create one',
    switchHref: '/signup',
  },
  signup: {
    eyebrow: 'Join the beta',
    title: 'Create your account',
    lede: 'An email address and a password. That is the whole of it — no school, no phone number, no card.',
    submit: 'Create account',
    working: 'Creating your account…',
    switchLead: 'Already have an account?',
    switchLink: 'Log in',
    switchHref: '/login',
  },
} as const;

/** What is on the other side, read from the tab bar so it cannot drift from it. */
const BEHIND_THE_ACCOUNT = [
  {
    id: 'aid',
    blurb: 'Upload your FAFSA summary or award letter and get it read back in plain English.',
  },
  { id: 'search', blurb: 'See what other students are asking this week, and the answers.' },
  { id: 'ask', blurb: 'Ask a question and get it answered against your own award, not a generic one.' },
] as const;

export function Auth({ mode, destination, onAuthenticated }: AuthProps) {
  const { signUp, logIn, connected } = useAuth();
  const copy = COPY[mode];
  const isSignup = mode === 'signup';

  const ids = useId();
  const emailId = `${ids}-email`;
  const passwordId = `${ids}-password`;
  const confirmId = `${ids}-confirm`;
  const rulesId = `${ids}-rules`;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);

  /**
   * Nothing is marked wrong until the student has tried to submit.
   *
   * Telling somebody their email address is invalid while they are typing the
   * third character of it is a form arguing with a person who is doing
   * nothing wrong. After a failed submit the messages go live, because then
   * they are answering a question that was actually asked.
   */
  const [checked, setChecked] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  /*
   * Switching between the two forms is a different question, so the previous
   * answer does not carry over.
   *
   * The typed address does, deliberately: somebody who tried to log in, found
   * they had no account, and pressed "create one" should not have to type it
   * again. The password does not — a password offered to "log in" and refused
   * is not a password they have chosen for a new account, and leaving it in
   * the field while the confirm box below it sits empty reads as a form that
   * has half-filled itself in.
   */
  useEffect(() => {
    setChecked(false);
    setFailure(null);
    setPassword('');
    setConfirmation('');
  }, [mode]);

  const problems = useMemo(() => {
    const emailIssue = emailProblem(email);

    // A password already in use is judged by whether it is right, not by
    // whether today's rules would allow it — so log-in only checks presence.
    const passwordIssue = isSignup
      ? passwordProblem(password, email)
      : password === ''
        ? 'Enter your password.'
        : null;

    return {
      email: emailIssue,
      password: passwordIssue,
      confirmation: isSignup ? confirmationProblem(password, confirmation) : null,
    };
  }, [email, password, confirmation, isSignup]);

  const firstProblem = problems.email ?? problems.password ?? problems.confirmation;

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (pending) return;

      setChecked(true);
      setFailure(null);

      if (firstProblem) {
        // Focus follows the complaint, so a keyboard or screen-reader user is
        // put on the field that needs fixing rather than told about it once.
        if (problems.email) emailRef.current?.focus();
        else passwordRef.current?.focus();
        return;
      }

      setPending(true);
      try {
        await (isSignup ? signUp : logIn)({ email, password });
        onAuthenticated();
      } catch (thrown) {
        if (thrown instanceof AuthError && thrown.kind === 'cancelled') return;

        setFailure(
          thrown instanceof AuthError
            ? thrown.message
            : 'Something went wrong. Your details were not saved — try again.',
        );
        passwordRef.current?.focus();
      } finally {
        setPending(false);
      }
    },
    [email, password, firstProblem, isSignup, logIn, onAuthenticated, pending, problems.email, signUp],
  );

  const show = (problem: string | null) => (checked && problem ? problem : null);
  const emailError = show(problems.email);
  const passwordError = show(problems.password);
  const confirmError = show(problems.confirmation);

  return (
    <AuthShell aside={<Aside />}>
      <Card hero>
        <div className={styles.head}>
          <span className={styles.eyebrow}>{copy.eyebrow}</span>
          <h1 className={styles.title}>{copy.title}</h1>
          <p className={styles.lede}>{copy.lede}</p>
          {destination && (
            <p className={styles.destination}>
              <span aria-hidden="true">→</span> Then straight on to {destination}.
            </p>
          )}
        </div>

        <form className={styles.form} onSubmit={submit} noValidate>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={emailId}>
              Email address
            </label>
            <input
              ref={emailRef}
              id={emailId}
              name="email"
              className={`${styles.input} ${emailError ? styles.wrong : ''}`}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="you@school.edu"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? `${emailId}-error` : undefined}
              disabled={pending}
              required
            />
            {emailError && (
              <p className={styles.fieldError} id={`${emailId}-error`}>
                {emailError}
              </p>
            )}
          </div>

          <div className={styles.field}>
            <div className={styles.labelRow}>
              <label className={styles.label} htmlFor={passwordId}>
                Password
              </label>
              <button
                type="button"
                className={styles.reveal}
                onClick={() => setVisible((current) => !current)}
                aria-pressed={visible}
              >
                {visible ? 'Hide' : 'Show'}
              </button>
            </div>
            <input
              ref={passwordRef}
              id={passwordId}
              name="password"
              className={`${styles.input} ${passwordError ? styles.wrong : ''}`}
              type={visible ? 'text' : 'password'}
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              maxLength={PASSWORD_MAX}
              placeholder={isSignup ? 'At least 8 characters' : 'Your password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={passwordError ? true : undefined}
              aria-describedby={
                [isSignup ? rulesId : null, passwordError ? `${passwordId}-error` : null]
                  .filter(Boolean)
                  .join(' ') || undefined
              }
              disabled={pending}
              required
            />
            {passwordError && (
              <p className={styles.fieldError} id={`${passwordId}-error`}>
                {passwordError}
              </p>
            )}

            {isSignup && (
              /* The requirements are stated up front rather than sprung on
                 submit, and tick as they are met. `aria-live` is deliberately
                 absent: a list that announces itself on every keystroke is
                 unusable with a screen reader. It is a described-by target
                 instead, so it is read when the field takes focus. */
              <ul className={styles.rules} id={rulesId}>
                {PASSWORD_RULES.map((rule) => {
                  const met = rule.met(password);
                  return (
                    <li key={rule.id} className={`${styles.rule} ${met ? styles.met : ''}`}>
                      <span className={styles.tick} aria-hidden="true">
                        {met ? '✓' : '○'}
                      </span>
                      {rule.label}
                      <span className="srOnly">{met ? ' — done' : ' — still needed'}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {isSignup && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor={confirmId}>
                Confirm password
              </label>
              <input
                id={confirmId}
                name="confirmPassword"
                className={`${styles.input} ${confirmError ? styles.wrong : ''}`}
                type={visible ? 'text' : 'password'}
                autoComplete="new-password"
                maxLength={PASSWORD_MAX}
                placeholder="Type it again"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                aria-invalid={confirmError ? true : undefined}
                aria-describedby={confirmError ? `${confirmId}-error` : undefined}
                disabled={pending}
                required
              />
              {confirmError && (
                <p className={styles.fieldError} id={`${confirmId}-error`}>
                  {confirmError}
                </p>
              )}
            </div>
          )}

          {/* Always in the tree, so a failure is announced when it arrives
              rather than when the region itself appears. */}
          <div aria-live="polite" className={styles.messages}>
            {failure && (
              <p className={styles.error}>
                <span className={styles.glyph} aria-hidden="true">
                  ⚠
                </span>
                {failure}
              </p>
            )}
          </div>

          <button type="submit" className={styles.submit} disabled={pending}>
            {pending ? copy.working : copy.submit}
            {!pending && <span aria-hidden="true">&rarr;</span>}
          </button>

          <p className={styles.switch}>
            {copy.switchLead}{' '}
            <a className={styles.switchLink} href={copy.switchHref}>
              {copy.switchLink}
            </a>
          </p>
        </form>
      </Card>

      <p className={styles.note}>
        {connected
          ? 'Your password is sent to Fynliq over an encrypted connection and is never stored in this browser.'
          : 'The account service is not connected yet, so this account is kept in this browser alone — nothing is sent anywhere, and clearing your browser data removes it. Your password is hashed, never stored.'}
      </p>
    </AuthShell>
  );
}

/**
 * What the account is for, stated as the three tabs it opens.
 *
 * Read from `TABS` rather than retyped, so a tab that is renamed or reordered
 * is renamed and reordered here too.
 */
function Aside() {
  const tabs = BEHIND_THE_ACCOUNT.map((entry) => ({
    ...entry,
    tab: TABS.find((candidate) => candidate.id === entry.id),
  }));

  return (
    <div className={styles.panel}>
      <span className={styles.panelEyebrow}>Behind the account</span>
      <h2 className={styles.panelTitle}>Three pages, one login</h2>

      <ul className={styles.panelList}>
        {tabs.map(({ id, blurb, tab }) => (
          <li key={id} className={styles.panelItem}>
            <span className={styles.panelIcon} aria-hidden="true">
              {tab?.icon}
            </span>
            <span className={styles.panelText}>
              <span className={styles.panelLabel}>{tab?.label}</span>
              <span className={styles.panelBlurb}>{blurb}</span>
            </span>
          </li>
        ))}
      </ul>

      <p className={styles.panelFoot}>
        Fynliq is not connected to FAFSA, your school or any lender, and cannot change anything on
        your account.
      </p>
    </div>
  );
}
