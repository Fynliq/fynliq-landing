/**
 * Where the session token is kept between visits.
 *
 * One small module rather than three calls to `localStorage` scattered
 * through the provider, because this is the single decision that determines
 * whether closing the tab logs somebody out — and it is the one a security
 * review will want to find in one place.
 *
 * The safer arrangement is for the backend to keep the session in an httpOnly
 * cookie and return `token: null`. Nothing here is then written at all, the
 * browser sends the cookie on its own, and no script on the page — including
 * one that got there through an injection — can read the session. This module
 * handles that case by storing nothing, which is why every function is
 * tolerant of a `null` token rather than treating one as a bug.
 */

const TOKEN_KEY = 'fynliq.session';

/**
 * Every access is wrapped.
 *
 * `localStorage` is not merely empty in a locked-down browser or some private
 * modes — reading it throws. An uncaught throw here happens during the first
 * render, which would take the whole app down over a stored string.
 */
export function readToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function writeToken(token: string | null): void {
  try {
    if (token === null) window.localStorage.removeItem(TOKEN_KEY);
    else window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // The session then lasts as long as the tab, which is a smaller failure
    // than refusing to log somebody in over it.
  }
}

export function clearToken(): void {
  writeToken(null);
}
