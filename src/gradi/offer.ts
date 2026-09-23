/**
 * Everything on the Gradi offer that is a fact rather than a sentence.
 *
 * All four of these are somebody else's: the link, the code and both figures
 * belong to Gradi, and Gradi can change any of them without telling us. They
 * live here, in one place, so that when the offer moves the edit is four
 * lines rather than a search across two pages and a README — and so that no
 * figure on either Gradi page can drift away from the one the referral link
 * actually pays.
 *
 * Nothing here is computed. Fynliq does not know what a student will earn
 * beyond the fixed $10 the link itself promises, and does not guess.
 */

/** The client's referral link. The $10 offer belongs to it. */
export const GRADI_LINK = 'https://gradi.app.link/HGFD9JiKp6b';

/**
 * Fynliq's referral code, shown so a student can type it in if Gradi does
 * not carry it across from the link.
 *
 * One code for Fynliq, not one per student: issuing per-student codes needs
 * an account on Gradi's side, and a code invented here would be a code Gradi
 * has never heard of — the student would enter it, be credited nothing, and
 * have no way of knowing why. Confirm this against what Gradi issued before
 * launch, the same way GRADI_COVERAGE is confirmed.
 */
export const GRADI_CODE = 'UBELF5KG';

/** What Gradi pays, once the three photos reach ten likes between them. */
export const GRADI_PAYOUT = '$10';

/** What Gradi charges once, to become a creator. */
export const GRADI_FEE = '$5';
