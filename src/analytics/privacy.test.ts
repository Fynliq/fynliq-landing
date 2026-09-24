import { describe, expect, it } from 'vitest';
import { analyticsPath, redactPageview } from './privacy';

describe('analytics privacy boundary', () => {
  it('removes personal question text and fragments from page URLs', () => {
    expect(redactPageview({ type: 'pageview', url: 'https://www.fynliq.com/ask?q=private-question#private-details' }))
      .toEqual({ type: 'pageview', url: 'https://www.fynliq.com/ask' });
  });
  it('rejects arbitrary paths that could contain personal information', () => {
    expect(analyticsPath('/search/private-student-question')).toBeNull();
    expect(redactPageview({ type: 'pageview', url: 'https://www.fynliq.com/student/private-id' })).toBeNull();
  });
  it('rejects custom events and non-live origins', () => {
    expect(redactPageview({ type: 'event', url: 'https://www.fynliq.com/ask' })).toBeNull();
    expect(redactPageview({ type: 'pageview', url: 'https://preview.vercel.app/ask' })).toBeNull();
    expect(redactPageview({ type: 'pageview', url: 'invalid' })).toBeNull();
  });
  it('allows the student journey without student-specific data', () => {
    for (const path of ['/', '/beta', '/beta/results', '/search', '/ask', '/gradi']) {
      expect(analyticsPath(path)).toBe(path);
    }
    expect(analyticsPath('/ask/')).toBe('/ask');
  });
});
