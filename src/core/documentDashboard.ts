import type { AidAnalysis } from './analysis';
import { formatUSD } from './money';

export type DocumentFact = NonNullable<AidAnalysis['summaryFacts']>[number];
const giftFields = ['grantOffer', 'scholarshipOffer'];
const loanFields = ['subsidizedLoanOffer', 'unsubsidizedLoanOffer'];
const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
export const factAmount = (fact: DocumentFact) => Number(fact.value.replace(/[$,\s]/g, ''));

/** Sum only listed lines within one explicitly stated period; never mix estimates or annual/term amounts. */
export function documentDashboard(facts: DocumentFact[]) {
  const unique = [...new Map(facts.map(f => [
    [f.field, normalize(f.label), normalize(f.period), f.value.replace(/[$,\s]/g, ''), f.estimated].join('|'), f,
  ])).values()];
  function groups(fields: string[]) {
    const result = new Map<string, { period: string; amount: number; facts: DocumentFact[] }>();
    for (const f of unique.filter(f => fields.includes(f.field) && !f.estimated && f.kind === 'award-letter')) {
      // Undated lines are kept separately: their periods may differ even within one file.
      const key = normalize(f.period) === 'not stated' ? f.id : normalize(f.period);
      const group = result.get(key) ?? { period: f.period, amount: 0, facts: [] };
      group.amount = Math.round((group.amount + factAmount(f)) * 100) / 100;
      group.facts.push(f); result.set(key, group);
    }
    return [...result.values()];
  }
  const gifts = groups(giftFields), loans = groups(loanFields);
  const balances = unique.filter(f => ['balanceDue', 'creditBalance'].includes(f.field) && f.kind === 'account-statement' && !f.estimated);
  const balance = balances.length === 1 ? balances[0] : undefined;
  const estimates = unique.filter(f => f.estimated && ['estimatedPellGrant', ...giftFields, ...loanFields].includes(f.field));
  const saiFacts = unique.filter(f => f.field === 'sai');
  const sai = saiFacts.length === 1 ? saiFacts[0] : undefined;
  let headline = 'Your documents are ready. Here is what they tell you.';
  let detail = 'Your extracted figures are organized below. Check them against the originals; missing figures are left blank.';
  if (balance) {
    headline = balance.field === 'creditBalance'
      ? `Your statement shows a ${formatUSD(factAmount(balance))} credit balance.`
      : factAmount(balance) === 0 ? 'Your statement shows no balance due.' : `Your statement shows ${formatUSD(factAmount(balance))} still due.`;
    detail = `This is the balance printed for ${balance.period}. Award offers and FAFSA estimates are shown separately; they are not assumed to be payments already applied. ${balance.field === 'creditBalance' ? 'Your school must confirm whether and when a refund will be released.' : 'Check with your school for pending aid and the current payment deadline.'}`;
  } else if (gifts.length === 1) {
    headline = `${formatUSD(gifts[0].amount)} in grants and scholarships is listed in your offer.`;
    detail = `These are the listed grant and scholarship lines for ${gifts[0].period}. ${loans.length === 1 && normalize(loans[0].period) === normalize(gifts[0].period) ? `A separate ${formatUSD(loans[0].amount)} is offered as loans, which would need to be repaid if borrowed. ` : ''}A current statement balance is needed to know what you still owe.`;
  } else if (estimates.length === 1) {
    headline = `Your FAFSA lists ${formatUSD(factAmount(estimates[0]))} as estimated aid.`;
    detail = `This is an estimate for ${estimates[0].period}, not a confirmed school award or payment. Add your award letter and account statement to see your offered aid and stated balance alongside it.`;
  }
  const missing = [
    ...(!unique.some(f => f.kind === 'award-letter' && [...giftFields, ...loanFields, 'workStudyOffer'].includes(f.field)) ? ['A school award letter with aid offers'] : []),
    ...(!balances.length ? ['A current account statement with a balance due or credit balance'] : []),
    ...(!unique.some(f => f.field === 'costOfAttendance') ? ['Your school’s cost of attendance'] : []),
    ...(!sai ? ['A single clearly stated Student Aid Index'] : []),
    ...(!unique.some(f => f.field === 'disbursementDate') ? ['A confirmed disbursement or refund schedule'] : []),
  ];
  return { facts: unique, gifts, loans, balances, balance, estimates, sai, headline, detail, missing,
    awardFacts: unique.filter(f => [...giftFields, ...loanFields, 'workStudyOffer', 'estimatedPellGrant'].includes(f.field)),
    billFacts: unique.filter(f => ['schoolBill', 'paymentApplied', 'balanceDue', 'creditBalance'].includes(f.field)),
  };
}
