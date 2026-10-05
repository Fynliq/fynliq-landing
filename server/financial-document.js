// Structured reading of financial screenshots: tuition calculators, award
// summaries, account statements, cost-of-attendance screens.
//
// Works on the REDACTED text only (server/redact.js runs first, on the device
// and again on the server), so nothing here ever sees a name or an ID. Plain
// JS with no Node or DOM imports, so tests and the browser can use it too.
//
// The model does the reading (api/analyze.js). These functions do the parts
// that must not depend on a model: turning "$5,562.84" into 5562.84, telling
// an estimate from a balance by its row label and section heading, finding
// every TOTAL / Balance / Amount Due row, and checking the result before it
// reaches a student. Nothing is invented: every amount comes from a line of
// the document, and a total that cannot be classified is reported as such.

import { fixOcrNumbers } from './redact.js';

// ------------------------------------------------------------------ money

/**
 * "$5,562.84" -> 5562.84, "$5562.84" -> 5562.84, "(1,250.00)" -> -1250,
 * "S3,698" (OCR) -> 3698. Returns null for anything that is not one amount.
 */
export function normalizeCurrency(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  if (typeof value !== 'string') return null;
  const text = fixOcrNumbers(value).trim().replace(/\s*(?:USD|CR|DR)$/i, '');
  const match = /^(\()?\s*(-)?\s*\$?\s*(-)?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*(\))?$/.exec(text);
  if (!match) return null;
  const [, open, minusA, minusB, whole, cents = '', close] = match;
  if (Boolean(open) !== Boolean(close)) return null;
  const n = Number(`${whole.replace(/,/g, '')}.${cents.padEnd(2, '0')}`);
  if (!Number.isFinite(n)) return null;
  const negative = Boolean(open) || Boolean(minusA) || Boolean(minusB);
  return Math.round((negative ? -n : n) * 100) / 100;
}

/**
 * Amounts printed on a line. Needs a $ sign, thousands commas or cents, so a
 * year ("2027"), credit hours ("15") or a row number is never read as money.
 */
const MONEY_TOKEN = /\(?-?\$\s?\d[\d,]*(?:\.\d{1,2})?\)?|\(?\b\d{1,3}(?:,\d{3})+(?:\.\d{2})?\b\)?|\b\d+\.\d{2}\b/g;

export function moneyIn(line) {
  const fixed = fixOcrNumbers(line);
  const found = [];
  for (const match of fixed.matchAll(MONEY_TOKEN)) {
    const amount = normalizeCurrency(match[0]);
    if (amount !== null) found.push({ token: match[0], amount, index: match.index });
  }
  return found;
}

// ---------------------------------------------------------- classification

const ESTIMATE = /\b(?:estimat\w*|calculator|projected|projection|sample|net\s+price|cost\s+estimate|tuition\s+estimate)\b/i;
const SEMESTER = /\b(?:semester|term|quarter|trimester|fall|spring|summer|winter)\b/i;
const YEAR = /\b(?:annual(?:ly)?|per\s+year|yearly|academic\s+year|full\s+year|year)\b/i;
const STATEMENT = /\b(?:statement|account\s+(?:summary|activity|balance)|billing|bill|invoice|charges|amount\s+due|balance)\b/i;
const AID = /\b(?:financial\s+aid|aid\s+offer|award|awards|offered|accepted|grants?|scholarships?|loans?)\b/i;

/** Every label that names a total, in the words schools actually use. */
export const TOTAL_LABEL = /\b(?:grand\s+total|total|totals|subtotal|semester\s+total|annual\s+total|estimated\s+total|estimated\s+costs?(?:\s+per\s+\w+)?|net\s+cost|net\s+price|remaining\s+(?:cost|balance|amount)|balance|amount\s+due|total\s+charges|total\s+aid|award\s+total)\b/i;

/** The important kinds of total, most specific first. */
const TOTAL_TYPES = new Set([
  'amountDue', 'studentAccountBalance', 'creditBalance', 'remainingCost', 'costOfAttendance',
  'estimatedSemesterCost', 'estimatedAnnualCost', 'totalCharges', 'totalFinancialAid',
  'grantsTotal', 'scholarshipsTotal', 'loansTotal', 'paymentsApplied', 'subtotal', 'unclassifiedTotal',
]);

