// FYNLIQ Intelligence: one structured log line per intelligence request.
//
// Metadata only: ids, timings, token counts, validation results and content-
// free error codes. Never the snapshot, the prompt, the model output or any
// student data. Lines go to the function's stdout (Vercel runtime logs) with
// type "fynliq_intelligence" so they can be filtered.
import { randomUUID } from 'node:crypto';

export const newRequestId = () => `intel_${randomUUID()}`;

const FIELDS = ['requestId', 'timestamp', 'agent', 'provider', 'model', 'latencyMs', 'success', 'attempts', 'inputTokens',
  'outputTokens', 'estimatedCostUsd', 'schemaValid', 'groundingValid', 'validationErrors', 'errorCode', 'dataSource', 'period'];

/** Keeps only known metadata fields; validation errors are reduced to their codes. */
export function logRecord(record) {
  const out = { type: 'fynliq_intelligence' };
  for (const f of FIELDS) if (record[f] !== undefined) out[f] = record[f];
  if (Array.isArray(out.validationErrors)) out.validationErrors = out.validationErrors.slice(0, 10).map((e) => String(e).split(':').slice(0, 2).join(':'));
  return out;
}

export function createLogger(sink = (line) => console.info(line)) {
  return (record) => { try { sink(JSON.stringify(logRecord(record))); } catch { /* logging never breaks a request */ } };
}
