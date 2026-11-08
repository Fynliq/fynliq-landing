// repairFacts: the set a student is shown, saved and later reloaded must
// always pass validateSummary — otherwise a paid student's reload finds
// nothing. Synthetic figures only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repairFacts } from '../api/analyze.js';
import { validateSummary } from '../server/summary.js';

const base = { page: 1, document: 1, kind: 'account-statement', period: 'Fall 2026', estimated: false };
const fact = (field, label, value, extra = {}) => ({ ...base, field, label, value, quote: `${label} Fall 2026 ${value}`, ...extra });
const passes = (facts) => { validateSummary({ supported: true, conflicts: [], facts: facts.map(({ id: _id, ...f }) => f) }); return true; };

test('a valid set comes back unchanged and re-numbered', () => {
  const { facts, dropped } = repairFacts([fact('grantOffer', 'Federal Pell Grant', '$3,698'), fact('balanceDue', 'Amount due', '$1,200.00')]);
  assert.equal(dropped, 0);
  assert.deepEqual(facts.map((f) => [f.id, f.field]), [['f1', 'grantOffer'], ['f2', 'balanceDue']]);
});

test('two reads that disagree on one row lose that row only — never pick one value', () => {
  const { facts, dropped } = repairFacts([
    fact('paymentApplied', 'Payment', '$500.00'), fact('paymentApplied', 'Payment', '$300.00'), fact('balanceDue', 'Amount due', '$3,200.00'),
  ]);
  assert.equal(dropped, 2);
  assert.deepEqual(facts.map((f) => `${f.field}:${f.value}`), ['balanceDue:$3,200.00']);
});

test('a figure that is not in its own quote is dropped, the rest kept', () => {
  const bad = { ...fact('balanceDue', 'Amount due', '$9,999.00'), quote: 'Amount due Fall 2026 $1,200.00' };
  const { facts, dropped } = repairFacts([bad, fact('grantOffer', 'Federal Pell Grant', '$3,698')]);
  assert.equal(dropped, 1);
  assert.deepEqual(facts.map((f) => f.field), ['grantOffer']);
});

test('nothing usable gives an empty set, not an exception', () => {
  assert.deepEqual(repairFacts([]), { facts: [], dropped: 0 });
  assert.deepEqual(repairFacts(null), { facts: [], dropped: 0 });
  assert.deepEqual(repairFacts([{ field: 'nope' }, 'x', null]), { facts: [], dropped: 1 });
});

test('document numbers beyond the saved file count are dropped on reload', () => {
  const { facts } = repairFacts([fact('grantOffer', 'Federal Pell Grant', '$3,698', { document: 2 }), fact('balanceDue', 'Amount due', '$1,200.00')], 1);
  assert.deepEqual(facts.map((f) => f.field), ['balanceDue']);
});

test('whatever the mix, the result always passes validateSummary (300 seeded mixes)', () => {
  const pool = [
    fact('grantOffer', 'Federal Pell Grant', '$3,698'), fact('grantOffer', 'Federal Pell Grant', '$3,700'),
    fact('scholarshipOffer', 'Merit Scholarship', '$1,000'), fact('subsidizedLoanOffer', 'Direct Subsidized Loan', '$3,500'),
    fact('paymentApplied', 'Payment', '$500.00'), fact('paymentApplied', 'Payment', '$300.00'), fact('paymentApplied', 'Payment', '$500.00'),
    fact('balanceDue', 'Amount due', '$3,200.00'), { ...fact('balanceDue', 'Amount due', '$1.00'), quote: 'Amount due Fall 2026 $3,200.00' },
    fact('sai', 'Student Aid Index', '-1500', { kind: 'fafsa-submission-summary' }), fact('sai', 'Student Aid Index', '-2000', { kind: 'fafsa-submission-summary' }),
    { ...fact('balanceDue', 'Balance', '$100.00'), quote: 'SSN 123-45-6789 Balance $100.00' },
  ];
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = 0; i < 300; i++) {
    const mix = pool.filter(() => rand() < 0.5).sort(() => rand() - 0.5);
    const { facts, dropped } = repairFacts(mix);
    assert.equal(facts.length + dropped, mix.length);
    if (facts.length) assert.ok(passes(facts), `mix ${i} produced a set the reload would reject`);
  }
});
