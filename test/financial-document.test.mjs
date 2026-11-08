// My Aid: reading totals, balances and estimates from financial screenshots.
// node --test test/financial-document.test.mjs
// Synthetic documents only; the OpenAI call is faked. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCurrency, classifyFinancialAmount, findImportantTotals, factsFromScan, buildFinancialDocument } from '../server/financial-document.js';
import { redactPage } from '../server/redact.js';
import { containsHighRiskPII } from '../server/privacy.js';
import { createAnalyzeHandler, reconcileEstimates, needsSecondPass } from '../api/analyze.js';

const CALCULATOR = [
  'Academic Year 2027 Tuition Calculator',
  'Residency: Texas Resident',
  'Estimated Costs Per Semester',
  'Tuition and Consolidated Fees $5046.84',
  'Student Service Fee $260.00',
  'University Center Fee $135.00',
  'Recreation and Wellness Center $121.00',
  'TOTAL $5562.84',
].join('\n');

const scanOf = (text) => findImportantTotals(redactPage(text).text);
const documentOf = (text) => { const scan = scanOf(text); return buildFinancialDocument(factsFromScan(scan, 1, 1), [scan]); };

// ------------------------------------------------------------ helpers

test('F/G. normalizeCurrency handles commas, no commas, cents and negatives', () => {
  assert.equal(normalizeCurrency('$12,617.10'), 12617.1);
  assert.equal(normalizeCurrency('$5562.84'), 5562.84);
  assert.equal(normalizeCurrency('$5,562.84'), 5562.84);
  assert.equal(normalizeCurrency('$7,395'), 7395);
  assert.equal(normalizeCurrency('(1,250.00)'), -1250);
  assert.equal(normalizeCurrency('S3,698'), 3698); // OCR slip
  assert.equal(normalizeCurrency('TOTAL'), null);
  assert.equal(normalizeCurrency('$5,562.84 $260.00'), null);
});

test('classifyFinancialAmount uses the row label and the section heading together', () => {
  assert.equal(classifyFinancialAmount('TOTAL', 'Estimated Costs Per Semester').type, 'estimatedSemesterCost');
  assert.equal(classifyFinancialAmount('TOTAL', 'Estimated Costs Per Year').type, 'estimatedAnnualCost');
  assert.equal(classifyFinancialAmount('Balance Due', '').type, 'amountDue');
  assert.equal(classifyFinancialAmount('Current Balance', '').type, 'studentAccountBalance');
  assert.equal(classifyFinancialAmount('Remaining Cost', '').type, 'remainingCost');
  assert.equal(classifyFinancialAmount('Net Cost', '').type, 'remainingCost');
  assert.equal(classifyFinancialAmount('Cost of Attendance', '').type, 'costOfAttendance');
  assert.equal(classifyFinancialAmount('Total Grants', '').type, 'grantsTotal');
  assert.equal(classifyFinancialAmount('Federal Direct Loan', 'Your Aid').category, 'loan');
  assert.equal(classifyFinancialAmount('TOTAL', '').type, 'unclassifiedTotal');
});

// -------------------------------------------------------- A–H, as text

test('A. tuition calculator with TOTAL: estimatedSemesterCost 5562.84, four line items, not a balance', () => {
  const doc = documentOf(CALCULATOR);
  assert.equal(doc.documentType, 'tuition_calculator');
  assert.equal(doc.estimatedSemesterCost, 5562.84);
  assert.equal(doc.studentAccountBalance, null);
  assert.equal(doc.amountDue, null);
  assert.deepEqual(doc.lineItems.map((li) => [li.label, li.amount]), [
    ['Tuition and Consolidated Fees', 5046.84], ['Student Service Fee', 260], ['University Center Fee', 135], ['Recreation and Wellness Center', 121],
  ]);
  const total = doc.detectedTotals.find((t) => t.type === 'estimatedSemesterCost');
  assert.equal(total.amount, 5562.84);
  assert.equal(total.context, 'Estimated Costs Per Semester');
  assert.ok(total.confidence >= 0.95, 'rows add up to the total, so it is confirmed');
  assert.ok(doc.warnings.some((w) => /estimated tuition calculation, not necessarily the balance/.test(w.message)));
});

