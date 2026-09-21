import { describe, expect, it } from 'vitest';
import { redactPage, redactDocuments, REDACTED } from './redact';
import { containsHighRiskPII } from './privacy';

// Every value below is invented for testing.
const FAKE_FAFSA = `FAFSA Submission Summary
Student Name: Jordan Q. Testcase
Date of Birth: 04/11/2004
Social Security Number: 123-45-6789
Address: 42 Fake Street, Springfield, IL 62701
Email: jordan.test@example.edu Phone: (555) 010-4477
FSA ID username: jtest2004
Parent Adjusted Gross Income: $18,200
Student ID: A00123456
Student Aid Index (SAI): -1500
Federal Pell Grant Eligibility: Estimated $7,395
2026-27 Award Year`;

const FAKE_AWARD = `2026-27 Financial Aid Offer for Jordan Q. Testcase
Federal Pell Grant Fall 2026 $3,698 Accepted
Presidential Scholarship $2,500
Direct Subsidized Loan $1,750 Offered
Direct Unsubsidized Loan
$1,000`;

const FAKE_STATEMENT = `Student Account Statement
Account Number 000123456789
Routing 021000021
Tuition and fees Fall 2026 $8,200.00
Payments applied Fall 2026 $6,400.00
Balance Due Fall 2026 $1,800.00`;

const PERSONAL = ['Jordan', 'Testcase', '123-45-6789', '04/11/2004', 'Fake Street', '62701', 'jordan.test', '010-4477', 'jtest2004', '18,200', 'A00123456', '000123456789', '021000021'];

describe('redaction', () => {
  it('removes every personal detail from a FAFSA summary, award letter and statement', () => {
    const all = [FAKE_FAFSA, FAKE_AWARD, FAKE_STATEMENT].map((t) => redactPage(t).text).join('\n');
    for (const value of PERSONAL) expect(all, value).not.toContain(value);
    expect(containsHighRiskPII(all)).toBe(false);
  });

  it('keeps Pell, scholarship, Direct Loan, SAI and balance lines', () => {
    const all = [FAKE_FAFSA, FAKE_AWARD, FAKE_STATEMENT].map((t) => redactPage(t).text).join('\n');
    for (const value of ['Student Aid Index (SAI): -1500', 'Estimated $7,395', 'Federal Pell Grant Fall 2026 $3,698', 'Presidential Scholarship $2,500', 'Direct Subsidized Loan $1,750', 'Direct Unsubsidized Loan\n$1,000', 'Balance Due Fall 2026 $1,800.00', '2026-27 Award Year']) {
      expect(all).toContain(value);
    }
  });

  it('drops lines that have nothing to do with aid', () => {
    const r = redactPage('Welcome back!\nClick here to log out\nFederal Pell Grant $3,698');
    expect(r.text).toBe('Federal Pell Grant $3,698');
  });

  it('blacks out identifiers that appear inside an aid line', () => {
    const t = redactPage('Pell Grant ref 5566778899 for student jordan.test@example.edu $3,698').text;
    expect(t).not.toContain('5566778899');
    expect(t).not.toContain('jordan.test@example.edu');
    expect(t).toContain('$3,698');
    expect(t).toContain(REDACTED);
  });

  it('removes a name written inside an aid line', () => {
    expect(redactPage('Scholarship awarded to Maria Lopez-Diaz: $1,000').text).not.toContain('Maria');
    expect(redactPage('Federal Pell Grant for Fall 2026 $3,698').text).toBe('Federal Pell Grant for Fall 2026 $3,698');
  });

  it('keeps money amounts that look like numbers', () => {
    expect(redactPage('Direct Unsubsidized Loan $12,500.00').text).toBe('Direct Unsubsidized Loan $12,500.00');
    expect(redactPage('Student Aid Index 0').text).toBe('Student Aid Index 0');
  });

  it('reports what it removed without the removed values', () => {
    const [doc] = redactDocuments([{ pages: [FAKE_FAFSA] }]);
    expect(doc.removed.personal).toBeGreaterThan(5);
    expect(JSON.stringify(doc.removed)).not.toMatch(/\d{3}-\d{2}/);
  });
});
