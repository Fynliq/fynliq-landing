import { describe, expect, it } from 'vitest';
import { AuthFormatError, expired, parseAccount, parseSession } from '../contract';

/** The worked example from docs/AUTH_API.md, kept honest by these tests. */
const valid = () => ({
  token: 'sess_9f2a1c8e4b7d',
  expiresAt: '2026-10-19T09:30:00.000Z',
  account: {
    email: 'sam@school.edu',
    firstName: 'Sam',
    createdAt: '2026-09-19T09:30:00.000Z',
  },
});

/** Replaces one key on the account, so each test states only what it broke. */
function withAccount(field: string, value: unknown) {
  const payload = valid();
  return { ...payload, account: { ...payload.account, [field]: value } };
}

describe('parseSession', () => {
  it('accepts the documented shape', () => {
    expect(parseSession(valid())).toEqual({
      token: 'sess_9f2a1c8e4b7d',
      expiresAt: '2026-10-19T09:30:00.000Z',
      account: {
        email: 'sam@school.edu',
        firstName: 'Sam',
        createdAt: '2026-09-19T09:30:00.000Z',
      },
    });
  });

  it('accepts a cookie-backed service, which returns no token', () => {
    expect(parseSession({ ...valid(), token: null }).token).toBeNull();
  });

  it('treats a missing token the same as an explicit null', () => {
    const { token: _dropped, ...rest } = valid();
    expect(parseSession(rest).token).toBeNull();
  });

  it('accepts a session with no stated end', () => {
    expect(parseSession({ ...valid(), expiresAt: null }).expiresAt).toBeNull();
  });

  it('refuses a body that is not an object', () => {
    for (const body of [null, 'ok', 42, ['session']]) {
      expect(() => parseSession(body)).toThrow(AuthFormatError);
    }
  });

  it('refuses a response with no account, however cheerful', () => {
    expect(() => parseSession({ ok: true, token: 'sess_1' })).toThrow(/account/);
  });

  it('refuses an empty token, which is neither a token nor a cookie', () => {
    expect(() => parseSession({ ...valid(), token: '' })).toThrow(/token/);
  });

  it('refuses an expiry it cannot turn into a date', () => {
    expect(() => parseSession({ ...valid(), expiresAt: 'next Tuesday' })).toThrow(/expiresAt/);
  });

  it('names the exact path that was wrong', () => {
    try {
      parseSession(withAccount('createdAt', 1_758_000_000));
      expect.unreachable('a numeric createdAt should not parse');
    } catch (error) {
      expect(error).toBeInstanceOf(AuthFormatError);
      expect((error as AuthFormatError).path).toBe('account.createdAt');
    }
  });
});

describe('parseAccount', () => {
  it('accepts an account with no name on file', () => {
    expect(parseAccount(withAccount('firstName', null).account).firstName).toBeNull();
  });

  it('refuses an empty string where a name or null belongs', () => {
    expect(() => parseAccount(withAccount('firstName', '').account)).toThrow(/firstName/);
  });

  it('refuses an omitted firstName, because omission is a bug not a shorthand', () => {
    const { firstName: _dropped, ...account } = valid().account;
    expect(() => parseAccount(account)).toThrow(/firstName/);
  });

  it('refuses an address that is not normalised', () => {
    expect(() => parseAccount(withAccount('email', 'Sam@School.edu').account)).toThrow(
      /trimmed, lower-cased/,
    );
    expect(() => parseAccount(withAccount('email', ' sam@school.edu').account)).toThrow(
      /trimmed, lower-cased/,
    );
  });

  it('refuses an account with no email at all', () => {
    expect(() => parseAccount(withAccount('email', '').account)).toThrow(/email/);
  });
});

describe('expired', () => {
  const at = (expiresAt: string | null) => ({ ...parseSession(valid()), expiresAt });

  it('is false before the stated end', () => {
    expect(expired(at('2026-10-19T09:30:00.000Z'), Date.parse('2026-10-01T00:00:00Z'))).toBe(false);
  });

  it('is true after it', () => {
    expect(expired(at('2026-10-19T09:30:00.000Z'), Date.parse('2026-11-01T00:00:00Z'))).toBe(true);
  });

  it('is true exactly on the boundary, so a stale session is never let past', () => {
    expect(expired(at('2026-10-19T09:30:00.000Z'), Date.parse('2026-10-19T09:30:00.000Z'))).toBe(
      true,
    );
  });

  it('never expires a session with no stated end', () => {
    expect(expired(at(null), Date.parse('2099-01-01T00:00:00Z'))).toBe(false);
  });
});
