import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AuthError, createAccounts, type AccountService, type Credentials } from './accounts';
import { expired, type Session } from './contract';
import { clearToken, readToken, writeToken } from './token';

/**
 * Who is logged in, for the whole app.
 *
 * One provider above the router so every page reads the same answer, and so
 * that logging out empties the app everywhere at once rather than leaving a
 * page still holding somebody's figures.
 */

interface AuthValue {
  /** `null` means nobody is logged in. There is no third state on screen. */
  session: Session | null;
  /** False while running on the local store, which the log-in page states. */
  connected: boolean;
  /**
   * True until the stored token has been checked.
   *
   * The gate has to wait for this. Without it, every reload of a page behind
   * the account bounces the student to the log-in screen for one frame before
   * their session comes back — which looks exactly like being logged out.
   */
  restoring: boolean;
  signUp: (credentials: Credentials) => Promise<Session>;
  logIn: (credentials: Credentials) => Promise<Session>;
  logOut: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

interface AuthProviderProps {
  /** Injectable so a test can supply its own store. */
  accounts?: AccountService;
  children: React.ReactNode;
}

export function AuthProvider({ accounts, children }: AuthProviderProps) {
  // `useState` rather than `useMemo`, so the service is constructed once and
  // stays the same object even if the component re-renders under Strict Mode.
  const [service] = useState<AccountService>(() => accounts ?? createAccounts());

  const [session, setSession] = useState<Session | null>(null);
  const [restoring, setRestoring] = useState(true);

  /** Cancels an in-flight request when the provider goes away. */
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;

    (async () => {
      const token = readToken();

      // Nothing stored still means asking the service: a backend holding the
      // session in an httpOnly cookie has a session we cannot see from here.
      const restored = await service.restore(token, { signal: controller.signal });
      if (!live) return;

      if (restored && !expired(restored)) {
        setSession(restored);
        writeToken(restored.token);
      } else {
        // A token that no longer resolves is rubbish in the browser. Clearing
        // it means the next reload does not ask about it again.
        if (token) clearToken();
        setSession(null);
      }

      setRestoring(false);
    })().catch(() => {
      // `restore` is specified never to throw for an unknown token, but a
      // backend under construction has not read the specification yet. An
      // unreadable session is a logged-out student, not a broken page.
      if (!live) return;
      setSession(null);
      setRestoring(false);
    });

    return () => {
      live = false;
      controller.abort();
    };
  }, [service]);

  const accept = useCallback((next: Session) => {
    setSession(next);
    writeToken(next.token);
    return next;
  }, []);

  const start = useCallback(
    async (how: 'signUp' | 'logIn', credentials: Credentials) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;

      try {
        return accept(await service[how](credentials, { signal: controller.signal }));
      } finally {
        if (abort.current === controller) abort.current = null;
      }
    },
    [accept, service],
  );

  const signUp = useCallback(
    (credentials: Credentials) => start('signUp', credentials),
    [start],
  );

  const logIn = useCallback((credentials: Credentials) => start('logIn', credentials), [start]);

  const logOut = useCallback(() => {
    const ending = session;

    // Local first, and synchronously. Logging out is the one action that must
    // never depend on a server answering: the student is looking at their own
    // aid and has asked for it to go away.
    setSession(null);
    clearToken();

    if (ending) {
      void service.logOut(ending).catch(() => {
        /* Already gone from this browser. Nothing to tell them. */
      });
    }
  }, [service, session]);

  const value = useMemo<AuthValue>(
    () => ({ session, connected: service.connected, restoring, signUp, logIn, logOut }),
    [session, service.connected, restoring, signUp, logIn, logOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

/** Re-exported so a page imports its error type from the same place as `useAuth`. */
export { AuthError };
