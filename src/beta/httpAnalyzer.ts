import type { AidAnalysis } from '../core';
import { AnalysisError, type AidAnalyzer, type AnalyzeOptions } from './analyzer';
import { AnalysisFormatError, parseAnalysis } from './contract';

/** The multipart field name every file is sent under. */
export const UPLOAD_FIELD = 'files';

/**
 * Posts the student's files to the document reader and validates what comes
 * back.
 *
 * The response is checked against `parseAnalysis` before anything downstream
 * sees it, so a backend still under construction fails loudly at the boundary
 * with the offending path named, rather than quietly rendering a wrong figure
 * to somebody deciding how much to borrow.
 */
export function httpAnalyzer(endpoint: string): AidAnalyzer {
  return {
    connected: true,

    async analyze(files: File[], options: AnalyzeOptions = {}): Promise<AidAnalysis> {
      const { signal, onStage } = options;

      const body = new FormData();
      for (const file of files) body.append(UPLOAD_FIELD, file, file.name);

      onStage?.('reading');

      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          body,
          signal,
          headers: { Accept: 'application/json' },
        });
      } catch {
        if (signal?.aborted) throw new AnalysisError('Analysis cancelled.', 'cancelled');
        throw new AnalysisError(
          'Fynliq could not reach the document reader. Check your connection and try again.',
          'network',
        );
      }

      if (!response.ok) {
        // A 4xx is the reader telling us something about this document; a 5xx
        // is the reader having a bad day. They read differently to a student.
        const detail = await response.text().catch(() => '');
        const trimmed = detail.trim().slice(0, 200);

        if (response.status >= 400 && response.status < 500) {
          throw new AnalysisError(
            trimmed || 'The reader could not use this document. Try a clearer copy of the page.',
            'rejected',
          );
        }

        throw new AnalysisError(
          'The document reader is not responding right now. Your files were not stored — try again in a moment.',
          'network',
        );
      }

      onStage?.('writing');

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new AnalysisError('The document reader did not return JSON.', 'format');
      }

      try {
        return parseAnalysis(payload);
      } catch (error) {
        if (error instanceof AnalysisFormatError) {
          throw new AnalysisError(error.message, 'format');
        }
        throw error;
      }
    },
  };
}
