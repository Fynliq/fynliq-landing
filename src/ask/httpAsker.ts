import type { AidAnalysis } from '../core';
import { AskError, type AskAnswer, type Asker, type AskOptions } from './asker';
import { AskFormatError, parseAskAnswer } from './contract';

/**
 * Asks the answer service, and validates what comes back.
 *
 * The student's own analysis is sent with the question, because an answer
 * about their refund is worthless without their figures. It is sent as the
 * structured read — the same `AidAnalysis` the document reader returned —
 * and never as the uploaded files themselves, which are not kept past the
 * upload step and are not this service's business.
 */
export function httpAsker(endpoint: string): Asker {
  return {
    connected: true,

    async ask(
      question: string,
      analysis: AidAnalysis | null,
      options: AskOptions = {},
    ): Promise<AskAnswer> {
      const { signal } = options;

      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          signal,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ question, analysis: analysis ? {
            summaryToken: analysis.summaryToken,
            reviewed: analysis.reviewed === true,
          } : null }),
        });
      } catch {
        if (signal?.aborted) throw new AskError('Cancelled.', 'cancelled');
        throw new AskError(
          'Fynliq could not reach the answer service. Check your connection and try again.',
          'network',
        );
      }

      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).trim().slice(0, 200);

        if (response.status >= 400 && response.status < 500) {
          throw new AskError(
            detail || 'The answer service could not use that question. Try rephrasing it.',
            'rejected',
          );
        }

        throw new AskError(
          'The answer service is not responding right now. Try again in a moment.',
          'network',
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new AskError('The answer service did not return JSON.', 'format');
      }

      try {
        return parseAskAnswer(payload);
      } catch (error) {
        if (error instanceof AskFormatError) throw new AskError(error.message, 'format');
        throw error;
      }
    },
  };
}
