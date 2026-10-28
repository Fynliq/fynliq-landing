import { describe, expect, it } from 'vitest';
import { findRestingMatch, proposeMatch, type Offer } from '../src/exchange/matching';

const base: Offer = { id: 'ask-1', side:'sell', variantId:'shoe-10-new', ownerId:'seller',
  priceCents:15000, status:'open', createdAt: 1 };
const incoming: Offer = { ...base, id:'bid-1', side:'buy', ownerId:'buyer', priceCents:16000, createdAt:2 };
describe('Exchange price-time matching — proposal only', () => {
  it('matches exact variants only', () => {
    expect(findRestingMatch(incoming, [{ ...base, variantId:'shoe-9-new' }])).toBeNull();
  });
  it('does not match price gaps', () => {
    expect(findRestingMatch({ ...incoming,priceCents:14000 }, [base])).toBeNull();
  });
  it('does not self trade', () => {
    expect(findRestingMatch({ ...incoming,ownerId:'seller' }, [base])).toBeNull();
  });
  it('ignores reserved orders', () => {
    expect(findRestingMatch(incoming, [{ ...base,status:'reserved' }])).toBeNull();
  });
  it('chooses lowest ask and price-time priority', () => {
    const other={ ...base,id:'ask-2',ownerId:'seller-2', priceCents:14000,createdAt:3 };
    expect(findRestingMatch(incoming,[base,other])?.id).toBe('ask-2');
    expect(findRestingMatch(incoming,[{...other,priceCents:15000},base])?.id).toBe('ask-1');
  });
  it('executes at resting order price (conceptually)', () => {
    expect(proposeMatch(incoming,[base])).toMatchObject({
      buyerId:'buyer',sellerId:'seller',tradePriceCents:15000,state:'awaiting_verification'
    });
  });
  it('handles incoming sells against highest buy', () => {
    const bid={...incoming,id:'bid-old',createdAt:0,priceCents:17000 };
    expect(proposeMatch({...base,id:'ask-new',ownerId:'seller-new'},[bid])?.tradePriceCents).toBe(17000);
  });
  it('rejects zero, negative, fractional and unrealistic prices', () => {
    for (const priceCents of [0,-1,99,1.5,10000001,Number.NaN])
      expect(()=>findRestingMatch({...incoming,priceCents},[base])).toThrow();
  });
});
