import { AuthError, type AccountService, type AuthOptions, type Credentials } from './accounts';
import type { Account, Session } from './contract';
import { normaliseEmail } from './validate';

/**
 * The account store the product runs on until a backend is connected.
 *
 * It is a real store, not a mock: it rejects a duplicate address, refuses a
 * wrong password, issues a session that expires, and survives a reload — so
 * the whole flow can be walked, demonstrated and tested before there is a
 * server. Every screen that uses it says on screen that the account lives in
 * this browser.
 *
 * Two things it deliberately does properly, because a demo that teaches the
 * wrong habit is worse than no demo:
 *
 *   - Passwords are never stored. What is stored is PBKDF2-SHA-256 over a
 *     per-account random salt, and logging in re-derives and compares. There
 *     is no code path here that can print somebody's password back.
 *   - The comparison is constant-time, so the store cannot be probed a byte
 *     at a time by somebody watching how long it takes to say no.
 *
 * What it is not is secure, and it does not pretend to be: anything in
 * `localStorage` belongs to whoever is sitting at the browser, and there is
 * no server here to rate-limit anything. It is a placeholder with the right
 * shape, and `VITE_FYNLIQ_AUTH_URL` replaces it.
 */

const STORE_KEY = 'fynliq.demo.accounts';

/** Long enough to be a nuisance to grind, short enough not to stall a phone. */
const ITERATIONS = 210_000;
const KEY_BITS = 256;

/** A month. Long enough to be useful, short enough to still be a session. */
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * A pause, so the interface is exercised the way a network makes it behave.
 *
 * Without it every state the log-in page has for "working" is dead code, and
 * the first time anybody sees the pending button is in production.
 */
const THINKING_MS = 420;

interface StoredAccount {
  email: string;
  firstName: string | null;
  createdAt: string;
  salt: string;
  hash: string;
}

interface StoredSession {
  email: string;
  expiresAt: string;
}

interface Store {
  accounts: StoredAccount[];
  sessions: Record<string, StoredSession>;
}

const empty = (): Store => ({ accounts: [], sessions: {} });

/**
 * `localStorage` throws outright in a locked-down browser and in some private
 * modes, so every touch of it is guarded. Somebody in that situation gets a
 * store that works for as long as the tab is open, which is a far better
 * outcome than a page that will not load.
 */
function read(): Store {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return empty();

    const parsed = JSON.parse(raw) as Partial<Store>;
    return {
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
      sessions:
        typeof parsed.sessions === 'object' && parsed.sessions !== null ? parsed.sessions : {},
    };
  } catch {
    return empty();
  }
}

function write(store: Store): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* Nothing to do, and nothing worth interrupting anybody over. */
  }
}

function subtle(): SubtleCrypto {
  const available = globalThis.crypto?.subtle;
  if (!available) {
    throw new AuthError(
      'This browser will not hash a password over an insecure connection. Open the site over https, or connect the account service.',
      'rejected',
    );
  }
  return available;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/*
 * Backed by an explicit `ArrayBuffer`, and the return type is left to
 * inference on purpose: WebCrypto will not take a view that might sit on a
 * `SharedArrayBuffer`, and writing `Uint8Array` here widens it to exactly
 * that.
 */
function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomBase64(length: number): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return toBase64(bytes);
}

async function derive(password: string, salt: string): Promise<string> {
  const crypt = subtle();
  const key = await crypt.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);

  const bits = await crypt.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(salt), iterations: ITERATIONS },
    key,
    KEY_BITS,
  );

  return toBase64(new Uint8Array(bits));
}

/** Compares without leaking, through timing, how much of the value matched. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

/** A cancellable wait. Rejects the moment the caller aborts. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AuthError('Cancelled.', 'cancelled'));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(new AuthError('Cancelled.', 'cancelled'));
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** What leaves this module. The salt and the hash never do. */
const publicAccount = ({ email, firstName, createdAt }: StoredAccount): Account => ({
  email,
  firstName,
  createdAt,
});

/** Drops sessions that have run out, so the store does not grow for ever. */
function prune(store: Store, now: number): Store {
  const sessions: Record<string, StoredSession> = {};
  for (const [token, session] of Object.entries(store.sessions)) {
    if (Date.parse(session.expiresAt) > now) sessions[token] = session;
  }
  return { accounts: store.accounts, sessions };
}

function issue(store: Store, account: StoredAccount): Session {
  const token = randomBase64(24);
  const expiresAt = new Date(Date.now() + SESSION_MS).toISOString();

  const next = prune(store, Date.now());
  next.sessions[token] = { email: account.email, expiresAt };
  write(next);

  return { account: publicAccount(account), token, expiresAt };
}

export function localAccounts(): AccountService {
  return {
    connected: false,

    async signUp({ email, password }: Credentials, { signal }: AuthOptions = {}) {
      const address = normaliseEmail(email);
      await delay(THINKING_MS, signal);

      const store = read();
      if (store.accounts.some((account) => account.email === address)) {
        throw new AuthError(
          'There is already an account with that email address. Log in instead.',
          'taken',
        );
      }

      const salt = randomBase64(16);
      const account: StoredAccount = {
        email: address,
        firstName: null,
        createdAt: new Date().toISOString(),
        salt,
        hash: await derive(password, salt),
      };

      // Re-read rather than reusing the copy from before the hash: deriving
      // takes a moment, and another tab may have signed somebody up in it.
      const fresh = read();
      if (fresh.accounts.some((existing) => existing.email === address)) {
        throw new AuthError(
          'There is already an account with that email address. Log in instead.',
          'taken',
        );
      }

      fresh.accounts.push(account);
      write(fresh);

      return issue(fresh, account);
    },

    async logIn({ email, password }: Credentials, { signal }: AuthOptions = {}) {
      const address = normaliseEmail(email);
      await delay(THINKING_MS, signal);

      const store = read();
      const account = store.accounts.find((candidate) => candidate.email === address);

      // One sentence for both "no such account" and "wrong password". Telling
      // them apart tells a stranger which addresses have signed up.
      const wrong = new AuthError(
        'That email and password do not match an account. Check both, or create an account.',
        'credentials',
      );

      if (!account) throw wrong;
      if (!sameSecret(await derive(password, account.salt), account.hash)) throw wrong;

      return issue(store, account);
    },

    async logOut(session: Session) {
      if (!session.token) return;

      const store = read();
      delete store.sessions[session.token];
      write(prune(store, Date.now()));
    },

    async restore(token: string | null) {
      if (!token) return null;

      const store = prune(read(), Date.now());
      write(store);

      const found = store.sessions[token];
      if (!found) return null;

      const account = store.accounts.find((candidate) => candidate.email === found.email);
      if (!account) return null;

      return { account: publicAccount(account), token, expiresAt: found.expiresAt };
    },
  };
}