function category(label) {
  if (/\bpell\b|\bgrants?\b|gift\s+aid|waiver/i.test(label)) return 'grant';
  if (/scholarships?|fellowship/i.test(label)) return 'scholarship';
  if (/work[-\s]?study|\bfws\b/i.test(label)) return 'workStudy';
  if (/\bloans?\b|\bplus\b|\bsub(?:sidized)?\b|\bunsub/i.test(label)) return 'loan';
  if (/tuition/i.test(label)) return 'tuition';
  if (/room|board|housing|meal|dining|residence\s+hall/i.test(label)) return 'housing';
  if (/books?|supplies|course\s+materials/i.test(label)) return 'books';
  if (/transport|travel|commut/i.test(label)) return 'transportation';
  if (/fees?\b|center|recreation|wellness|technology|lab\b|parking|activity|health|insurance|orientation|registration|service|athletic|library|union|matriculation|program/i.test(label)) return 'fee';
  if (/personal|miscellaneous|misc\b|other\s+expenses/i.test(label)) return 'personal';
  if (/payment|credit|disburse|applied|paid/i.test(label)) return 'payment';
  return 'other';
}

/**
 * What one amount is, from its row label and the section heading above it.
 * @param {string} label   the row text without the amount, e.g. "TOTAL"
 * @param {string} context the section heading and page title, e.g. "Estimated Costs Per Semester"
 * @returns {{ type: string, category: string, isTotal: boolean, confidence: number }}
 */
export function classifyFinancialAmount(label, context = '') {
  const l = String(label).replace(/\s+/g, ' ').trim();
  const both = `${l} ${context}`;
  const total = (type, confidence) => ({ type, category: 'total', isTotal: true, confidence });

  if (/credit\s+balance|refund\s+(?:due|amount)|overpayment/i.test(l)) return total('creditBalance', 0.95);
  if (/amount\s+due|balance\s+due|total\s+due|due\s+now|payment\s+due|minimum\s+(?:amount\s+)?due|pay\s+this\s+amount/i.test(l)) return total('amountDue', 0.95);
  if (/remaining\s+(?:cost|balance|amount)|net\s+cost|net\s+price|cost\s+after\s+aid|out[-\s]of[-\s]pocket|left\s+to\s+pay|you\s+(?:may\s+)?owe|unmet\s+(?:cost|need)/i.test(l)) return total('remainingCost', /unmet/i.test(l) ? 0.7 : 0.92);
  if (/(?:current|account|statement|outstanding|ending|new|total)\s+balance|^balance\b/i.test(l)) {
    // "Estimated balance" on a calculator is not an account balance.
    return ESTIMATE.test(l) ? total('remainingCost', 0.6) : total('studentAccountBalance', 0.95);
  }
  if (/cost\s+of\s+attendance|\bcoa\b|student\s+budget|total\s+budget/i.test(l)) return total('costOfAttendance', 0.95);
  if (/total\s+(?:grants?|gift\s+aid)|grants?\s+total/i.test(l)) return total('grantsTotal', 0.9);
  if (/total\s+scholarships?|scholarships?\s+total/i.test(l)) return total('scholarshipsTotal', 0.9);
  if (/total\s+loans?|loans?\s+total/i.test(l)) return total('loansTotal', 0.9);
  if (/total\s+(?:financial\s+)?aid|aid\s+total|award\s+total|total\s+awards?|total\s+offered|total\s+package|total\s+financial\s+assistance/i.test(l)) return total('totalFinancialAid', 0.9);
  if (/total\s+(?:payments?|credits?)|payments?\s+(?:applied|received)|aid\s+applied|anticipated\s+aid/i.test(l)) return total('paymentsApplied', 0.85);
  if (/\bsub-?total\b/i.test(l)) return total('subtotal', 0.7);

  const looksTotal = /\b(?:grand\s+total|total|totals|estimated\s+total|total\s+(?:cost|costs|charges|fees|tuition(?:\s+and\s+fees)?|estimated\s+cost)|semester\s+total|annual\s+total|estimated\s+costs?)\b/i.test(l);
  if (looksTotal) {
    if (ESTIMATE.test(both)) {
      // The period comes from the row first, then the section heading.
      const semester = SEMESTER.test(l) || (!YEAR.test(l) && SEMESTER.test(context));
      const strong = ESTIMATE.test(l) || ESTIMATE.test(context);
      return total(semester ? 'estimatedSemesterCost' : 'estimatedAnnualCost', strong ? 0.95 : 0.85);
    }
    if (/charges|fees|tuition/i.test(both) && STATEMENT.test(both)) return total('totalCharges', 0.85);
    if (/total\s+charges/i.test(l)) return total('totalCharges', 0.85);
    if (AID.test(context)) return total('totalFinancialAid', 0.75);
    if (/\b(?:costs?|expenses|tuition|fees)\b/i.test(context)) {
      const semester = SEMESTER.test(context);
      return total(semester ? 'estimatedSemesterCost' : 'estimatedAnnualCost', 0.75);
    }
    return total('unclassifiedTotal', 0.5);
  }
  return { type: 'lineItem', category: category(l), isTotal: false, confidence: 0.85 };
}

