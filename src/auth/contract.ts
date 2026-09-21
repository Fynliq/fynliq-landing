/**
 * The wire format the account service must return, checked at the boundary.
 *
 * Same rule as `src/beta/contract.ts`: nothing crosses into the app
 * unchecked. A session is what stands between a stranger and somebody's
 * financial aid position, so a backend that returns `{ ok: true }` where a
 * session belongs fails here, loudly, with the exact path named — rather
 * than putting the app into a state where it believes it has a user and
 * cannot say who.
 *
 * `docs/AUTH_API.md` documents this shape with a worked example.
 */

export class AuthFormatError extends Error {
  constructor(
    readonly path: string,
    detail: string,
  ) {
    super(`The account service returned something unexpected at ${path}: ${detail}`);
    this.name = 'AuthFormatError';
  }
}

export interface Account {
  /** Normalised: trimmed and lower-cased. The one identifier of a student. */
  email: string;
  /** `null` when nobody has told us a name. Never a placeholder. */
  firstName: string | null;
  /** ISO 8601. */
  createdAt: string;
}

export interface Session {
  account: Account;
  /**
   * The bearer token, or `null` when the backend keeps the session in an
   * httpOnly cookie instead — which is the safer of the two and is why this
   * is nullable rather than required. See `docs/AUTH_API.md`.
   */
  token: string | null;
  /** ISO 8601, or `null` for a session with no stated end. */
  expiresAt: string | null;
}

type Json = Record<string, unknown>;

function object(value: unknown, path: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AuthFormatError(path, 'expected an object');
  }
  return value as Json;
}

function str(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new AuthFormatError(path, 'expected a string');
  return value;
}

function nonEmptyStr(value: unknown, path: string): string {
  const text = str(value, path);
  if (text.trim() === '') throw new AuthFormatError(path, 'expected a non-empty string');
  return text;
}

function nullableStr(value: unknown, path: string): string | null {
  return value === null ? null : nonEmptyStr(value, path);
}

/** A date the app will hand to `Date`, so it has to be one `Date` understands. */
function timestamp(value: unknown, path: string): string {
  const text = str(value, path);
  if (Number.isNaN(Date.parse(text))) {
    throw new AuthFormatError(path, 'expected an ISO 8601 timestamp');
  }
  return text;
}

export function parseAccount(value: unknown, path = 'account'): Account {
  const account = object(value, path);
  const email = nonEmptyStr(account.email, `${path}.email`);

  // The app looks accounts up by the normalised address and shows it back to
  // the student. A backend that returns "Sam@School.edu" for a log-in as
  // "sam@school.edu" is describing a different string, and every comparison
  // downstream would quietly disagree.
  if (email !== email.trim().toLowerCase()) {
    throw new AuthFormatError(`${path}.email`, 'expected a trimmed, lower-cased address');
  }

  return {
    email,
    // `null` means "no name on file". Omitting the key is a bug, not a
    // shorthand, so it is not accepted as one.
    firstName: nullableStr(account.firstName, `${path}.firstName`),
    createdAt: timestamp(account.createdAt, `${path}.createdAt`),
  };
}

/** Validates a decoded JSON response into a `Session`. */
export function parseSession(value: unknown): Session {
  const root = object(value, 'the response body');

  const token = root.token === null || root.token === undefined ? null : nonEmptyStr(root.token, 'token');
  const expiresAt =
    root.expiresAt === null || root.expiresAt === undefined
      ? null
      : timestamp(root.expiresAt, 'expiresAt');

  return {
    account: parseAccount(root.account, 'account'),
    token,
    expiresAt,
  };
}

/** Whether a session has run out. A session with no stated end never has. */
export function expired(session: Session, now: number = Date.now()): boolean {
  if (session.expiresAt === null) return false;
  return Date.parse(session.expiresAt) <= now;
}
