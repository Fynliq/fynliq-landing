/**
 * Whether the upload step can start, and the sentence that says why not.
 *
 * One function for both, so the button and the words beside it cannot
 * disagree. A disabled button next to "1 file ready" is a button that looks
 * broken: the note has to name whatever is actually holding it back.
 */

export interface ReadinessInput {
  /** Files accepted into the dropzone. */
  fileCount: number;
  /** True when the reader is connected, so the AI-processing consent applies. */
  consentRequired: boolean;
  /** Whether the consent box is ticked. Ignored when consent is not required. */
  consented: boolean;
}

export interface Readiness {
  canSubmit: boolean;
  note: string;
}

export function uploadReadiness({ fileCount, consentRequired, consented }: ReadinessInput): Readiness {
  if (fileCount === 0) {
    return { canSubmit: false, note: 'Add at least one file to continue.' };
  }

  if (consentRequired && !consented) {
    return { canSubmit: false, note: 'Tick the box above to continue.' };
  }

  return {
    canSubmit: true,
    note: `${fileCount} file${fileCount === 1 ? '' : 's'} ready. This takes a few seconds.`,
  };
}