// -------------------------------------------------------- reading a page

const HEADING_WORDS = /\b(?:costs?|charges|fees|expenses|estimat\w*|tuition|budget|aid|awards?|offer|summary|balance|payments|account|attendance|per\s+(?:semester|term|year)|calculator|statement)\b/i;
/** Notes and instructions, not headings: "Showing 15 credit hours", "Based on…". */
const NOT_HEADING = /^(?:showing|based\s+on|this|these|the\s+following|enter|select|note|please|click|tap|you|your\s+estimate\s+is|rates?\s+are|amounts?\s+(?:are|shown))\b/i;

function isHeading(line) {
  if (moneyIn(line).length) return false;
  if (!/[A-Za-z]{3}/.test(line) || line.length > 80 || line.split(/\s+/).length > 9) return false;
  if (/^(?:grand\s+)?totals?:?$/i.test(line) || NOT_HEADING.test(line)) return false;
  return /:\s*$/.test(line) || HEADING_WORDS.test(line);
}

const stripMoney = (line) => fixOcrNumbers(line).replace(MONEY_TOKEN, ' ').replace(/[:.\-–—|]+\s*$/, '').replace(/\s+/g, ' ').trim();
const onlyMoney = (line) => moneyIn(line).length > 0 && !/[A-Za-z]{2}/.test(stripMoney(line));

/**
 * Every monetary row on one page of redacted text, classified, with the
 * important totals pulled out. A TOTAL under a group of expenses outranks the
 * rows above it, and is confirmed when the rows add up to it.
 * @returns {{ totals: object[], lineItems: object[], moneyValues: number, title: string }}
 */
export function findImportantTotals(text) {
  const lines = String(text ?? '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  let title = '';
  let section = '';
  let parent = '';
  let pendingLabel = null;
  let moneyValues = 0;
  const rows = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const amounts = moneyIn(line);
    moneyValues += amounts.length;

    if (!amounts.length) {
      if (!title && /calculator|statement|award|offer|summary|estimate|bill|invoice|cost\s+of\s+attendance|net\s+price/i.test(line)) title = line;
      // A label whose amount is on the next line ("TOTAL" / "$5,562.84").
      if (i + 1 < lines.length && onlyMoney(lines[i + 1]) && !isHeading(line)) { pendingLabel = line; continue; }
      if (isHeading(line)) { parent = section; section = line.replace(/:\s*$/, ''); }
      pendingLabel = null;
      continue;
    }

    const label = stripMoney(line) || pendingLabel || '';
    pendingLabel = null;
    if (!label) continue;
    // With several amounts on a row, the one after a total word, else the last.
    const totalWord = /\btotal\b/i.exec(line);
    const pick = totalWord ? amounts.find((a) => a.index > totalWord.index) ?? amounts[amounts.length - 1] : amounts[amounts.length - 1];
    rows.push({ label, amount: pick.amount, section, parent, quote: line, index: rows.length });
  }

  const context = (row) => [row.section, row.parent, title].filter(Boolean).join(' | ');
  const totals = [];
  const lineItems = [];
  for (const row of rows) {
    const c = classifyFinancialAmount(row.label, context(row));
    if (c.isTotal) totals.push({ label: row.label, amount: row.amount, context: row.section || title || '', type: c.type, confidence: c.confidence, quote: row.quote, section: row.section });
    else lineItems.push({ label: row.label, amount: row.amount, category: c.category, section: row.section, quote: row.quote });
  }

  // A total is confirmed when the rows of its own section add up to it.
  for (const t of totals) {
    const items = lineItems.filter((li) => li.section === t.section && li.amount > 0);
    if (items.length >= 2) {
      const sum = Math.round(items.reduce((s, li) => s + li.amount, 0) * 100) / 100;
      if (Math.abs(sum - t.amount) <= 1) { t.confidence = Math.max(t.confidence, 0.98); t.verifiedBySum = true; }
    }
  }

  return { totals, lineItems, moneyValues, title };
}

