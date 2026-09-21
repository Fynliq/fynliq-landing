/**
 * What makes an email address and a password acceptable, as pure functions.
 *
 * These run in the browser before anything is sent, so a student is told what
 * is wrong while they are still looking at the field rather than after a
 * round trip. They are not a security boundary: the backend must enforce all
 * of this again, because anything checked only here is not checked at all.
 *
 * Nothing in this file touches the network, the DOM or storage, which is why
 * the rules can be tested directly.
 */

/**
 * Deliberately permissive.
 *
 * A local part, an `@`, and a domain with at least one dot. Every stricter
 * regular expression on the internet rejects somebody's real address, and the
 * only test that actually proves an address exists is sending mail to it.
 */
const EMAIL = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

/** Longer than any real address, and short enough not to be a payload. */
const EMAIL_MAX = 254;

/** Trims and lower-cases. The stored form of an address is always this one. */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * The problem with an address in plain English, or `null` if there is none.
 *
 * The messages name what to do, not what failed: "that doesn't look like an
 * email address" is a verdict, "check for a typo — it needs an @" is a fix.
 */
export function emailProblem(raw: string): string | null {
  const email = normaliseEmail(raw);

  if (email === '') return 'Enter the email address you want to use.';
  if (email.length > EMAIL_MAX) return 'That address is too long to be a real one.';
  if (!email.includes('@')) return 'An email address needs an @ in it.';
  if (!EMAIL.test(email)) return 'Check that for a typo — it should look like you@school.edu.';

  return null;
}

export interface PasswordRule {
  id: string;
  /** Shown beside a tick as the student types. */
  label: string;
  met: (password: string) => boolean;
}

/**
 * The shortest password worth having and the longest worth accepting.
 *
 * Eight is the floor every modern guideline agrees on. The ceiling is here
 * because a password is hashed, and hashing an unbounded string is a way to
 * let somebody tie up the server with a single request.
 */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export const PASSWORD_RULES: readonly PasswordRule[] = [
  {
    id: 'length',
    label: `At least ${PASSWORD_MIN} characters`,
    met: (password) => password.length >= PASSWORD_MIN,
  },
  {
    id: 'letter',
    label: 'A letter',
    met: (password) => /\p{L}/u.test(password),
  },
  {
    id: 'other',
    label: 'A number or a symbol',
    met: (password) => /[\p{N}\p{P}\p{S}]/u.test(password),
  },
];

/** The rules this password does not yet satisfy, in the order they are shown. */
export function unmetRules(password: string): PasswordRule[] {
  return PASSWORD_RULES.filter((rule) => !rule.met(password));
}

/**
 * The problem with a new password, or `null` if there is none.
 *
 * `email` is passed so the one genuinely dangerous choice — a password that
 * is the address it protects — can be refused. It is optional because the
 * log-in form has nothing to compare against and does not check any of this:
 * an existing password is judged by whether it is right, not by whether it
 * would be allowed today.
 */
export function passwordProblem(password: string, email?: string): string | null {
  if (password === '') return 'Choose a password.';
  if (password.length > PASSWORD_MAX) {
    return `Keep it under ${PASSWORD_MAX} characters.`;
  }

  const unmet = unmetRules(password);
  if (unmet.length > 0) {
    return `Your password still needs: ${unmet.map((rule) => rule.label.toLowerCase()).join(', ')}.`;
  }

  if (email && password.toLowerCase() === normaliseEmail(email)) {
    return 'Your password cannot be your email address.';
  }

  return null;
}

/** Whether the confirmation field matches, phrased for the student. */
export function confirmationProblem(password: string, confirmation: string): string | null {
  if (confirmation === '') return 'Type your password a second time to confirm it.';
  if (confirmation !== password) return 'Those two passwords do not match.';
  return null;
}
