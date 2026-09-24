import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateSummary, signSummary, verifySummary } from './summary';
import { answerQuestion } from './ask-service';
import analyze from '../api/analyze';
import { parseAskAnswer } from '../src/ask/contract';

const secret = 'test-only-not-a-real-api-key';
const fixture = () => ({ supported: true, conflicts: [], facts: [
  { field: 'sai', label: 'Student Aid Index', value: '-1500', page: 1, document: 1, kind: 'fafsa-submission-summary', period: '2026-27', estimated: false, quote: 'Student Aid Index: -1500' },
  { field: 'estimatedPellGrant', label: 'Estimated Pell', value: '7000', page: 2, document: 1, kind: 'fafsa-submission-summary', period: '2026-27', estimated: false, quote: 'Estimated Pell Grant: $7,000' },
  { field: 'grantOffer', label: 'Institutional grant', value: '3000', page: 1, document: 2, kind: 'award-letter', period: 'Fall 2026', estimated: false, quote: 'Fall 2026 Institutional grant $3,000' },
  { field: 'balanceDue', label: 'Balance due', value: '1200', page: 1, document: 3, kind: 'account-statement', period: 'Fall 2026', estimated: false, quote: 'Balance due: $1,200' },
] });
const provider = data => async () => ({ ok: true, json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] }] }) });
function response() {
  return { statusCode: 200, body: null, headers: {}, setHeader(k,v) {this.headers[k]=v;}, status(code) {this.statusCode=code;return this;}, send(value) {this.body=value;return this;}, json(value) {this.body=value;return this;} };
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('document evidence and authenticity', () => {
  it('preserves negative SAI, periods and all three document sources', () => {
    const facts = validateSummary(fixture());
    expect(facts[0].value).toBe('-1500');
    expect(facts[1].estimated).toBe(true);
    expect(facts.map(f => f.document)).toEqual([1,1,2,3]);
    expect(facts[2].period).toBe('Fall 2026');
  });
  it('rejects conflicts rather than choosing a convenient figure', () => {
    const data = fixture(); data.conflicts = ['Conflicting bill']; expect(() => validateSummary(data)).toThrow();
    data.conflicts = []; data.facts.push({...data.facts[3], value:'1800', quote:'Balance due $1,800'}); expect(() => validateSummary(data)).toThrow();
  });
  it.each([
    {value:'9999'}, {page:0}, {document:4}, {field:'socialSecurityNumber'}, {value:'NaN'}, {quote:'SSN 123-45-6789 and -1500'},
  ])('rejects malformed or unsupported fact %j', patch => {
    const data=fixture(); data.facts[0]={...data.facts[0],...patch}; expect(() => validateSummary(data)).toThrow();
  });
  it('rejects unrelated documents and an empty extraction', () => {
    expect(() => validateSummary({supported:false,conflicts:[],facts:[]})).toThrow();
    expect(() => validateSummary({supported:true,conflicts:[],facts:[]})).toThrow();
  });
  it('rejects values that match only part of a quoted amount', () => {
    const data = fixture();
    data.facts[1] = {...data.facts[1], value: '700', quote: 'Estimated Pell Grant $7,000'};
    expect(() => validateSummary(data)).toThrow();
  });
  it('verifies signatures and rejects tampering, expiry and another key', () => {
    const facts=validateSummary(fixture()); const token=signSummary(facts,secret,1000);
    expect(verifySummary(token,secret,2000)).toEqual(facts);
    expect(() => verifySummary(token+'x',secret,2000)).toThrow();
    expect(() => verifySummary(token,secret,3601000)).toThrow();
    expect(() => verifySummary(token,'other-key',2000)).toThrow();
  });
});

describe('personalized answers', () => {
  const analysis = () => ({reviewed:true,summaryToken:signSummary(validateSummary(fixture()),secret)});
  it('uses signed facts and returns citations the frontend accepts', async () => {
    const result=await answerQuestion({question:'What does my bill show?',analysis:analysis()}, {apiKey:secret,model:'test',fetchImpl:provider({paragraphs:['Your statement lists a balance due of $1,200.'],usedFields:['f4']})});
    expect(result.status).toBe(200); expect(parseAskAnswer(result.body).basis).toBe('personal');
    expect(result.body.grounding[0]).toContain('document 3, page 1');
  });
  it('will not personalize unreviewed, demo or forged data', async () => {
    for(const value of [{}, {reviewed:false}, {reviewed:true,summaryToken:'fake'}, {reviewed:true,provenance:'demo'}]) {
      const result=await answerQuestion({question:'my aid?',analysis:value},{apiKey:secret,model:'test'}); expect(result.status).toBe(409);
    }
  });
  it('rejects a citation that is not in the uploaded evidence', async () => {
    const result=await answerQuestion({question:'my aid?',analysis:analysis()},{apiKey:secret,model:'test',fetchImpl:provider({paragraphs:['Your aid.'],usedFields:['f99']})}); expect(result.status).toBe(502);
  });
  it('rejects dollar amounts unsupported by cited facts', async () => {
    const result=await answerQuestion({question:'my balance?',analysis:analysis()},{apiKey:secret,model:'test',fetchImpl:provider({paragraphs:['Your balance is $9,999.'],usedFields:['f4']})}); expect(result.status).toBe(502);
  });
  it('labels missing-data answers general', async () => {
    const result=await answerQuestion({question:'When will money arrive?',analysis:analysis()},{apiKey:secret,model:'test',fetchImpl:provider({paragraphs:['Your documents do not state a disbursement date. Ask your school.'],usedFields:[]})}); expect(result.body.basis).toBe('general'); expect(result.body.grounding).toEqual([]);
  });
});

describe('upload boundary', () => {
  it('refuses raw files without calling OpenAI', async () => {
    vi.stubEnv('OPENAI_API_KEY', secret); vi.stubEnv('OPENAI_MODEL', 'test');
    const call=vi.fn();vi.stubGlobal('fetch',call);
    const res=response();await analyze({method:'POST',headers:{},body:{consent:true,files:[{type:'application/pdf',data:'synthetic'}]}},res);
    expect(res.statusCode).toBe(400);expect(call).not.toHaveBeenCalled();
  });
});

describe('figures next to a year', () => {
  it('accepts an amount printed right after a term and year', () => {
    const data = fixture();
    data.facts[2] = { ...data.facts[2], value: '$3,698', quote: 'Federal Pell Grant Fall 2026 $3,698' };
    expect(validateSummary(data)[2].value).toBe('$3,698');
  });
  it('still rejects a value that is only part of a printed number', () => {
    const data = fixture();
    data.facts[2] = { ...data.facts[2], value: '369', quote: 'Federal Pell Grant Fall 2026 $3,698' };
    expect(() => validateSummary(data)).toThrow();
  });
});
