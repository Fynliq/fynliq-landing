import { analysisFromFacts, type AidAnalysis } from '../core';
import { computeAidOverview } from '../../server/aid-overview.js';

/**
 * "See an example": a made-up award, never a real student.
 *
 * Built from fake figures with the same code that builds a real answer, so the
 * example shows exactly what Fynliq does — and nothing here touches the
 * server, an account or a payment.
 */
const FACTS = [
  { field: 'grantOffer', label: 'Federal Pell Grant', value: '7395' },
  { field: 'subsidizedLoanOffer', label: 'Direct Subsidized Loan', value: '3500' },
  { field: 'unsubsidizedLoanOffer', label: 'Direct Unsubsidized Loan', value: '2000' },
  { field: 'costOfAttendance', label: 'Example tuition and fees', value: '14200' },
].map((f, i) => ({
  ...f,
  id: `example-${i + 1}`,
  page: 1,
  document: 1,
  kind: 'award-letter',
  period: '2026–27 academic year',
  estimated: false,
  quote: 'Example only',
}));

export function exampleAnalysis(): AidAnalysis {
  const base = analysisFromFacts({
    example: true,
    provenance: 'demo',
    document: { fileNames: ['Example award letter'], kind: 'award-letter', readAt: new Date().toISOString(), confidence: 1 },
    student: { firstName: null, school: null },
    sai: null,
    award: { year: '2026–27', source: 'Example', lines: [], costOfAttendance: null },
    semester: null,
    unread: [],
    summaryFacts: FACTS,
  } as AidAnalysis);
  return {
    ...base,
    example: true,
    provenance: 'demo',
    reviewed: true,
    document: { ...base.document, confidence: 1 },
    overview: computeAidOverview(FACTS),
  };
}
