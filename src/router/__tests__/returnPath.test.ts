import { describe, expect, it } from 'vitest';
import { pathOf, safeReturnPath } from '../returnPath';

describe('safeReturnPath', () => {
  it('keeps a page on this site, query string and fragment included', () => {
    expect(safeReturnPath('/beta')).toBe('/beta');
    expect(safeReturnPath('/beta/checkout?result=cancelled')).toBe('/beta/checkout?result=cancelled');
    expect(safeReturnPath('/search/fafsa-deadline#answer')).toBe('/search/fafsa-deadline#answer');
  });

  it('refuses anything that could leave the site', () => {
    for (const raw of [
      '//evil.example/beta',
      '/\\evil.example',
      '\\\\evil.example',
      'https://evil.example/beta',
      'javascript:alert(1)',
      'beta',
      '/beta\n//evil.example',
      '/\tevil',
    ]) {
      expect(safeReturnPath(raw), raw).toBeNull();
    }
  });

  it('refuses nothing at all', () => {
    expect(safeReturnPath(null)).toBeNull();
    expect(safeReturnPath(undefined)).toBeNull();
    expect(safeReturnPath('')).toBeNull();
    expect(safeReturnPath(`/${'a'.repeat(2001)}`)).toBeNull();
  });

  it('collapses dot segments rather than passing them on', () => {
    expect(safeReturnPath('/beta/../ask')).toBe('/ask');
    expect(safeReturnPath('/../../etc')).toBe('/etc');
  });
});

describe('pathOf', () => {
  it('drops the query string and fragment for route matching', () => {
    expect(pathOf('/beta/checkout?result=cancelled')).toBe('/beta/checkout');
    expect(pathOf('/search/x#y')).toBe('/search/x');
    expect(pathOf('/ask')).toBe('/ask');
  });
});
