/** Fynliq Exchange: pure, deterministic demo matcher. Never settles payments. */
export type Side = 'buy' | 'sell';
export type OfferStatus = 'open' | 'reserved' | 'cancelled';
export interface Offer {
  id: string;
  side: Side;
  variantId: string;
  ownerId: string;
  priceCents: number;
  status: OfferStatus;
  createdAt: number;
}
export interface ProposedMatch {
  buyerId: string;
  sellerId: string;
  buyerOrderId: string;
  sellerOrderId: string;
  variantId: string;
  tradePriceCents: number;
  state: 'awaiting_verification';
}
export const isValidPrice = (cents: number): boolean =>
  Number.isSafeInteger(cents) && cents >= 100 && cents <= 10_000_000;

/** Best price, then earliest timestamp, then stable ID. Price at resting order limit. */
export function findRestingMatch(incoming: Offer, resting: readonly Offer[]): Offer | null {
  if (!isValidPrice(incoming.priceCents) || !incoming.ownerId || !incoming.variantId ||
      !['buy', 'sell'].includes(incoming.side)) throw new Error('Invalid offer');
  const opposite: Side = incoming.side === 'buy' ? 'sell' : 'buy';
  const eligible = resting.filter(o =>
    o.side === opposite && o.status === 'open' &&
    o.variantId === incoming.variantId && o.ownerId !== incoming.ownerId &&
    isValidPrice(o.priceCents) &&
    (incoming.side === 'buy' ? o.priceCents <= incoming.priceCents : o.priceCents >= incoming.priceCents)
  );
  eligible.sort((a,b) =>
    (incoming.side === 'buy' ? a.priceCents - b.priceCents : b.priceCents - a.priceCents) ||
    a.createdAt - b.createdAt || a.id.localeCompare(b.id)
  );
  return eligible[0] ?? null;
}

export function proposeMatch(incoming: Offer, resting: readonly Offer[]): ProposedMatch | null {
  const matched = findRestingMatch(incoming, resting);
  if (!matched) return null;
  const buyer = incoming.side === 'buy' ? incoming : matched;
  const seller = incoming.side === 'sell' ? incoming : matched;
  return {
    buyerId: buyer.ownerId, sellerId: seller.ownerId,
    buyerOrderId: buyer.id, sellerOrderId: seller.id,
    variantId: incoming.variantId,
    tradePriceCents: matched.priceCents,
    state: 'awaiting_verification'
  };
}
export const dollars = (cents: number) =>
  new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', maximumFractionDigits:0 }).format(cents / 100);
