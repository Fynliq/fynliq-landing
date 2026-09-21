import { useAuth } from '../../../auth/AuthProvider';
import styles from './AccountButton.module.css';

/**
 * Who is logged in, and the way out.
 *
 * Not a dropdown. There are exactly two things to say — the address the
 * account is under, and "log out" — and a menu that has to be opened to find
 * either of them is a menu that hides the one control somebody looks for
 * when they are on a shared laptop in a library.
 *
 * On a phone the address goes and the button stays, because the address is
 * reassurance and the button is a function.
 */
export function AccountButton() {
  const { session, logOut } = useAuth();
  if (!session) return null;

  const { email, firstName } = session.account;

  return (
    <div className={styles.wrap}>
      <span className={styles.who} title={email}>
        <span className="srOnly">Logged in as </span>
        {firstName ?? email}
      </span>
      <button type="button" className={styles.out} onClick={logOut}>
        Log out
      </button>
    </div>
  );
}
