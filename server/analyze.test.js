import { afterEach, describe, expect, it, vi } from 'vitest';
import analyze, { READER_FIELDS } from '../api/analyze';
import { parseAnalysis } from '../src/beta/contract';

const secret = 'test-only-not-a-real-api-key';
function response() {
  return { statusCode: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, send(value) { this.body = value; return this; }, json(value) { this.body = value; return this; } };
}
const facts = [
  { field: 'sai', label: 'Student Aid Index', value: '-1500', page: 1, document: 1, kind: 'fafsa-submission-summary', period: '2026-27', estimated: false, quote: 'Student Aid Index (SAI): -1500' },
  { field: 'grantOffer', label: 'Federal Pell Grant', value: '$3,698', page: 1, document: 2, kind: 'award-letter', period: 'Fall 2026', estimated: false, quote: 'Federal Pell Grant Fall 2026 $3,698' },
  { field: 'subsidizedLoanOffer', label: 'Direct Subsidized Loan', value: '$1,750', page: 1, document: 2, kind: 'award-letter', period: 'Fall 2026', estimated: false, quote: 'Direct Subsidized Loan $1,750' },
  { field: 'balanceDue', label: 'Balance due', value: '$1,800.00', page: 1, document: 3, kind: 'account-statement', period: 'Fall 2026', estimated: false, quote: 'Balance Due Fall 2026 $1,800.00' },
];
const provider = (data, seen) => vi.fn(async (_url, init) => {
  seen?.push(JSON.parse(init.body));
  return { ok: true, json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] }] }) };
});
const documents = [
  { name: 'fafsa.pdf', pages: ['Student Name: Jordan Testcase\nSSN 123-45-6789\nStudent Aid Index (SAI): -1500'] },
  { name: 'award.png', pages: ['Aid Offer for Jordan Testcase\nFederal Pell Grant Fall 2026 $3,698\nDirect Subsidized Loan $1,750'] },
  { name: 'statement.pdf', pages: ['Account Number 000123456789\nBalance Due Fall 2026 $1,800.00'] },
];
let n = 0;
const request = (body) => ({ method: 'POST', headers: {}, socket: { remoteAddress: `10.0.0.${++n}` }, body });

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('document reader', () => {
  it('reads redacted text and returns the same shape the results page renders', async () => {
    vi.stubEnv('OPENAI_API_KEY', secret); vi.stubEnv('OPENAI_MODEL', 'test');
    const seen = [];
    vi.stubGlobal('fetch', provider({ supported: true, conflicts: [], facts }, seen));
    const res = response();
    await analyze(request({ consent: true, documents }), res);
    expect(res.statusCode).toBe(200);
    const analysis = parseAnalysis(res.body);
    expect(analysis.sai).toBe(-1500);
    expect(analysis.summaryFacts?.map((f) => f.field)).toEqual(['sai', 'grantOffer', 'subsidizedLoanOffer', 'balanceDue']);
    expect(analysis.document.fileNames).toEqual(['fafsa.pdf', 'award.png', 'statement.pdf']);
    expect(typeof analysis.summaryToken).toBe('string');
  });

  it('never sends personal details to OpenAI, even if the browser did not remove them', async () => {
    vi.stubEnv('OPENAI_API_KEY', secret); vi.stubEnv('OPENAI_MODEL', 'test');
    const seen = [];
    vi.stubGlobal('fetch', provider({ supported: true, conflicts: [], facts }, seen));
    await analyze(request({ consent: true, documents }), response());
    const sent = JSON.stringify(seen);
    for (const value of ['Jordan', 'Testcase', '123-45-6789', '000123456789', 'fafsa.pdf', 'award.png']) expect(sent, value).not.toContain(value);
    expect(sent).toContain('Federal Pell Grant Fall 2026 $3,698');
  });

  it('asks OpenAI only for Pell, scholarships, loans, SAI and balance fields', async () => {
    vi.stubEnv('OPENAI_API_KEY', secret); vi.stubEnv('OPENAI_MODEL', 'test');
    const seen = [];
    vi.stubGlobal('fetch', provider({ supported: true, conflicts: [], facts }, seen));
    await analyze(request({ consent: true, documents }), response());
    const fieldEnum = seen[0].text.format.schema.properties.facts.items.properties.field.enum;
    expect(fieldEnum).toEqual(READER_FIELDS);
    expect(fieldEnum).not.toContain('workStudyOffer');
    expect(seen[0].store).toBe(false);
  });

  it('refuses raw file uploads and never calls OpenAI', async () => {
    vi.stubEnv('OPENAI_API_KEY', secret); vi.stubEnv('OPENAI_MODEL', 'test');
    const call = vi.fn(); vi.stubGlobal('fetch', call);
    const res = response();
    await analyze(request({ consent: true, files: [{ type: 'application/pdf', data: 'JVBERi0=' }] }), res);
    expect(res.statusCode).toBe(400); expect(call).not.toHaveBeenCalled();
  });

  it('requires consent', async () => {
    vi.stubEnv('OPENAI_API_KEY', secret); vi.stubEnv('OPENAI_MODEL', 'test');
    const call = vi.fn(); vi.stubGlobal('fetch', call);
    const res = response();
    await analyze(request({ documents }), res);
    expect(res.statusCode).toBe(400); expect(call).not.toHaveBeenCalled();
  });

  it('says so when a document has no aid lines, without calling OpenAI', async () => {
    vi.stubEnv('OPENAI_API_KEY', secret); vi.stubEnv('OPENAI_MODEL', 'test');
    const call = vi.fn(); vi.stubGlobal('fetch', call);
    const res = response();
    await analyze(request({ consent: true, documents: [{ name: 'x.png', pages: ['Student Name: Jordan\nHello world'] }] }), res);
    expect(res.statusCode).toBe(422); expect(call).not.toHaveBeenCalled();
  });

  it('turns a provider failure into a clean 502', async () => {
    vi.stubEnv('OPENAI_API_KEY', secret); vi.stubEnv('OPENAI_MODEL', 'test');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    const res = response();
    await analyze(request({ consent: true, documents }), res);
    expect(res.statusCode).toBe(502);
  });

  it('rejects a figure that is not in the quoted document text', async () => {
    vi.stubEnv('OPENAI_API_KEY', secret); vi.stubEnv('OPENAI_MODEL', 'test');
    vi.stubGlobal('fetch', provider({ supported: true, conflicts: [], facts: [{ ...facts[1], value: '$9,999' }] }));
    const res = response();
    await analyze(request({ consent: true, documents }), res);
    expect(res.statusCode).toBe(422);
  });
});

