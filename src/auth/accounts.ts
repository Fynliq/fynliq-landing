import type { Session } from './contract';
import { httpAccounts } from './httpAccounts';
import { localAccounts } from './localAccounts';

/**
 * The seam between the app and whatever holds the accounts.
 *
 * The log-in page depends on this interface and nothing else. Point
 * `VITE_FYNLIQ_AUTH_URL` at an endpoint and the whole product runs on real
 * accounts; leave it unset and it runs on a local store, which walks the same
 * code path, fails the same way, and says on screen that the account lives in
 * this browser rather than on a server.
 *
 * Connecting the backend is one environment variable. No component changes.
 */

export type AuthErrorKind =
  /** The request never completed — offline, DNS, CORS, a dead endpoint. */
  | 'network'
  /** The service answered, but not with something this app can use. */
  | 'format'
  /** The email and password do not go together. Said the same way for both. */
  | 'credentials'
  /** Somebody already signed up with that address. */
  | 'taken'
  /** The service refused the password — too weak, breached, its own rules. */
  | 'password'
  /** The service refused for a reason it stated itself. */
  | 'rejected'
  /** Too many attempts. The message carries whatever the service said. */
  | 'throttled'
  /** The student navigated away mid-request. Not an error to apologise for. */
  | 'cancelled';

export class AuthError extends Error {
  constructor(
    message: string,
    readonly kind: AuthErrorKind,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface Credentials {
  /** Raw from the field. Implementations normalise; callers need not. */
  email: string;
  password: string;
}

export interface AuthOptions {
  signal?: AbortSignal;
}

export interface AccountService {
  /**
   * False while running on the local store, which the log-in page states on
   * screen. The same flag is why the app never claims an account is "secured"
   * when it is a row in this browser.
   */
  readonly connected: boolean;

  /** Creates an account and returns the session it starts. */
  signUp(credentials: Credentials, options?: AuthOptions): Promise<Session>;

  /** Exchanges an email and password for a session. */
  logIn(credentials: Credentials, options?: AuthOptions): Promise<Session>;

  /**
   * Ends a session. Best effort by design: the app has already forgotten the
   * student by the time this resolves, and a failure here must never leave
   * somebody looking at a page they pressed "log out" on.
   */
  logOut(session: Session, options?: AuthOptions): Promise<void>;

  /**
   * Turns a stored token back into a session, or `null` if it is no longer
   * good. Never throws for an expired or unknown token — that is an answer,
   * not a failure.
   */
  restore(token: string | null, options?: AuthOptions): Promise<Session | null>;
}

/**
 * Picks the account store from the environment.
 *
 * Kept as a function rather than a module-level constant so a test — or a
 * future settings screen — can construct one against any endpoint.
 */
export function createAccounts(
  endpoint: string | undefined = import.meta.env.VITE_FYNLIQ_AUTH_URL,
): AccountService {
  return endpoint ? httpAccounts(endpoint) : localAccounts();
}
