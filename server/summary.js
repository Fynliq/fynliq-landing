import { createHmac, timingSafeEqual } from 'node:crypto';

export const FACT_KEYS = ['sai', 'awardYear', 'processingStatus', 'estimatedPellGrant', 'verificationStatus', 'grantOffer', 'scholarshipOffer', 'subsidizedLoanOffer', 'unsubsidizedLoanOffer', 'workStudyOffer', 'costOfAttendance', 'schoolBill', 'paymentApplied', 'balanceDue', 'creditBalance', 'disbursementDate'];
export const DOCUMENT_KINDS = ['fafsa-submission-summary', 'award-letter', 'account-statement'];
export const summarySchema = {
  type: 'object', additionalProperties: false, required: ['supported', 'facts', 'conflicts'],
  properties: {
    supported: { type: 'boolean' },
    conflicts: { type: 'array', items: { type: 'string' } },
    facts: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['field', 'label', 'value', 'page', 'document', 'kind', 'period', 'estimated', 'quote'],
      properties: {
        field: { type: 'string', enum: FACT_KEYS }, value: { type: 'string' },
        label: { type: 'string' }, document: { type: 'integer' }, kind: { type: 'string', enum: DOCUMENT_KINDS },
        period: { type: 'string' }, estimated: { type: 'boolean' },
        page: { type: 'integer' }, quote: { type: 'string' },
      },
    } },
  },
};

export function validateSummary(data, fileCount = 3) {
  if (!data?.supported || !Array.isArray(data.conflicts) || data.conflicts.length || !Array.isArray(data.facts) || !data.facts.length || data.facts.length > 40) throw Error('Unreadable or conflicting documents');
  const seen = new Map();
  return data.facts.map((f, index) => {
    if (!FACT_KEYS.includes(f.field) || typeof f.value !== 'string' || !f.value.trim() || f.value.length > 120 ||
      !DOCUMENT_KINDS.includes(f.kind) || typeof f.label !== 'string' || !f.label.trim() || f.label.length > 100 ||
      typeof f.period !== 'string' || f.period.length > 80 || typeof f.estimated !== 'boolean' ||
      !Number.isInteger(f.document) || f.document < 1 || f.document > fileCount ||
      typeof f.quote !== 'string' || !f.quote.trim() || f.quote.length > 400 || !Number.isInteger(f.page) || f.page < 1 || f.page > 100) throw Error('Invalid extracted field');
    if (/\b\d{3}-\d{2}-\d{4}\b/.test(f.quote)) throw Error('Sensitive identifier in evidence');
    // The extracted value must actually appear in the quoted evidence.
    const normalize = text => text.toLowerCase().replace(/[$,\s]/g, '');
    if (!normalize(f.quote).includes(normalize(f.value))) throw Error('Unsupported value');
    const key = `${f.field}|${normalize(f.label)}|${normalize(f.period)}`;
    if (seen.has(key) && seen.get(key) !== normalize(f.value)) throw Error('Conflicting values');
    seen.set(key, normalize(f.value));
    if (f.field === 'sai') {
      const n = Number(f.value.replace(/[$,\s]/g, ''));
      if (!Number.isInteger(n) || n < -1500 || n > 999999) throw Error('Invalid SAI');
    }
    if (['estimatedPellGrant', 'grantOffer', 'scholarshipOffer', 'subsidizedLoanOffer', 'unsubsidizedLoanOffer', 'workStudyOffer', 'costOfAttendance', 'schoolBill', 'paymentApplied', 'balanceDue', 'creditBalance'].includes(f.field)) {
      const n = Number(f.value.replace(/[$,\s]/g, ''));
      if (!Number.isFinite(n) || n < 0 || n > 10000000) throw Error('Invalid monetary value');
    }
    return { id: `f${index + 1}`, field: f.field, label: f.label.trim(), value: f.value.trim(), page: f.page, document: f.document, kind: f.kind,
      period: f.period.trim() || 'Not stated', estimated: f.field === 'estimatedPellGrant' || (f.kind === 'fafsa-submission-summary' && /Offer$/.test(f.field)) || f.estimated, quote: f.quote.trim() };
  });
}

function signature(body, secret) {
  return createHmac('sha256', secret).update('fynliq-summary-v1:' + body).digest('base64url');
}
export function signSummary(facts, secret, now = Date.now()) {
  if (!secret) throw Error('Missing signing key');
  const body = Buffer.from(JSON.stringify({ facts, exp: now + 3600000 })).toString('base64url');
  return `${body}.${signature(body, secret)}`;
}
export function verifySummary(token, secret, now = Date.now()) {
  if (!secret || typeof token !== 'string' || token.length > 60000) throw Error('Invalid summary');
  const parts = token.split('.');
  if (parts.length !== 2) throw Error('Invalid summary');
  const expected = Buffer.from(signature(parts[0], secret));
  const actual = Buffer.from(parts[1]);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw Error('Invalid summary');
  const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
  if (!Number.isFinite(data.exp) || now >= data.exp) throw Error('Expired summary');
  return validateSummary({ supported: true, conflicts: [], facts: data.facts });
}