describe('reading real-world screenshots', () => {
  const doc = (pages) => [{ name: 'IMG_0001.png', pages }];
  const run = async (pages, modelFacts, extra = {}) => {
    vi.stubEnv('OPENAI_API_KEY', secret); vi.stubEnv('OPENAI_MODEL', 'test');
    vi.stubGlobal('fetch', provider({ supported: true, conflicts: [], facts: modelFacts, ...extra }));
    const res = response();
    await analyze(request({ consent: true, documents: doc(pages) }), res);
    return res;
  };
  const fact = (over) => ({ field: 'grantOffer', label: 'Federal Pell Grant', value: '$3,698', page: 1, document: 1, kind: 'award-letter', period: 'Fall 2026', estimated: false, quote: 'Federal Pell Grant Fall 2026 $3,698', ...over });

  it('accepts "$3,698" when the screenshot says "$3,698.00"', async () => {
    const res = await run(['Federal Pell Grant Fall 2026 $3,698.00'], [fact({ quote: 'Federal Pell Grant Fall 2026 $3,698.00' })]);
    expect(res.statusCode).toBe(200);
    expect(res.body.summaryFacts[0].value).toBe('$3,698.00');
  });

  it('repairs OCR slips like "S3,698" and "$l,750" in the quote', async () => {
    const res = await run(['Federal Pell Grant Fall 2026 S3,698\nDirect Subsidized Loan $l,750'], [
      fact({ quote: 'Federal Pell Grant Fall 2026 S3,698' }),
      fact({ field: 'subsidizedLoanOffer', label: 'Direct Subsidized Loan', value: '$1,750', period: 'Not stated', quote: 'Direct Subsidized Loan $l,750' }),
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.body.summaryFacts.map((f) => f.value)).toEqual(['$3,698', '$1,750']);
  });

  it('keeps the good figures when one figure is bad, instead of failing everything', async () => {
    const res = await run(['Federal Pell Grant Fall 2026 $3,698\nPresidential Scholarship $2,500'], [
      fact({}),
      fact({ field: 'scholarshipOffer', label: 'Scholarship', value: '$2,500', period: 'Not stated', quote: 'Scholarship: see portal' }),
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.body.summaryFacts.map((f) => f.field)).toEqual(['grantOffer']);
  });

  it('does not throw away the read because the model listed a possible conflict', async () => {
    const res = await run(['Federal Pell Grant Fall 2026 $3,698'], [fact({})], { conflicts: ['Pell may differ from FAFSA estimate'] });
    expect(res.statusCode).toBe(200);
  });

  it('drops a figure that is not printed anywhere in the document, even if quoted', async () => {
    const res = await run(['Federal Pell Grant Fall 2026 $3,698'], [
      fact({}),
      fact({ field: 'scholarshipOffer', label: 'Scholarship', value: '$9,999', period: 'Not stated', quote: 'Scholarship $9,999' }),
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.body.summaryFacts.map((f) => f.value)).toEqual(['$3,698']);
  });

  it('drops both figures when the same line has two different amounts, keeps the rest', async () => {
    const res = await run(['Federal Pell Grant Fall 2026 $3,698\nFederal Pell Grant Fall 2026 $3,000\nPresidential Scholarship $2,500'], [
      fact({}),
      fact({ value: '$3,000', quote: 'Federal Pell Grant Fall 2026 $3,000' }),
      fact({ field: 'scholarshipOffer', label: 'Presidential Scholarship', value: '$2,500', period: 'Not stated', quote: 'Presidential Scholarship $2,500' }),
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.body.summaryFacts.map((f) => f.field)).toEqual(['scholarshipOffer']);
  });

  it('explains a total failure with a content-free reference code', async () => {
    const logs = []; const original = console.log; console.log = (...a) => logs.push(a.join(' '));
    try {
      const res = await run(['Federal Pell Grant Fall 2026 $3,698'], [fact({ value: '$1', quote: 'something else' })]);
      expect(res.statusCode).toBe(422);
      expect(res.body).toMatch(/\(ref: [a-z0-9+-]+\)/);
      expect(res.body).not.toContain('3,698');
    } finally { console.log = original; }
    expect(logs.join('\n')).toContain('Document reader:');
    expect(logs.join('\n')).not.toContain('Pell');
    expect(logs.join('\n')).not.toContain('IMG_0001');
  });

  it('marks an empty model answer so a failed screenshot can be diagnosed without content', async () => {
    const res = await run(['Federal Pell Grant\nFall 2026\n$3,698.00'], []);
    expect(res.statusCode).toBe(422);
    expect(res.body).toMatch(/ref: [a-z0-9+-]*model-empty/);
    expect(res.body).toMatch(/lines-\d+/);
    expect(res.body).not.toContain('3,698');
  });

  it('reads a figure whose label, term and amount were on separate lines', async () => {
    const res = await run(['Federal Pell Grant\nFall 2026\n$3,698.00\nSpring 2027\n$3,697.00'], [
      fact({ value: '$3,698.00', quote: 'Federal Pell Grant Fall 2026 $3,698.00' }),
      fact({ value: '$3,697.00', period: 'Spring 2027', quote: 'Federal Pell Grant Spring 2027 $3,697.00' }),
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.body.summaryFacts.length).toBe(2);
  });
});
