// node --test test/aid-overview.test.mjs
// The free preview's numbers: never invented, null when not determinable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAidOverview, previewOf } from '../server/aid-overview.js';

const f = (field, label, value, period = 'Not stated', extra = {}) => ({ field, label, value, period, estimated: false, kind: 'award-letter', document: 1, page: 1, quote: `${label} ${value}`, id: 'x', ...extra });

test('award letter with cost of attendance: free money, loans, remaining cost (loans not subtracted), after loans', () => {
  const o = computeAidOverview([
    f('grantOffer', 'Federal Pell Grant', '$3,697.50', 'Fall 2026'), f('grantOffer', 'Federal Pell Grant', '$3,697.50', 'Spring 2027'),
    f('scholarshipOffer', 'Presidential Scholarship', '$2,000'),
    f('subsidizedLoanOffer', 'Direct Subsidized Loan', '$3,500'), f('unsubsidizedLoanOffer', 'Direct Unsubsidized Loan', '$2,000'),
    f('costOfAttendance', 'Cost of attendance', '$24,000'),
  ]);
  assert.deepEqual(o.glance, { freeMoney: 9395, borrowed: 5500, remainingCost: 14605, remainingBasis: 'cost_of_attendance', afterLoans: 9105, workStudy: null, estimatesOnly: false });
  assert.ok(o.review.some((r) => r.id === 'remaining') && o.review.some((r) => r.id === 'loans') && o.review.some((r) => r.id === 'gap'));
  assert.ok(o.questions.length >= 2 && o.questions.length <= 5);
});

test('no cost and no bill: remaining cost is "not enough information" (null), and it says why', () => {
  const o = computeAidOverview([f('grantOffer', 'Federal Pell Grant', '$7,395')]);
  assert.equal(o.glance.remainingCost, null);
  assert.equal(o.glance.borrowed, null);
  assert.ok(o.review.some((r) => r.id === 'missing-cost'));
});

test('account statement: remaining is the bill minus aid applied', () => {
  const o = computeAidOverview([f('schoolBill', 'Tuition and fees', '$8,000', 'Fall 2026', { kind: 'account-statement' }), f('paymentApplied', 'Pell Grant applied', '$3,698', 'Fall 2026', { kind: 'account-statement' })]);
  assert.equal(o.glance.remainingCost, 4302); assert.equal(o.glance.remainingBasis, 'bill');
});

test('FAFSA estimates only: flagged, never mixed with an offer', () => {
  const o = computeAidOverview([f('estimatedPellGrant', 'Federal Pell Grant', '$7,395', 'Not stated', { estimated: true, kind: 'fafsa-submission-summary' }), f('unsubsidizedLoanOffer', 'Federal Direct Loans', '$5,500', 'Not stated', { estimated: true, kind: 'fafsa-submission-summary' })]);
  assert.equal(o.glance.estimatesOnly, true); assert.equal(o.glance.freeMoney, 7395);
  assert.equal(o.review[0].id, 'estimates');
});

test('preview carries only totals and a count', () => {
  const facts = [f('grantOffer', 'Federal Pell Grant', '$7,395')];
  const p = previewOf(computeAidOverview(facts), facts);
  assert.deepEqual(Object.keys(p).sort(), ['figures', 'glance', 'reviewCount']);
  assert.doesNotMatch(JSON.stringify(p), /Pell|7,395|quote|label/);
});
