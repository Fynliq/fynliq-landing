import { analysisFromFacts, type AidAnalysis } from '../core';
import { AnalysisError, type AidAnalyzer, type AnalyzeOptions } from './analyzer';
import { AnalysisFormatError, parseAnalysis } from './contract';
import { readDocuments } from './documentText';
import { redactDocuments } from '../../server/redact.js';

/** JSON property containing the redacted text of each document. */
export const UPLOAD_FIELD = 'documents';

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

      if (!files.length || files.length > 3 || files.reduce((sum, f) => sum + f.size, 0) > 2800000) throw new AnalysisError('Upload 1–3 documents totaling no more than 2.8 MB.', 'rejected');

      // 1. Read each file on this device. The file itself is never uploaded.
      onStage?.('reading');
      let pages: string[][];
      try {
        pages = await readDocuments(files);
      } catch {
        if (signal?.aborted) throw new AnalysisError('Analysis cancelled.', 'cancelled');
        throw new AnalysisError('Fynliq could not open one of these files. Try a PDF or a clear screenshot of your aid page.', 'rejected');
      }
      if (signal?.aborted) throw new AnalysisError('Analysis cancelled.', 'cancelled');

      // 2. Black out personal details and keep only the aid lines, still on this device.
      onStage?.('extracting');
      const redacted = redactDocuments(pages.map((p) => ({ pages: p })));
      if (redacted.every((doc) => doc.keptLines === 0)) {
        throw new AnalysisError('Fynliq could not find Pell Grant, scholarship, loan, SAI or balance figures in these files. Try a clearer screenshot of your aid summary.', 'rejected');
      }
      const body = JSON.stringify({
        consent: true,
        documents: files.map((file, i) => ({ name: file.name, pages: redacted[i].pages })),
      });

      // 3. Only the redacted aid lines are sent to be read.
      onStage?.('checking');

      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          body,
          signal,
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
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
          'The document reader is not responding right now. Please try again in a moment.',
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
        return analysisFromFacts(parseAnalysis(payload));
      } catch (error) {
        if (error instanceof AnalysisFormatError) {
          throw new AnalysisError(error.message, 'format');
        }
        throw error;
      }
    },
  };
}