test('B. "Current Balance: $2,341.72" is the student account balance', () => {
  const doc = documentOf('Student Account Summary\nCurrent Balance: $2,341.72');
  assert.equal(doc.studentAccountBalance, 2341.72);
  assert.equal(doc.estimatedSemesterCost, null);
});

test('C. "Remaining Cost: $1,250" is the remaining cost', () => {
  const doc = documentOf('Your Net Cost Summary\nRemaining Cost: $1,250');
  assert.equal(doc.remainingCost, 1250);
  assert.equal(doc.studentAccountBalance, null);
});

test('D. aid award: grants, scholarships and loans are kept apart', () => {
  const facts = [
    { field: 'grantOffer', label: 'Pell Grant', value: '$7,395', kind: 'award-letter', estimated: false, period: '2026-27' },
    { field: 'scholarshipOffer', label: 'Scholarship', value: '$2,000', kind: 'award-letter', estimated: false, period: '2026-27' },
    { field: 'unsubsidizedLoanOffer', label: 'Federal Loan', value: '$3,500', kind: 'award-letter', estimated: false, period: '2026-27' },
  ];
  const doc = buildFinancialDocument(facts, [scanOf('2026-27 Financial Aid Award\nPell Grant $7,395\nScholarship $2,000\nFederal Loan $3,500')]);
  assert.equal(doc.documentType, 'aid_award');
  assert.equal(doc.grants, 7395);
  assert.equal(doc.scholarships, 2000);
  assert.equal(doc.loans, 3500);
});

test('E. several totals on one statement: every one found and classified', () => {
  const doc = documentOf('Fall 2026 Statement\nTotal Charges $8,200.00\nTotal Credits $6,400.00\nAmount Due $1,800.00\nCost of Attendance $24,600\nTotal Aid $12,617.10');
  const types = Object.fromEntries(doc.detectedTotals.map((t) => [t.type, t.amount]));
  assert.equal(types.totalCharges, 8200);
  assert.equal(types.paymentsApplied, 6400);
  assert.equal(types.amountDue, 1800);
  assert.equal(types.costOfAttendance, 24600);
  assert.equal(types.totalFinancialAid, 12617.1);
  assert.equal(doc.amountDue, 1800);
});

test('H. TOTAL separated from its heading (and from its own amount) still uses the section', () => {
  const split = [
    'Academic Year 2027 Tuition Calculator', 'Estimated Costs Per Semester',
    'Tuition and Consolidated Fees', 'Student Service Fee', 'University Center Fee', 'Recreation and Wellness Center',
    '$5046.84', '$260.00', '$135.00', '$121.00', 'Showing 15 credit hours', 'TOTAL', '$5562.84',
  ].join('\n');
  const doc = documentOf(split);
  assert.equal(doc.estimatedSemesterCost, 5562.84);
  assert.equal(doc.lineItems.length, 4);
  assert.equal(doc.studentAccountBalance, null);
});

test('a bare TOTAL with no context is reported as unconfirmed, never as a balance', () => {
  const doc = documentOf('TOTAL $5,562.84');
  assert.equal(doc.studentAccountBalance, null);
  assert.equal(doc.estimatedSemesterCost, null);
  assert.ok(doc.warnings.some((w) => w.message === 'I found a possible total of $5,562.84, but I couldn\'t confirm whether this is your actual balance or an estimated tuition amount.'));
});

// ------------------------------------------------------------ privacy

test('privacy filter keeps money values but still removes SSNs, IDs and names', () => {
  const page = redactPage(['Student Name: Jordan Testcase', 'Student ID: 900123456', 'SSN 123-45-6789', CALCULATOR, 'Pell Grant $7,395', 'Scholarship $500', 'Loan $2,000'].join('\n'));
  for (const amount of ['$5562.84', '$5046.84', '$7,395', '$2,000', '$500']) assert.ok(page.text.includes(amount), `${amount} kept`);
  for (const secret of ['Jordan', 'Testcase', '900123456', '123-45-6789']) assert.ok(!page.text.includes(secret), `${secret} removed`);
  assert.equal(containsHighRiskPII(page.text), false);
  assert.equal(containsHighRiskPII('$5,562.84 $12,617.10 $5562.84'), false);
  assert.equal(containsHighRiskPII('SSN 123-45-6789'), true);
});

