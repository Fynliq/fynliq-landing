import { describe, expect, it } from 'vitest';
import { uploadReadiness } from '../readiness';

describe('uploadReadiness', () => {
  it('asks for a file first, whatever the consent state', () => {
    for (const consentRequired of [true, false]) {
      for (const consented of [true, false]) {
        expect(uploadReadiness({ fileCount: 0, consentRequired, consented })).toEqual({
          canSubmit: false,
          note: 'Add at least one file to continue.',
        });
      }
    }
  });

  it('is ready with files when consent is not required, and never mentions the box', () => {
    const result = uploadReadiness({ fileCount: 2, consentRequired: false, consented: false });

    expect(result.canSubmit).toBe(true);
    expect(result.note).toBe('2 files ready. This takes a few seconds.');
    expect(result.note).not.toContain('Tick');
  });

  it('names the unticked box as the reason when consent is required', () => {
    expect(uploadReadiness({ fileCount: 1, consentRequired: true, consented: false })).toEqual({
      canSubmit: false,
      note: 'Tick the box above to continue.',
    });
  });

  it('is ready once consent is given', () => {
    expect(uploadReadiness({ fileCount: 1, consentRequired: true, consented: true })).toEqual({
      canSubmit: true,
      note: '1 file ready. This takes a few seconds.',
    });
  });

  it('matches the condition the button used before, for every combination', () => {
    for (const fileCount of [0, 1, 4]) {
      for (const consentRequired of [true, false]) {
        for (const consented of [true, false]) {
          const before = !(fileCount === 0 || (consentRequired && !consented));
          expect(uploadReadiness({ fileCount, consentRequired, consented }).canSubmit).toBe(before);
        }
      }
    }
  });
});
