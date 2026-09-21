import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  confirmationProblem,
  emailProblem,
  normaliseEmail,
  passwordProblem,
  unmetRules,
} from '../validate';

describe('normaliseEmail', () => {
  it('trims and lower-cases, so one person is one account', () => {
    expect(normaliseEmail('  Sam@School.EDU ')).toBe('sam@school.edu');
  });

  it('leaves an already-normal address alone', () => {
    expect(normaliseEmail('sam@school.edu')).toBe('sam@school.edu');
  });
});

describe('emailProblem', () => {
  it('accepts the addresses students actually have', () => {
    for (const address of [
      'sam@school.edu',
      'sam.jones+aid@mail.school.edu',
      'SAM@SCHOOL.EDU',
      "o'brien@school.edu",
      'sam_jones99@gmail.com',
    ]) {
      expect(emailProblem(address), address).toBeNull();
    }
  });

  it('asks for one rather than complaining when the field is empty', () => {
    expect(emailProblem('')).toMatch(/enter the email/i);
    expect(emailProblem('   ')).toMatch(/enter the email/i);
  });

  it('names the missing @ rather than saying "invalid"', () => {
    expect(emailProblem('sam.school.edu')).toMatch(/@/);
  });

  it('rejects addresses that cannot be delivered to', () => {
    for (const address of ['sam@', '@school.edu', 'sam@school', 'sam @school.edu', 'a@b..c']) {
      expect(emailProblem(address), address).not.toBeNull();
    }
  });

  it('rejects an address too long to be a real one', () => {
    expect(emailProblem(`${'a'.repeat(250)}@school.edu`)).toMatch(/too long/i);
  });
});

describe('passwordProblem', () => {
  it('accepts a password that meets every rule', () => {
    expect(passwordProblem('rainyTuesday7', 'sam@school.edu')).toBeNull();
  });

  it('asks for one rather than listing rules at an empty field', () => {
    expect(passwordProblem('')).toMatch(/choose a password/i);
  });

  it(`rejects anything shorter than ${PASSWORD_MIN} characters`, () => {
    expect(passwordProblem('ab3')).toMatch(/8 characters/);
  });

  it('requires a letter as well as digits', () => {
    expect(passwordProblem('12345678')).toMatch(/letter/i);
  });

  it('requires a number or a symbol as well as letters', () => {
    expect(passwordProblem('rainytuesday')).toMatch(/number or a symbol/i);
  });

  it('accepts a symbol in place of a number', () => {
    expect(passwordProblem('rainy-tuesday')).toBeNull();
  });

  it('counts letters and digits outside the Latin alphabet', () => {
    expect(passwordProblem('пароль2026')).toBeNull();
  });

  it('refuses a password that is the address it protects', () => {
    expect(passwordProblem('Sam@School.edu', 'sam@school.edu')).toMatch(/cannot be your email/i);
  });

  it('allows an address-shaped password for a different address', () => {
    expect(passwordProblem('sam@school.edu', 'alex@school.edu')).toBeNull();
  });

  it(`refuses more than ${PASSWORD_MAX} characters, which is a hashing cost`, () => {
    expect(passwordProblem('a1'.repeat(PASSWORD_MAX))).toMatch(/under 128/i);
  });

  it('lists everything still missing in one sentence', () => {
    const problem = passwordProblem('abc');
    expect(problem).toMatch(/8 characters/);
    expect(problem).toMatch(/number or a symbol/);
  });
});

describe('unmetRules', () => {
  it('is empty for a password that passes', () => {
    expect(unmetRules('rainyTuesday7')).toEqual([]);
  });

  it('names each rule the student has not met yet', () => {
    expect(unmetRules('abc').map((rule) => rule.id)).toEqual(['length', 'other']);
  });
});

describe('confirmationProblem', () => {
  it('passes when the two match exactly', () => {
    expect(confirmationProblem('rainyTuesday7', 'rainyTuesday7')).toBeNull();
  });

  it('asks for the second copy rather than calling it a mismatch', () => {
    expect(confirmationProblem('rainyTuesday7', '')).toMatch(/second time/i);
  });

  it('is case sensitive, because passwords are', () => {
    expect(confirmationProblem('rainyTuesday7', 'rainytuesday7')).toMatch(/do not match/i);
  });
});
