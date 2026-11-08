import { analysisFromFacts } from '../core';
import { AnalysisError, type AidAnalyzer, type AnalyzeOptions, type AnalyzeResult } from './analyzer';
import { parseLocked } from './preview';
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

    async fetchSaved(signal?: AbortSignal): Promise<AnalyzeResult | null> {
      let response: Response;
      try {
        response = await fetch(endpoint, { method: 'GET', signal, credentials: 'same-origin', headers: { Accept: 'application/json' } });
      } catch { return null; }
      if (!response.ok) return null;
      const payload: unknown = await response.json().catch(() => null);
      const locked = parseLocked(payload);
      if (locked) return locked;
      try { return analysisFromFacts(parseAnalysis(payload)); } catch { return null; }
    },

    async analyze(files: File[], options: AnalyzeOptions = {}): Promise<AnalyzeResult> {
      const { signal, onStage } = options;

      if (!files.length || files.length > 3 || files.reduce((sum, f) => sum + f.size, 0) > 2800000) throw new AnalysisError('Upload 1–3 documents totaling no more than 2.8 MB.', 'rejected');

      // 1. Read each file on this device. The file itself is never uploaded.
      onStage?.('reading');
      let pages: string[][];
      try {
        pages = await readDocuments(files);
      } catch {
        if (signal?.aborted) throw new AnalysisError('Analysis cancelled.', 'cancelled');
        throw new AnalysisError('We couldn’t upload that image. Please try again.', 'rejected');
      }
      if (signal?.aborted) throw new AnalysisError('Analysis cancelled.', 'cancelled');

      // 2. Black out personal details and keep only the aid lines, still on this device.
      onStage?.('extracting');
      const redacted = redactDocuments(pages.map((p) => ({ pages: p })));
      if (redacted.every((doc) => doc.keptLines === 0)) {
        throw new AnalysisError('We couldn’t read enough information from this image. Try uploading a clearer screenshot.', 'rejected');
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
          credentials: 'same-origin',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        });
      } catch {
        if (signal?.aborted) throw new AnalysisError('Analysis cancelled.', 'cancelled');
        throw new AnalysisError('We couldn’t upload that image. Please try again.', 'network');
      }

      // The paywall lives on the server (api/analyze.js). This only turns its
      // structured answer into the unlock step; the body is otherwise ignored.
      if (response.status === 402) {
        throw new AnalysisError('Unlock My Aid to continue.', 'unlock_required');
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

        throw new AnalysisError('We couldn’t analyze your aid summary. Please try again.', 'network');
      }

      onStage?.('writing');

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new AnalysisError('The document reader did not return JSON.', 'format');
      }

      // Before the $1 unlock the server sends a preview only.
      const locked = parseLocked(payload);
      if (locked) return locked;

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
