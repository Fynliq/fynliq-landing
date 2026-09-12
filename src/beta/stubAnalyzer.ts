import type { AidAnalysis } from '../core';
import { DEMO_AWARD, DEMO_SEMESTER } from '../data/demo';
import { ANALYZE_STAGES, delay, type AidAnalyzer, type AnalyzeOptions } from './analyzer';

/** Roughly what each stage would cost against a real reader. */
const STAGE_MS: Record<(typeof ANALYZE_STAGES)[number], number> = {
  reading: 900,
  extracting: 1_100,
  checking: 800,
  writing: 700,
};

/**
 * The reader used until the backend is connected.
 *
 * It returns the same demo student the landing page renders, marked
 * `provenance: 'demo'` — which the results page turns into a banner saying, in
 * words, that these are not the figures in the file that was just uploaded.
 * That marking is the whole point of it: a stub that dressed placeholder
 * figures up as somebody's real aid would be the worst thing this product
 * could ship, and it is the one mistake the type system here makes awkward.
 *
 * It is not a mock in the testing sense. It walks the real stages, honours
 * cancellation, and takes real time, so the flow being reviewed is the flow
 * that will ship.
 */
export function stubAnalyzer(): AidAnalyzer {
  return {
    connected: false,

    async analyze(files: File[], options: AnalyzeOptions = {}): Promise<AidAnalysis> {
      const { signal, onStage } = options;

      for (const stage of ANALYZE_STAGES) {
        onStage?.(stage);
        await delay(STAGE_MS[stage], signal);
      }

      return {
        provenance: 'demo',
        document: {
          fileNames: files.map((file) => file.name),
          kind: 'award-letter',
          readAt: new Date().toISOString(),
          confidence: 0.92,
        },
        student: { firstName: null, school: null },
        sai: 0,
        award: DEMO_AWARD,
        semester: DEMO_SEMESTER,
        unread: [
          {
            field: 'Next disbursement date',
            where:
              "Your school's disbursement calendar, or the refund date shown on your student account.",
          },
        ],
      };
    },
  };
}
