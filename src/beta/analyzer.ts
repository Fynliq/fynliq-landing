import type { AidAnalysis } from '../core';
import { httpAnalyzer } from './httpAnalyzer';
import { stubAnalyzer } from './stubAnalyzer';

/**
 * The seam between the upload flow and whatever reads the document.
 *
 * The flow depends on this interface and nothing else. Point
 * `VITE_FYNLIQ_ANALYZE_URL` at an endpoint and the whole product runs on real
 * reads; leave it unset and it runs on the stub, which walks the same stages,
 * fails the same way, and labels its figures as demo ones on screen.
 *
 * Connecting the backend is one environment variable. No component changes.
 */

/** The four things the reader does, in the order a student would expect them. */
export type AnalyzeStage = 'reading' | 'extracting' | 'checking' | 'writing';

export const ANALYZE_STAGES: readonly AnalyzeStage[] = [
  'reading',
  'extracting',
  'checking',
  'writing',
];

export const STAGE_LABEL: Record<AnalyzeStage, string> = {
  reading: 'Reading your document',
  extracting: 'Finding your award lines',
  checking: 'Checking them against your bill',
  writing: 'Writing your answer',
};

export type AnalysisErrorKind =
  /** The request never completed — offline, DNS, CORS, a dead endpoint. */
  | 'network'
  /** The reader answered, but not with something this app can use. */
  | 'format'
  /** The reader answered, and said it could not use the document. */
  | 'rejected'
  /** The student pressed cancel. Not an error to apologise for. */
  | 'cancelled';

export class AnalysisError extends Error {
  constructor(
    message: string,
    readonly kind: AnalysisErrorKind,
  ) {
    super(message);
    this.name = 'AnalysisError';
  }
}

export interface AnalyzeOptions {
  signal?: AbortSignal;
  /**
   * Called as each stage begins. A backend that streams progress can drive
   * the interface honestly; one that does not simply reports fewer stages.
   */
  onStage?: (stage: AnalyzeStage) => void;
}

export interface AidAnalyzer {
  /** False while running on the stub, which the results page states on screen. */
  readonly connected: boolean;
  analyze(files: File[], options?: AnalyzeOptions): Promise<AidAnalysis>;
}

/** A cancellable wait. Rejects the moment the student presses cancel. */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AnalysisError('Analysis cancelled.', 'cancelled'));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      reject(new AnalysisError('Analysis cancelled.', 'cancelled'));
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Picks the reader from the environment.
 *
 * Kept as a function rather than a module-level constant so a test — or a
 * future settings screen — can construct one against any endpoint.
 */
export function createAnalyzer(endpoint = import.meta.env.VITE_FYNLIQ_ANALYZE_URL ?? (import.meta.env.PROD ? '/api/analyze' : undefined)): AidAnalyzer {
  return endpoint ? httpAnalyzer(endpoint) : stubAnalyzer();
}
