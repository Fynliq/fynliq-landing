import { AuthError, type AccountService, type AuthOptions, type Credentials } from './accounts';
import { AuthFormatError, parseSession, type Session } from './contract';
import { normaliseEmail } from './validate';

/**
 * The account service, over HTTP.
 *
 * Every response is checked against `parseSession` before anything downstream
 * sees it, so a backend still under construction fails at the boundary with
 * the offending path named rather than leaving the app convinced it has a
 * student it cannot identify.
 *
 * `credentials: 'include'` is on every request. A backend that answers with a
 * bearer token works; a backend that sets an httpOnly session cookie and
 * returns `token: null` also works, and is the better of the two — a token
 * this code can read is a token a cross-site script can read.
 */

/** Trailing slashes are the commonest way a configured URL goes wrong. */
function join(endpoint: string, path: string): string {
  return `${endpoint.replace(/\/+$/, '')}/${path}`;
}

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

/**
 * Maps a failed response onto something a student can act on.
 *
 * The service's own message is preferred wherever it is safe to show one,
 * because only the service knows why it said no. The exception is 401 on
 * log-in: "no account with that address" and "wrong password" are the same
 * sentence here on purpose, since telling them apart tells a stranger which
 * addresses are registered.
 */
async function failure(response: Response, intent: 'signup' | 'login'): Promise<AuthError> {
  const detail = await response.text().catch(() => '');
  const stated = detail.trim().slice(0, 200);

  switch (response.status) {
    case 400:
    case 422:
      return new AuthError(
        stated || 'The account service could not use what was sent. Check your details and try again.',
        intent === 'signup' ? 'password' : 'credentials',
      );
    case 401:
    case 403:
      return new AuthError(
        'That email and password do not match a Fynliq account. New here? Tap "Create one" below to make your account first. Your school login does not work here.',
        'credentials',
      );
    case 409:
      return new AuthError(
        stated || 'There is already an account with that email address. Log in instead.',
        'taken',
      );
    case 429:
      return new AuthError(
        stated || 'Too many attempts. Wait a minute and try again.',
        'throttled',
      );
    default:
      if (response.status >= 400 && response.status < 500) {
        return new AuthError(stated || 'The account service refused that request.', 'rejected');
      }
      return new AuthError(
        'The account service is not responding right now. Try again in a moment.',
        'network',
      );
  }
}

async function readSession(response: Response): Promise<Session> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AuthError('The account service did not return JSON.', 'format');
  }

  try {
    return parseSession(payload);
  } catch (error) {
    if (error instanceof AuthFormatError) throw new AuthError(error.message, 'format');
    throw error;
  }
}

export function httpAccounts(endpoint: string): AccountService {
  async function post(
    path: string,
    body: unknown,
    intent: 'signup' | 'login',
    signal?: AbortSignal,
  ): Promise<Session> {
    let response: Response;
    try {
      response = await fetch(join(endpoint, path), {
        method: 'POST',
        headers: JSON_HEADERS,
        credentials: 'include',
        body: JSON.stringify(body),
        signal,
      });
    } catch {
      if (signal?.aborted) throw new AuthError('Cancelled.', 'cancelled');
      throw new AuthError(
        'Fynliq could not reach the account service. Check your connection and try again.',
        'network',
      );
    }

    if (!response.ok) throw await failure(response, intent);
    return readSession(response);
  }

  return {
    connected: true,

    signUp({ email, password }: Credentials, { signal }: AuthOptions = {}) {
      return post('signup', { email: normaliseEmail(email), password }, 'signup', signal);
    },

    logIn({ email, password }: Credentials, { signal }: AuthOptions = {}) {
      return post('login', { email: normaliseEmail(email), password }, 'login', signal);
    },

    async logOut(session: Session, { signal }: AuthOptions = {}) {
      // Failures are swallowed. The student is already logged out of this
      // browser; a dead endpoint must not undo that or show them an error
      // about a session they have finished with.
      try {
        await fetch(join(endpoint, 'logout'), {
          method: 'POST',
          headers: session.token ? { ...JSON_HEADERS, Authorization: `Bearer ${session.token}` } : JSON_HEADERS,
          credentials: 'include',
          signal,
        });
      } catch {
        /* nothing to tell them */
      }
    },

    async restore(token: string | null, { signal }: AuthOptions = {}) {
      let response: Response;
      try {
        response = await fetch(join(endpoint, 'session'), {
          headers: token ? { Accept: 'application/json', Authorization: `Bearer ${token}` } : { Accept: 'application/json' },
          credentials: 'include',
          signal,
        });
      } catch {
        // A restore that cannot reach the server is not a logged-out student,
        // but it is not a logged-in one either. Treating it as "no session"
        // sends them to the log-in page, which is the honest outcome: the one
        // thing we must never do is let them past the gate on a guess.
        return null;
      }

      if (response.status === 401 || response.status === 403 || response.status === 404) return null;
      if (!response.ok) return null;

      try {
        return await readSession(response);
      } catch {
        return null;
      }
    },
  };
}
