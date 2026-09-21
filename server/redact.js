// Shared by the browser (before anything leaves the device) and the server
// (defence in depth). Plain JS with no Node or DOM imports so both can use it.
//
// Two jobs, in this order:
//  1. Drop every line that is about the person rather than the aid: names,
//     addresses, birth dates, IDs, contact details, income and tax figures.
//  2. From what is left, keep only lines about Pell, scholarships and grants,
//     Direct Loans, the SAI, and the school bill / balance.
// Then any identifier-shaped token that survived is blacked out anyway.
//
// This is a conservative filter, not a guarantee. The server re-runs it and
// then applies containsHighRiskPII, which fails closed.

export const REDACTED = '[removed]';

/** Lines mentioning any of these are about the person. They are dropped whole. */
const PERSONAL_LINE = [
  /\b(?:student|applicant|parent|spouse|contributor|legal|full|first|last|middle|preferred|family)?\s*name\b/i,
  /\b(?:dob|date\s+of\s+birth|birth\s*date|born)\b/i,
  /\b(?:ssn|social\s+security|itin|ein|tax\s*(?:payer)?\s*(?:id|identification))\b/i,
  /\b(?:student|school|campus|university|college|person|member|confirmation|reference|customer|case|application|fsa)\s*(?:id|number|no\.?|#)\b/i,
  /\b(?:a-?number|alien\s+registration|passport|driver'?s?\s+licen[cs]e|state\s+id)\b/i,
  /\b(?:account|acct|routing|iban|swift|card)\s*(?:number|no\.?|#|ending)\b/i,
  /\b(?:bank|checking|savings)\s+(?:account|acct)\b/i,
  /\b(?:address|street|avenue|apt\.?|apartment|suite|p\.?\s?o\.?\s+box|zip\s*code|postal\s*code|mailing|residence|residency|county)\b/i,
  /\b(?:e-?mail|phone|mobile|cell|telephone|tel\.?|fax)\b/i,
  /\b(?:username|user\s*name|password|passcode|pin|fsa\s*id|login|security\s+question)\b/i,
  /\b(?:adjusted\s+gross|agi|income|wages|earnings|assets|net\s+worth|tax(?:es)?\s+paid|tax\s+return|1040|w-?2|child\s+support|household\s+size|number\s+in\s+college|marital|citizenship|gender|sex|race|ethnicity)\b/i,
];

/** Lines must mention one of these to be kept at all. */
const AID_LINE = [
  /\bpell\b/i,
  /\bscholarships?\b/i,
  /\bgrants?\b/i,
  /\bdirect\b/i,
  /\b(?:sub(?:sidized)?|unsub(?:sidized)?)\b/i,
  /\bloans?\b/i,
  /\bstudent\s+aid\s+index\b/i,
  /\bsai\b/i,
  /\b(?:award|aid|academic)\s+year\b/i,
  /\b(?:fall|spring|summer|winter)\s+(?:term\s+)?20\d\d\b/i,
  /\b20\d\d\s*[-–\/]\s*(?:20)?\d\d\b/,
  /\b(?:balance|amount\s+due|total\s+due|due\s+now|credit\s+balance|charges?|tuition|fees|payments?\s+(?:applied|received)|statement\s+total|total\s+(?:charges|credits|aid|awards?|offered))\b/i,
  /\b(?:financial\s+aid|aid\s+offer|award\s+letter|award\s+summary|offered|accepted)\b/i,
];

/** A line that is only an amount, as happens when a table splits label and value. */
const AMOUNT_ONLY = /^\s*[-(]?\$?\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\)?\s*$|^\s*[-(]?\$?\s?\d+(?:\.\d{2})?\)?\s*$/;

/** Token-level patterns blacked out even on kept lines. Order matters. */
const TOKEN_PATTERNS = [
  // A person's name introduced inside an aid line: "Aid Offer for Jordan Smith", "Dear Jordan".
  ['name', /\b(?:[Ff]or|[Tt]o|[Dd]ear|[Rr]ecipient|[Pp]repared\s+for|[Aa]warded\s+to)\s*:?\s+[A-Z][a-z'’]+(?:-[A-Z][a-z'’]+)?(?:\s+[A-Z]\.?)?(?:\s+[A-Z][a-z'’]+(?:-[A-Z][a-z'’]+)?){0,2}\b(?=\s*(?:[,:;.!]|$|\s+-|\s+\())/g],
  ['email', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
  ['ssn', /\b\d{3}[-\s.]\d{2}[-\s.]\d{4}\b/g],
  ['phone', /(?:\+?1[-\s.]?)?\(?\b\d{3}\)?[-\s.]\d{3}[-\s.]\d{4}\b/g],
  ['taxId', /\b\d{2}-\d{7}\b/g],
  ['date', /\b(?:0?[1-9]|1[0-2])[\/.-](?:0?[1-9]|[12]\d|3[01])[\/.-](?:19|20)?\d{2}\b/g],
  ['date', /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2},?\s+(?:19|20)\d{2}\b/gi],
  // Mixed letter+digit tokens with several digits: student IDs, A-numbers, account refs.
  ['identifier', /\b(?=[A-Z0-9-]*\d{4,})(?=[A-Z0-9-]*[A-Z])[A-Z0-9-]{6,}\b/gi],
  // Long bare digit runs: account, routing, card, unformatted SSN or ID numbers.
  ['identifier', /\b\d{7,}\b/g],
  // Masked numbers such as ***-**-1234 or XXXX1234.
  ['identifier', /(?:[*xX•]{2,}[-\s]?){1,4}\d{2,}/g],
];

const clean = (text) =>
  String(text ?? '')
    .normalize('NFKC')
    .replace(/[​-‍﻿]/g, '')
    .replace(/\r\n?/g, '\n');

/**
 * Redact one page of document text.
 * @param {string} text
 * @returns {{ text: string, removed: Record<string, number>, keptLines: number }}
 */
export function redactPage(text) {
  const removed = {};
  const count = (key, n = 1) => { removed[key] = (removed[key] ?? 0) + n; };
  const lines = clean(text).split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);

  const kept = [];
  let previousWasAid = false;
  for (const line of lines) {
    if (line.length > 300) { count('overlong'); previousWasAid = false; continue; }
    if (PERSONAL_LINE.some((re) => re.test(line))) { count('personal'); previousWasAid = false; continue; }

    const isAid = AID_LINE.some((re) => re.test(line));
    const isTrailingAmount = previousWasAid && AMOUNT_ONLY.test(line);
    if (!isAid && !isTrailingAmount) { count('unrelated'); previousWasAid = false; continue; }

    let safe = line;
    for (const [key, pattern] of TOKEN_PATTERNS) {
      safe = safe.replace(pattern, () => { count(key); return REDACTED; });
    }
    kept.push(safe);
    previousWasAid = isAid;
  }

  return { text: kept.join('\n'), removed, keptLines: kept.length };
}

/**
 * Redact every page of every document.
 * @param {{ name?: string, pages: string[] }[]} documents
 */
export function redactDocuments(documents) {
  return documents.map((doc) => {
    const pages = doc.pages.map((page) => redactPage(page));
    return {
      pages: pages.map((p) => p.text),
      keptLines: pages.reduce((sum, p) => sum + p.keptLines, 0),
      removed: pages.reduce((acc, p) => {
        for (const [k, v] of Object.entries(p.removed)) acc[k] = (acc[k] ?? 0) + v;
        return acc;
      }, {}),
    };
  });
}
