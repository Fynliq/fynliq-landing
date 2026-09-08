import type { Award, RunwayInput, Semester } from '../core';

/**
 * The single demo student used across every landing-page preview.
 *
 * These are the beta prototype's demo figures, kept identical so the landing
 * page and the app show the same product. They are labelled "Demo figures"
 * wherever they appear on screen. Nothing here is presented as a real
 * scholarship, deadline or award belonging to anyone.
 */
export const DEMO_AWARD: Award = {
  year: '2026\u201327',
  source: 'school portal',
  costOfAttendance: 26_600,
  lines: [
    {
      id: 'pell',
      label: 'Federal Pell Grant',
      meaning: 'Free money, never repaid',
      kind: 'grant',
      amount: 7_395,
      verified: true,
    },
    {
      id: 'institutional',
      label: 'Undergrad institutional grant',
      meaning: "Your school's own money, never repaid",
      kind: 'grant',
      amount: 5_405,
      verified: true,
    },
    {
      id: 'sub',
      label: 'Direct subsidized loan',
      meaning: 'Repaid. No interest while enrolled',
      kind: 'subsidized-loan',
      amount: 5_500,
      verified: true,
    },
    {
      id: 'unsub',
      label: 'Direct unsubsidized loan',
      meaning: 'Repaid. Interest starts immediately',
      kind: 'unsubsidized-loan',
      amount: 2_000,
      verified: true,
    },
    {
      id: 'work-study',
      label: 'Federal work-study',
      meaning: 'Wages for hours worked. Not a lump sum',
      kind: 'work-study',
      amount: 2_400,
      verified: true,
    },
  ],
};

export const DEMO_SEMESTER: Semester = {
  bill: 8_200,
  grantsApplied: 6_400,
  subsidizedAvailable: 2_750,
  unsubsidizedAvailable: 1_000,
};

export const DEMO_RUNWAY: RunwayInput = {
  moneyLeft: 2_555,
  spent: 340,
  nextDisbursement: { date: '2027-01-12', label: 'your spring refund on 12 January' },
  today: '2026-09-01',
};

/** The same student before they have added a disbursement date. */
export const DEMO_RUNWAY_NO_DATE: RunwayInput = {
  ...DEMO_RUNWAY,
  nextDisbursement: null,
};

/** Grants applied to this term's bill, itemised the way the portal shows them. */
export const DEMO_GRANTS_APPLIED = [
  { label: 'Pell', amount: 3_698 },
  { label: 'Institutional', amount: 2_702 },
] as const;
