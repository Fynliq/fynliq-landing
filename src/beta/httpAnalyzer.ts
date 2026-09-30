import { analysisFromFacts, type AidAnalysis } from '../core';
import {
  AnalysisError,
  type AidAnalyzer,
  type AnalyzeOptions,
  type PreparedDocuments,
  type SubmitInput,
} from './analyzer';
import { AnalysisFormatError, parseAnalysis } from './contract';
import { readDocuments } from './documentText';
import { redactDocuments } from '../../server/redact.js';

/** JSON property containing the redacted text of each document. */
export const UPLOAD_FIELD = 'documents';

/** The server's structured "pay first" answer. See api/analyze.js. */
export const UNLOCK_REQUIRED_CODE = 'beta_unlock_required';

/**
 * Reads the student's files on this device, then posts only the redacted aid
 * lines to the document reader and validates what comes back.
 *
 * The two halves are exposed separately (`prepare`, `submit`) so the My Aid
 * flow can hold a finished, redacted read in memory while the student
 * completes the one-time $1 unlock, and then send it without asking for the
 * files again. `analyze` is still both halves in one call.
 *
 * The response is checked against `parseAnalysis` before anything downstream
 * sees it, so a backend still under construction fails loudly at the boundary
 * with the offending path named, rather than quietly rendering a wrong figure
 * to somebody deciding how much to borrow.
 */
export function httpAnalyzer(endpoint: string): AidAnalyzer {
  async function prepare(files: File[], options: AnalyzeOptions = {}): Promise<PreparedDocuments> {
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
    return {
      documents: files.map((file, i) => ({ name: file.name, pages: redacted[i].pages })),
      withAidLines: redacted.filter((doc) => doc.keptLines > 0).length,
    };
  }

  async function submit(input: SubmitInput, options: AnalyzeOptions = {}): Promise<AidAnalysis> {
    const { signal, onStage } = options;
    const body = JSON.stringify(
      'pendingId' in input
        ? { consent: true, pendingId: input.pendingId }
        : { consent: true, documents: input.prepared.documents },
    );

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
      throw new AnalysisError(
        'Fynliq could not reach the document reader. Check your connection and try again.',
        'network',
      );
    }

    if (response.status === 402) {
      // The paywall lives on the server; this only turns its answer into the
      // unlock screen. Anything else in the body is ignored.
      const detail = await response.json().catch(() => null);
      const message = detail && typeof detail.message === 'string' && detail.code === UNLOCK_REQUIRED_CODE
        ? detail.message : 'Unlock My Aid to continue.';
      throw new AnalysisError(message.slice(0, 200), 'unlock_required');
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
  }

  return {
    connected: true,
    prepare,
    submit,
    async analyze(files: File[], options: AnalyzeOptions = {}): Promise<AidAnalysis> {
      return submit({ prepared: await prepare(files, options) }, options);
    },
  };
}
