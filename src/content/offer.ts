/**
 * The offer, in one place.
 *
 * Every screen that mentions the price says it in these words: the landing
 * page beside its main button, the sign-up form before it is submitted, the
 * My Aid preview and the Search, Ask and Earn screens. A student who reads
 * "free preview" on one page and "$1 to start" on another stops trusting both.
 *
 * Changing the price itself is a Stripe and server change (server/billing.js
 * UNLOCK_PRICE); this file only has to agree with it.
 */

/** The price, as shown. */
export const PRICE = '$1';

/** The sentence that goes next to every way into the product. */
export const PRICE_LINE = `Free preview, then ${PRICE} to unlock the full analysis.`;

/** The terms, said wherever the $1 button is. */
export const PRICE_TERMS = 'One-time payment. No subscription. Nothing renews.';

/** What the free preview shows, before any payment. */
export const FREE_PREVIEW = [
  'Your free money: grants and scholarships',
  'What you would borrow',
  'What you may still owe, when your document states it',
  'How many things Fynliq flagged for you to review',
] as const;

/** What the $1 unlocks, item by item, with what each one tells the student. */
export const UNLOCKS: readonly { label: string; what: (reviewCount?: number) => string }[] = [
  { label: 'Your grants explained', what: () => 'Each line of free money, and what keeps it coming next year' },
  { label: 'Your loans explained', what: () => 'How much you actually need to borrow, and which loan to take first' },
  { label: 'What you may actually owe', what: () => 'What is left after grants, and after loans' },
  {
    label: 'Important things to review',
    what: (n = 0) => (n > 0 ? `The ${n} ${n === 1 ? 'thing' : 'things'} Fynliq flagged, in plain English` : 'Anything worth checking before you accept'),
  },
  { label: 'Personalized next steps', what: () => 'What to do next, most important first' },
  { label: 'Questions to ask your financial aid office', what: () => 'Written for your offer, ready to copy into an email' },
];

/** The same $1 also opens these tabs. */
export const ALSO_OPENS = `The same ${PRICE} also opens Ask Fynliq, Search and Earn.`;
