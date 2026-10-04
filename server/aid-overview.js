// The numbers behind the free preview, the "things to review" and the
// questions for the aid office — computed on the server from the figures the
// reader verified, so the browser of an account that has not unlocked never
// receives the figures themselves.
//
// Nothing is invented. Totals use the same rules as the results page
// (src/core/documentAnalysis.ts): a whole-year figure when printed, otherwise
// the terms added up; FAFSA estimates are never mixed into a school offer.
// When a total cannot be worked out reliably it is null, and the page says
// "Not enough information".

const KIND = {
  grantOffer: 'grant', scholarshipOffer: 'grant', estimatedPellGrant: 'grant',
  subsidizedLoanOffer: 'subsidized-loan', unsubsidizedLoanOffer: 'unsubsidized-loan', workStudyOffer: 'work-study',
};
const TERM = /\b(?:fall|spring|summer|winter|autumn|semester|term|quarter|trimester)\b/i;
const amountOf = (f) => Number(String(f.value).replace(/[$,\s]/g, ''));
const norm = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const whole = (n) => Math.round(n);
const uniqueAmounts = (facts) => [...new Set(facts.map(amountOf).filter(Number.isFinite))];
const usd = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

function tidyLabel(label) {
  let text = String(label).trim().replace(/\s+\d{1,2}$/, '');
  if (/[A-Z]/.test(text) && text === text.toUpperCase()) {
    text = text.toLowerCase().replace(/(^|[\s\-/(])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
  }
  return text || String(label).trim();
}

function yearlyAmount(facts) {
  const year = facts.filter((f) => !TERM.test(f.period));
  if (year.length) return Math.max(...year.map(amountOf));
  const byTerm = new Map();
  for (const f of facts) byTerm.set(norm(f.period), amountOf(f));
  return [...byTerm.values()].reduce((sum, n) => sum + n, 0);
}

function lines(facts) {
  const groups = new Map();
  for (const f of facts) {
    const kind = KIND[f.field];
    if (!kind) continue;
    const key = `${kind}|${norm(tidyLabel(f.label))}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  return [...groups.values()].map((g) => ({ kind: KIND[g[0].field], label: tidyLabel(g[0].label), field: g[0].field, amount: whole(yearlyAmount(g)) }))
    .filter((l) => l.amount > 0);
}

function semesterBill(facts) {
  const of = (field) => facts.filter((f) => f.field === field && !f.estimated);
  const bills = uniqueAmounts(of('schoolBill'));
  const dues = uniqueAmounts(of('balanceDue'));
  const payments = new Map();
  for (const f of of('paymentApplied')) payments.set(`${norm(f.label)}|${norm(f.period)}`, amountOf(f));
  const paid = payments.size ? [...payments.values()].reduce((s, n) => s + n, 0) : null;
  if (bills.length === 1) {
    const applied = paid ?? (dues.length === 1 ? Math.max(0, bills[0] - dues[0]) : null);
    return applied === null ? null : { bill: whole(bills[0]), applied: whole(Math.min(applied, bills[0])) };
  }
  if (dues.length === 1) return { bill: whole(dues[0] + (paid ?? 0)), applied: whole(paid ?? 0) };
  return null;
}

const sum = (ls, kinds) => {
  const xs = ls.filter((l) => kinds.includes(l.kind));
  return xs.length ? xs.reduce((s, l) => s + l.amount, 0) : null;
};

/**
 * @returns {{ glance: object, review: {id:string,title:string,detail:string}[], questions: string[] }}
 */
export function computeAidOverview(facts) {
  const award = facts.filter((f) => f.field in KIND);
  const offers = award.filter((f) => !f.estimated);
  const estimates = award.filter((f) => f.estimated);
  const estimatesOnly = offers.length === 0 && estimates.length > 0;
  const ls = lines(estimatesOnly ? estimates : offers);

  const freeMoney = sum(ls, ['grant']);
  const borrowed = sum(ls, ['subsidized-loan', 'unsubsidized-loan']);
  const workStudy = sum(ls, ['work-study']);

  const coaFacts = facts.filter((f) => f.field === 'costOfAttendance' && !f.estimated);
  const coaYear = uniqueAmounts(coaFacts.filter((f) => !TERM.test(f.period)));
  const coaAll = uniqueAmounts(coaFacts);
  const costOfAttendance = coaYear.length === 1 ? whole(coaYear[0]) : coaAll.length === 1 ? whole(coaAll[0]) : null;
  const bill = semesterBill(facts);

  // Remaining cost: from this term's bill when a statement was uploaded;
  // otherwise from the cost of attendance minus grants, only when both the
  // cost and at least one award line were read. Loans are not subtracted:
  // they are owed back.
  let remainingCost = null; let remainingBasis = null;
  if (bill) { remainingCost = Math.max(0, bill.bill - bill.applied); remainingBasis = 'bill'; }
  else if (costOfAttendance !== null && ls.length) { remainingCost = Math.max(0, costOfAttendance - (freeMoney ?? 0)); remainingBasis = 'cost_of_attendance'; }
  const afterLoans = remainingCost === null ? null : Math.max(0, remainingCost - (borrowed ?? 0));

  const review = [];
  const add = (id, title, detail) => review.push({ id, title, detail });
  if (estimatesOnly) add('estimates', 'These are FAFSA estimates, not your school’s offer', 'Your school sends its own offer. Amounts can change, so wait for it before planning around these numbers.');
  if (remainingCost !== null && remainingCost > 0) {
    add('remaining', `About ${usd(remainingCost)} is not covered by grants or scholarships`,
      remainingBasis === 'bill' ? 'That is what your statement still shows after the aid already applied.' : 'That is your cost of attendance minus the free money on this document. Cost of attendance includes living costs, not only tuition.');
  }
  if (afterLoans !== null && afterLoans > 0 && borrowed) add('gap', `Even with every loan, about ${usd(afterLoans)} may still be left`, 'Ask your aid office about grants, appeals or a payment plan for this part.');
  if (borrowed) add('loans', `You were offered ${usd(borrowed)} in loans`, 'Loans are an offer. You can usually accept less than the full amount, and you repay what you accept, with interest.');
  if (workStudy) add('work-study', `${usd(workStudy)} of work-study is not paid upfront`, 'You earn it as wages from an eligible job, so it does not lower your bill at the start of the term.');
  if (remainingBasis === null) add('missing-cost', 'Your total cost is not on this document', 'Without your cost of attendance or a bill, Fynliq cannot work out what you may owe. Your award letter or student account usually shows it.');

  const questions = [];
  if (borrowed) questions.push('Can I accept less than the full loan amount, and how do I do that in the portal?');
  if ((afterLoans ?? remainingCost ?? 0) > 0) questions.push(`Is there any more grant aid, scholarship or an appeal process for the ${usd(afterLoans || remainingCost)} I may still owe?`);
  if ((remainingCost ?? 0) > 0) questions.push('Do you offer an interest-free payment plan, and what is the deadline to sign up?');
  if (estimatesOnly) questions.push('When will my official financial aid offer be ready?');
  if (remainingBasis === null) questions.push('What is my total cost of attendance for this year?');
  if (workStudy) questions.push('How do I find a work-study job, and when does the first paycheck arrive?');
  if (ls.some((l) => l.kind === 'grant' && /institution|universit|college|school|merit|presidential/i.test(l.label))) questions.push('What do I need to do to keep my school grant next year?');
  questions.push('When will my aid be paid out, and when would any refund reach me?');

  return {
    glance: { freeMoney, borrowed, remainingCost, remainingBasis, afterLoans, workStudy, estimatesOnly },
    review,
    questions: questions.slice(0, 5),
  };
}

/** The only part an account that has not unlocked receives. */
export function previewOf(overview, facts) {
  const { freeMoney, borrowed, remainingCost, remainingBasis, estimatesOnly } = overview.glance;
  return { glance: { freeMoney, borrowed, remainingCost, remainingBasis, estimatesOnly }, reviewCount: overview.review.length, figures: facts.length };
}