test('a name line above a split table is never paired with an amount', () => {
  const page = redactPage('Jordan Testcase\nPell Grant\nDirect Loan\n$5,000.00\n$2,000.00\n$3,000.00');
  assert.ok(!page.text.includes('Jordan'));
});

// ----------------------------------------------- the reader, end to end

const env = { OPENAI_API_KEY: 'test-only', OPENAI_MODEL: 'test' }; // paywall off: nothing saved
function response() {
  return { statusCode: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, send(v) { this.body = v; return this; }, json(v) { this.body = v; return this; } };
}
let ip = 0;
const model = (...answers) => {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const data = answers[Math.min(calls.length - 1, answers.length - 1)];
    return { ok: true, json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] }] }) };
  };
  return { calls, fetchImpl };
};
const read = async (text, fake) => {
  const res = response();
  await createAnalyzeHandler({ env, fetchImpl: fake.fetchImpl })({ method: 'POST', headers: {}, socket: { remoteAddress: `10.9.9.${++ip}` }, body: { consent: true, documents: [{ name: 'IMG_1.png', pages: [text] }] } }, res);
  return res;
};
const fact = (field, label, value, quote, extra = {}) => ({ field, label, value, page: 1, document: 1, kind: 'cost-estimate', period: 'Per semester', estimated: true, quote, context: 'Estimated Costs Per Semester', confidence: 0.95, ...extra });

test('acceptance: the reader returns the calculator total and its four rows, not a balance', async () => {
  const fake = model({ supported: true, conflicts: [], facts: [
    fact('tuition', 'Tuition and Consolidated Fees', '$5046.84', 'Tuition and Consolidated Fees $5046.84'),
    fact('costItem', 'Student Service Fee', '$260.00', 'Student Service Fee $260.00'),
    fact('costItem', 'University Center Fee', '$135.00', 'University Center Fee $135.00'),
    fact('costItem', 'Recreation and Wellness Center', '$121.00', 'Recreation and Wellness Center $121.00'),
    fact('estimatedSemesterCost', 'Total estimated cost per semester', '$5562.84', 'TOTAL $5562.84'),
  ] });
  const res = await read(CALCULATOR, fake);
  assert.equal(res.statusCode, 200, String(res.body));
  const doc = res.body.overview.document;
  assert.equal(doc.documentType, 'tuition_calculator');
  assert.equal(doc.estimatedSemesterCost, 5562.84);
  assert.equal(doc.studentAccountBalance, null);
  assert.equal(doc.lineItems.length, 4);
  assert.equal(res.body.overview.glance.estimatedCost, 5562.84);
  assert.equal(res.body.overview.glance.estimatedPeriod, 'semester');
  assert.equal(res.body.document.kind, 'cost-estimate');
  assert.equal(fake.calls.length, 1, 'no second pass needed');
  const prompt = fake.calls[0].instructions;
  assert.match(prompt, /Inspect every visible table row and column/);
  assert.match(prompt, /If multiple totals are visible, extract ALL of them/);
  assert.doesNotMatch(prompt, /Ignore totals rows/);
});

test('acceptance: a model that calls the calculator total a balance is corrected', async () => {
  const fake = model({ supported: true, conflicts: [], facts: [fact('balanceDue', 'Total', '$5562.84', 'TOTAL $5562.84', { kind: 'account-statement', estimated: false })] });
  const res = await read(CALCULATOR, fake);
  assert.equal(res.statusCode, 200);
  const fields = res.body.summaryFacts.map((f) => f.field);
  assert.ok(!fields.includes('balanceDue') && !fields.includes('accountBalance'));
  assert.equal(res.body.overview.document.estimatedSemesterCost, 5562.84);
  assert.equal(res.body.overview.document.amountDue, null);
});