/** The kind of document a page most looks like, from what was found on it. */
export function documentTypeOf(scan, facts = []) {
  const types = new Set(scan.totals.map((t) => t.type));
  const fields = new Set(facts.map((f) => f.field));
  if (types.has('estimatedSemesterCost') || types.has('estimatedAnnualCost') || fields.has('estimatedSemesterCost') || fields.has('estimatedAnnualCost') || /calculator|estimat/i.test(scan.title)) return 'tuition_calculator';
  if (types.has('amountDue') || types.has('studentAccountBalance') || types.has('totalCharges') || fields.has('balanceDue') || fields.has('accountBalance') || fields.has('schoolBill')) return 'account_statement';
  if (fields.has('sai') || fields.has('estimatedPellGrant')) return 'fafsa_summary';
  if (types.has('costOfAttendance') && !scan.lineItems.some((li) => ['grant', 'scholarship', 'loan', 'workStudy'].includes(li.category)) && !facts.some((f) => /Offer$/.test(f.field))) return 'cost_of_attendance';
  if (facts.some((f) => /Offer$/.test(f.field)) || types.has('totalFinancialAid') || scan.lineItems.some((li) => ['grant', 'scholarship', 'loan'].includes(li.category))) return 'aid_award';
  return 'unknown';
}

// ------------------------------------------------- facts from the totals
//
// When the reader misses or mislabels a total that the page states plainly,
// these turn the deterministic scan into facts with an exact quote, so they
// go through the same verification as everything the model returns.

const TOTAL_FIELD = {
  estimatedSemesterCost: 'estimatedSemesterCost',
  estimatedAnnualCost: 'estimatedAnnualCost',
  amountDue: 'balanceDue',
  studentAccountBalance: 'accountBalance',
  remainingCost: 'remainingCost',
  costOfAttendance: 'costOfAttendance',
  totalFinancialAid: 'totalAid',
};

function periodFor(row, title) {
  const text = `${row.label} ${row.section ?? ''}`;
  const term = /\b(?:fall|spring|summer|winter)\s+20\d\d\b/i.exec(text) ?? /\b(?:fall|spring|summer|winter)\s+20\d\d\b/i.exec(title);
  if (term) return term[0];
  if (/per\s+semester|semester/i.test(text)) return 'Per semester';
  if (/per\s+term|\bterm\b/i.test(text)) return 'Per term';
  const year = /\b20\d\d\s*[-–\/]\s*(?:20)?\d\d\b|\b(?:academic|award)\s+year\s+20\d\d\b/i.exec(`${text} ${title}`);
  if (year) return year[0];
  if (YEAR.test(text)) return 'Per year';
  return 'Not stated';
}

/**
 * Facts for the important totals and, on a cost estimate, its line items.
 * Only confident, clearly labelled rows are used.
 */
export function factsFromScan(scan, document, page) {
  const facts = [];
  const estimateSections = new Set();
  for (const t of scan.totals) {
    const field = TOTAL_FIELD[t.type];
    if (!field || t.confidence < 0.9 || t.amount < 0) continue;
    const kind = field.startsWith('estimated') ? 'cost-estimate' : ['balanceDue', 'accountBalance'].includes(field) ? 'account-statement' : 'award-letter';
    if (kind === 'cost-estimate') estimateSections.add(t.section);
    facts.push({ field, label: t.label.slice(0, 100), value: t.quote.match(MONEY_TOKEN)?.find((tok) => normalizeCurrency(tok) === t.amount) ?? String(t.amount), page, document, kind, period: periodFor(t, scan.title), estimated: kind === 'cost-estimate', quote: t.quote.slice(0, 400), context: (t.context || '').slice(0, 120), confidence: t.confidence });
  }
  for (const li of scan.lineItems) {
    if (!estimateSections.has(li.section) || li.amount <= 0) continue;
    const field = li.category === 'tuition' ? 'tuition' : ['fee', 'housing', 'books', 'transportation', 'personal', 'other'].includes(li.category) ? 'costItem' : null;
    if (!field) continue;
    facts.push({ field, label: li.label.slice(0, 100), value: li.quote.match(MONEY_TOKEN)?.find((tok) => normalizeCurrency(tok) === li.amount) ?? String(li.amount), page, document, kind: 'cost-estimate', period: periodFor(li, scan.title), estimated: true, quote: li.quote.slice(0, 400), context: (li.section || '').slice(0, 120), confidence: 0.9 });
  }
  return facts.filter((f) => typeof f.value === 'string' && f.value.trim());
}

