import { describe, expect, it } from 'vitest';
import { PRICE_LINE, UNLOCKS } from '../offer';

/** Every screen's source, as text. */
const SCREENS = import.meta.glob<string>(['../../**/*.tsx', '!../../**/__tests__/**'], { query: '?raw', import: 'default', eager: true });

describe('the offer', () => {
  it('names the free preview and the $1 in one sentence', () => {
    expect(PRICE_LINE).toBe('Free preview, then $1 to unlock the full analysis.');
  });

  it('counts the flagged items it promises to explain', () => {
    const review = UNLOCKS.find((item) => item.label === 'Important things to review');
    expect(review?.what(1)).toMatch(/The 1 thing/);
    expect(review?.what(3)).toMatch(/The 3 things/);
    expect(review?.what(0)).toMatch(/Anything worth checking/);
  });

  it('is the only place a screen states the price', () => {
    // A price typed into a page drifts from this file. Screens import it instead.
    const offenders = Object.entries(SCREENS)
      .filter(([, source]) => /\$1(?![0-9,.])/.test(source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')))
      .map(([path]) => path);
    expect(Object.keys(SCREENS).length).toBeGreaterThan(20);
    expect(offenders).toEqual([]);
  });
});
