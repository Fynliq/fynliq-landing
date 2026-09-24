import { describe, expect, it } from 'vitest';
import { documentDashboard, type DocumentFact } from '../documentDashboard';
const fact = (patch: Partial<DocumentFact> = {}): DocumentFact => ({id:'f1',field:'grantOffer',label:'School grant',value:'3000',page:1,document:1,kind:'award-letter',period:'Fall 2026',estimated:false,quote:'School grant $3,000',...patch});
describe('document dashboard', () => {
  it('uses a stated balance without subtracting offers or treating payments as grants', () => {
    const result = documentDashboard([fact(), fact({id:'f2',field:'balanceDue',label:'Balance due',value:'1800',kind:'account-statement'}), fact({id:'f3',field:'paymentApplied',label:'Payments',value:'6400',kind:'account-statement'})]);
    expect(result.headline).toContain('$1,800 still due'); expect(result.gifts[0].amount).toBe(3000);
  });
  it('keeps FAFSA estimates out of school offer totals', () => {
    const result = documentDashboard([fact({field:'estimatedPellGrant',kind:'fafsa-submission-summary',estimated:true,value:'7000'})]);
    expect(result.gifts).toEqual([]); expect(result.loans).toEqual([]); expect(result.balance).toBeUndefined(); expect(result.headline).toContain('estimated aid');
  });
  it('keeps annual and semester amounts separate', () => {
    const result = documentDashboard([fact(),fact({id:'f2',period:'2026-2027',value:'6000'})]);
    expect(result.gifts.map(g => g.amount)).toEqual([3000,6000]); expect(result.headline).not.toContain('$9,000');
  });
  it('deduplicates the same stated line without doubling totals across documents', () => {
    expect(documentDashboard([fact(),fact({id:'f2',document:2})]).gifts[0].amount).toBe(3000);
  });
  it('does not combine undated lines', () => {
    const result = documentDashboard([fact({period:'Not stated'}),fact({id:'f2',label:'Other grant',period:'Not stated'})]);
    expect(result.gifts).toHaveLength(2);
  });
  it('does not invent zero-valued awards or a balance when nothing was read', () => {
    const result = documentDashboard([]); expect(result.gifts).toEqual([]); expect(result.balance).toBeUndefined(); expect(result.headline).not.toContain('$0'); expect(result.missing.length).toBeGreaterThan(0);
  });
  it('does not pick one of multiple statement periods as the current balance', () => {
    const result = documentDashboard([fact({field:'balanceDue',kind:'account-statement'}),fact({id:'f2',field:'balanceDue',kind:'account-statement',period:'Spring 2027'})]);
    expect(result.balance).toBeUndefined(); expect(result.balances).toHaveLength(2);
  });
});