test('second pass: an empty first read is retried with the focused totals prompt', async () => {
  const fake = model(
    { supported: false, conflicts: [], facts: [] },
    { supported: true, conflicts: [], facts: [fact('estimatedSemesterCost', 'TOTAL', '$5562.84', 'TOTAL $5562.84')] },
  );
  const res = await read(CALCULATOR, fake);
  assert.equal(res.statusCode, 200);
  assert.equal(fake.calls.length, 2);
  assert.match(fake.calls[1].instructions, /^Reinspect this screenshot specifically for financial totals/);
  assert.equal(res.body.overview.document.estimatedSemesterCost, 5562.84);
});

test('the page itself is enough: both reads empty, the TOTAL row is still found and verified', async () => {
  const fake = model({ supported: false, conflicts: [], facts: [] });
  const res = await read(CALCULATOR, fake);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.overview.document.estimatedSemesterCost, 5562.84);
  assert.equal(res.body.overview.document.lineItems.length, 4);
  for (const f of res.body.summaryFacts) assert.ok(CALCULATOR.replace(/,/g, '').includes(f.quote.replace(/,/g, '')), 'every figure quotes the document');
});

test('award letters with no totals do not trigger a second pass', async () => {
  const text = '2026-27 Financial Aid Award\nPell Grant $7,395\nScholarship $2,000\nFederal Direct Loan $3,500';
  const fake = model({ supported: true, conflicts: [], facts: [
    { field: 'grantOffer', label: 'Federal Pell Grant', value: '$7,395', page: 1, document: 1, kind: 'award-letter', period: '2026-27', estimated: false, quote: 'Pell Grant $7,395', context: '', confidence: 0.95 },
    { field: 'scholarshipOffer', label: 'Scholarship', value: '$2,000', page: 1, document: 1, kind: 'award-letter', period: '2026-27', estimated: false, quote: 'Scholarship $2,000', context: '', confidence: 0.95 },
    { field: 'unsubsidizedLoanOffer', label: 'Federal Direct Loan', value: '$3,500', page: 1, document: 1, kind: 'award-letter', period: '2026-27', estimated: false, quote: 'Federal Direct Loan $3,500', context: '', confidence: 0.9 },
  ] });
  const res = await read(text, fake);
  assert.equal(res.statusCode, 200);
  assert.equal(fake.calls.length, 1);
  const doc = res.body.overview.document;
  assert.deepEqual([doc.grants, doc.scholarships, doc.loans], [7395, 2000, 3500]);
});

test('reconcileEstimates and needsSecondPass', () => {
  const scans = [{ scan: findImportantTotals(CALCULATOR) }];
  const [fixed] = reconcileEstimates([{ field: 'balanceDue', value: '$5562.84', kind: 'account-statement', estimated: false }], scans);
  assert.equal(fixed.field, 'estimatedSemesterCost');
  assert.equal(needsSecondPass([], scans), true);
  assert.equal(needsSecondPass([{ field: 'estimatedSemesterCost', value: '$5562.84' }], scans), false);
});

test('logs carry counts and types only', async () => {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    const fake = model({ supported: false, conflicts: [], facts: [] });
    const res = response();
    await createAnalyzeHandler({ env: { ...env, FYNQ_READER_DEBUG: 'true' }, fetchImpl: fake.fetchImpl })({ method: 'POST', headers: {}, socket: { remoteAddress: '10.9.8.1' }, body: { consent: true, documents: [{ name: 'IMG_secret.png', pages: [`Student Name: Jordan Testcase\n${CALCULATOR}`] }] } }, res);
  } finally { console.log = original; }
  const log = lines.join('\n');
  assert.match(log, /\[MyAid Reader\]/);
  assert.match(log, /documentType: tuition_calculator/);
  assert.match(log, /primaryTotalType: estimatedSemesterCost/);
  for (const secret of ['Jordan', 'IMG_secret', '5562', '5,562', 'Tuition and']) assert.ok(!log.includes(secret), `${secret} not logged`);
});