// --------------------------------------------- the structured document

const amountOf = (f) => normalizeCurrency(f.value);
const firstAmount = (facts, field) => {
  const xs = facts.filter((f) => f.field === field).map(amountOf).filter((n) => n !== null);
  return xs.length ? xs[0] : null;
};
const sumOf = (facts, fields) => {
  const seen = new Map();
  for (const f of facts) {
    if (!fields.includes(f.field)) continue;
    const key = `${f.field}|${String(f.label).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
    const n = amountOf(f);
    if (n === null) continue;
    // Same award printed per term and per year: keep the larger (the year).
    seen.set(key, Math.max(seen.get(key) ?? 0, n));
  }
  return seen.size ? Math.round([...seen.values()].reduce((s, n) => s + n, 0) * 100) / 100 : null;
};
const usd = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;

/**
 * The structured extraction: one object a page can read without knowing how
 * the document was laid out. Built from verified facts plus the scan of the
 * redacted text.
 */
export function buildFinancialDocument(facts, scans = []) {
  const merged = { totals: scans.flatMap((s) => s.totals), lineItems: scans.flatMap((s) => s.lineItems), moneyValues: scans.reduce((n, s) => n + s.moneyValues, 0), title: scans.map((s) => s.title).find(Boolean) ?? '' };
  const awardFacts = facts.filter((f) => /Offer$|^estimatedPellGrant$/.test(f.field));
  const offers = awardFacts.filter((f) => !f.estimated);
  const aid = offers.length ? offers : awardFacts;

  const doc = {
    documentType: documentTypeOf(merged, facts),
    schoolName: null, // never extracted: school and student details stay out of the read
    academicYear: (facts.find((f) => f.field === 'awardYear')?.value ?? /\b20\d\d\s*[-–\/]\s*(?:20)?\d\d\b/.exec(facts.map((f) => f.period).join(' '))?.[0]) ?? null,
    studentAccountBalance: firstAmount(facts, 'accountBalance'),
    amountDue: firstAmount(facts, 'balanceDue'),
    remainingCost: firstAmount(facts, 'remainingCost'),
    estimatedSemesterCost: firstAmount(facts, 'estimatedSemesterCost'),
    estimatedAnnualCost: firstAmount(facts, 'estimatedAnnualCost'),
    tuition: firstAmount(facts, 'tuition'),
    costOfAttendance: firstAmount(facts, 'costOfAttendance'),
    totalFinancialAid: firstAmount(facts, 'totalAid'),
    grants: sumOf(aid, ['grantOffer', 'estimatedPellGrant']),
    scholarships: sumOf(aid, ['scholarshipOffer']),
    loans: sumOf(aid, ['subsidizedLoanOffer', 'unsubsidizedLoanOffer']),
    workStudy: sumOf(aid, ['workStudyOffer']),
    sai: (() => { const n = firstAmount(facts, 'sai'); return n === null ? null : Math.trunc(n); })(),
    lineItems: facts.filter((f) => ['tuition', 'costItem', 'grantOffer', 'scholarshipOffer', 'subsidizedLoanOffer', 'unsubsidizedLoanOffer', 'workStudyOffer', 'estimatedPellGrant'].includes(f.field))
      .map((f) => ({ label: f.label, amount: amountOf(f), category: f.field === 'costItem' ? category(f.label) : f.field === 'tuition' ? 'tuition' : category(f.label) }))
      .filter((li) => li.amount !== null),
    detectedTotals: [],
    confidence: 0,
    warnings: [],
  };

  // Totals: what the verified facts say, then anything else the page states.
  const seen = new Set();
  const push = (t) => {
    const key = `${t.type}|${t.amount}`;
    if (seen.has(key)) return;
    seen.add(key);
    doc.detectedTotals.push({ label: t.label, amount: t.amount, context: t.context ?? '', type: t.type, confidence: t.confidence });
  };
  const FIELD_TYPE = { estimatedSemesterCost: 'estimatedSemesterCost', estimatedAnnualCost: 'estimatedAnnualCost', balanceDue: 'amountDue', accountBalance: 'studentAccountBalance', remainingCost: 'remainingCost', costOfAttendance: 'costOfAttendance', totalAid: 'totalFinancialAid', schoolBill: 'totalCharges', creditBalance: 'creditBalance' };
  for (const f of facts) if (FIELD_TYPE[f.field]) push({ label: f.label, amount: amountOf(f), context: f.context ?? '', type: FIELD_TYPE[f.field], confidence: typeof f.confidence === 'number' ? f.confidence : 0.85 });
  for (const t of merged.totals) if (TOTAL_TYPES.has(t.type) && t.type !== 'subtotal') push(t);
  doc.detectedTotals.sort((a, b) => b.confidence - a.confidence);

  return validateFinancialExtraction(doc);
}

/**
 * Checks a structured extraction before a student sees it: numbers are
 * numbers, an estimate is never presented as a balance, an unclassified total
 * is flagged instead of guessed, and a total that does not match its rows is
 * called out.
 */
export function validateFinancialExtraction(doc) {
  const warnings = [];
  const money = ['studentAccountBalance', 'amountDue', 'remainingCost', 'estimatedSemesterCost', 'estimatedAnnualCost', 'tuition', 'costOfAttendance', 'totalFinancialAid', 'grants', 'scholarships', 'loans', 'workStudy'];
  for (const key of money) {
    const v = doc[key];
    if (v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 10000000)) doc[key] = null;
  }
  doc.lineItems = doc.lineItems.filter((li) => typeof li.amount === 'number' && Number.isFinite(li.amount));
  doc.detectedTotals = doc.detectedTotals.filter((t) => typeof t.amount === 'number' && Number.isFinite(t.amount));

  // An estimate must never double as an account balance.
  for (const key of ['studentAccountBalance', 'amountDue']) {
    if (doc[key] !== null && (doc[key] === doc.estimatedSemesterCost || doc[key] === doc.estimatedAnnualCost) && !doc.detectedTotals.some((t) => t.amount === doc[key] && ['studentAccountBalance', 'amountDue'].includes(t.type) && !ESTIMATE.test(`${t.label} ${t.context}`))) {
      doc[key] = null;
    }
  }

  if (doc.documentType === 'tuition_calculator' && (doc.estimatedSemesterCost !== null || doc.estimatedAnnualCost !== null)) {
    warnings.push({ code: 'estimate-not-balance', message: 'This appears to be an estimated tuition calculation, not necessarily the balance currently due on your student account.' });
  }
  for (const t of doc.detectedTotals) {
    if (t.type === 'unclassifiedTotal' || t.confidence < 0.7) {
      warnings.push({ code: 'unconfirmed-total', message: `I found a possible total of ${usd(t.amount)}, but I couldn't confirm whether this is your actual balance or an estimated tuition amount.` });
    }
  }
  const estimate = doc.estimatedSemesterCost ?? doc.estimatedAnnualCost;
  const costRows = doc.lineItems.filter((li) => !['grant', 'scholarship', 'loan', 'workStudy'].includes(li.category));
  if (estimate !== null && costRows.length >= 2) {
    const sum = Math.round(costRows.reduce((s, li) => s + li.amount, 0) * 100) / 100;
    if (Math.abs(sum - estimate) > 1) warnings.push({ code: 'rows-do-not-add-up', message: `The rows Fynliq read add up to ${usd(sum)}, not the ${usd(estimate)} total. Check the breakdown against your screenshot.` });
  }

  const important = doc.detectedTotals.filter((t) => t.type !== 'unclassifiedTotal');
  doc.confidence = important.length ? Math.round(Math.max(...important.map((t) => t.confidence)) * 100) / 100 : (doc.lineItems.length ? 0.8 : 0);
  doc.warnings = warnings.filter((w, i, all) => all.findIndex((x) => x.message === w.message) === i).slice(0, 5);
  return doc;
}

/** The most important total on the document, for logs and headlines. */
export function primaryTotal(doc) {
  const order = ['amountDue', 'studentAccountBalance', 'remainingCost', 'estimatedSemesterCost', 'estimatedAnnualCost', 'costOfAttendance', 'totalCharges', 'totalFinancialAid'];
  for (const type of order) {
    const t = doc.detectedTotals.find((x) => x.type === type);
    if (t) return t;
  }
  return null;
}
