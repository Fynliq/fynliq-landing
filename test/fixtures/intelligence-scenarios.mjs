// FYNLIQ Analyst v1 eval scenarios. Synthetic aggregate data only.
//
// Each scenario is what public.intelligence_metrics would return for the
// six comparison windows, plus what a correct brief must do. Used by:
//   test/intelligence-evals.test.mjs   deterministic checks (always, in CI)
//   test/intelligence-live-evals.mjs   the real model (manual, needs a key)
//
// Fixed clock: 2026-10-06T15:00Z, period 'day' -> current = 2026-10-05.

export const NOW = new Date('2026-10-06T15:00:00Z');

const ZERO = {
  new_visitors: 0, new_visitors_signed_up: 0, new_visitors_paid: 0, returning_accounts: 0,
  attributed_visitors: 0, visitors_by_channel: {}, signups: 0, signups_uploaded: 0, logins: 0,
  uploads: 0, uploads_read: 0, uploads_failed: 0, uploads_by_outcome: {}, uploaders: 0,
  questions: 0, questions_answered: 0, questions_failed: 0, askers: 0,
  my_aid_accounts: 0, eligible_upload_accounts: 0, preview_accounts: 0, unlock_click_accounts: 0,
  checkout_accounts: 0, checkout_sessions: 0, upload_then_checkout_accounts: 0, checkout_then_paid_accounts: 0,
  payments: 0, paid_accounts: 0, revenue_cents: 0, duplicate_payments: 0, failed_payments: 0, expired_checkouts: 0,
};
export const row = (over = {}) => ({ ...ZERO, ...over });

/** Long history: every metric recorded since well before the 30-day baseline. */
export const LONG_HISTORY = {
  first_visitor_at: '2026-07-01T00:00:00Z', first_account_at: '2026-07-01T00:00:00Z', first_upload_at: '2026-07-01T00:00:00Z',
  first_attributed_at: '2026-07-01T00:00:00Z', first_funnel_event_at: '2026-07-01T00:00:00Z',
};

/** A "normal" day used as the baseline in several scenarios (trailing windows are N x this). */
const normal = {
  new_visitors: 120, new_visitors_signed_up: 12, new_visitors_paid: 2, returning_accounts: 10, attributed_visitors: 60,
  visitors_by_channel: { tiktok: 40, google: 10, direct: 10 }, signups: 20, signups_uploaded: 12, uploads: 22, uploads_read: 19,
  uploads_failed: 3, questions: 15, questions_answered: 14, questions_failed: 1, eligible_upload_accounts: 25, preview_accounts: 24,
  checkout_accounts: 20, upload_then_checkout_accounts: 10, checkout_then_paid_accounts: 12, payments: 12, paid_accounts: 12, revenue_cents: 1200,
};
const times = (r, n) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' ? v * n : Object.fromEntries(Object.entries(v).map(([c, x]) => [c, x * n]))]));
const baseline = (cur, prev = normal) => ({ current: row(cur), previous: row(prev), trailing7: row(times(normal, 7)), trailing30: row(times(normal, 30)), today: row(), yesterday_same_time: row() });

export const SCENARIOS = [
  {
    id: 'traffic_up_signup_down',
    title: 'Traffic rises but signup conversion falls',
    data: { history: LONG_HISTORY, windows: baseline({ ...normal, new_visitors: 200, new_visitors_signed_up: 4, signups: 6, signups_uploaded: 4 }) },
    expect: { bottleneck: 'visitorToSignup', smallSampleWarning: true },
  },
  {
    id: 'signups_up_uploads_up',
    title: 'Signups rise and uploads rise',
    data: { history: LONG_HISTORY, windows: baseline({ ...normal, signups: 40, signups_uploaded: 30, uploads: 45, uploads_read: 41, uploads_failed: 4, new_visitors_signed_up: 30, new_visitors: 150 }) },
    expect: { bottleneck: 'visitorToSignup', biggestChangeIn: ['signups', 'uploads', 'signupToUpload', 'visitorToSignup', 'newVisitors', 'uploadsFailed', 'tiktokVisitors', 'attributedVisitors'] },
  },
  {
    id: 'uploads_up_checkout_collapse',
    title: 'Uploads rise but checkout starts collapse',
    data: { history: LONG_HISTORY, windows: baseline({ ...normal, uploads: 45, eligible_upload_accounts: 40, upload_then_checkout_accounts: 4, checkout_accounts: 5, checkout_then_paid_accounts: 3, payments: 3, paid_accounts: 3, revenue_cents: 300 }) },
    expect: { bottleneck: 'uploadToCheckout' },
  },
  {
    id: 'checkout_up_payments_fall',
    title: 'Checkout starts rise but payments fall',
    data: { history: LONG_HISTORY, windows: baseline({ ...normal, checkout_accounts: 30, upload_then_checkout_accounts: 18, checkout_then_paid_accounts: 6, payments: 6, paid_accounts: 6, revenue_cents: 600 }) },
    expect: { bottleneck: 'checkoutToPayment' },
  },
  {
    id: 'everything_improves',
    title: 'Everything improves',
    data: { history: LONG_HISTORY, windows: baseline({ ...normal, new_visitors: 150, new_visitors_signed_up: 20, signups: 28, signups_uploaded: 20, uploads: 30, uploads_read: 28, uploads_failed: 2, eligible_upload_accounts: 30, upload_then_checkout_accounts: 16, checkout_accounts: 24, checkout_then_paid_accounts: 18, payments: 18, paid_accounts: 18, revenue_cents: 1800, new_visitors_paid: 4 }) },
    // No step deteriorated, so the bottleneck is where the most people are lost.
    expect: { bottleneck: 'visitorToSignup', noDeteriorating: true },
  },
  {
    id: 'traffic_falls_conversion_improves',
    title: 'Traffic falls but conversion improves',
    data: { history: LONG_HISTORY, windows: baseline({ ...normal, new_visitors: 60, new_visitors_signed_up: 9, signups: 12, signups_uploaded: 9, visitors_by_channel: { tiktok: 15, google: 5, direct: 10 }, attributed_visitors: 30 }) },
    expect: { bottleneck: 'visitorToSignup', biggestChangeIn: ['newVisitors', 'tiktokVisitors', 'attributedVisitors', 'visitorToSignup', 'signupToUpload', 'signups'] },
  },
  {
    id: 'very_small_sample',
    title: 'Very small sample size',
    data: { history: LONG_HISTORY, windows: baseline(
      { new_visitors: 4, new_visitors_signed_up: 1, signups: 2, signups_uploaded: 1, uploads: 1, uploads_read: 1, eligible_upload_accounts: 1, checkout_accounts: 1, upload_then_checkout_accounts: 1, checkout_then_paid_accounts: 1, payments: 1, paid_accounts: 1, revenue_cents: 100 },
      { new_visitors: 3, new_visitors_signed_up: 1, signups: 1, signups_uploaded: 0, uploads: 0 }) },
    expect: { bottleneck: 'insufficient_data', smallSampleWarning: true, noHighConfidence: true },
  },
  {
    id: 'missing_payment_data',
    title: 'Missing payment data (migration not applied: fallback to existing RPCs)',
    fallback: {
      beta_metrics: { signups_by_day: [{ period: '2026-10-04', users: 110 }, { period: '2026-10-05', users: 130 }], users: [{ user_id: '00000000-0000-4000-8000-000000000001' }] },
      account_metrics: { accounts_by_day: [{ period: '2026-10-04', accounts: 9 }, { period: '2026-10-05', accounts: 11 }], accounts: [{ email: 'student@example.test' }] },
      upload_metrics: { by_day: [{ period: '2026-10-04', uploads: 8, read_ok: 7 }, { period: '2026-10-05', uploads: 10, read_ok: 8 }], recent: [{ email: 'student@example.test' }] },
    },
    expect: { dataSource: 'fallback', unavailable: ['payments', 'checkoutToPayment', 'revenueCents'], bottleneck: 'insufficient_data' },
  },
  {
    id: 'zero_visitors',
    title: 'Zero visitors',
    data: { history: LONG_HISTORY, windows: { current: row(), previous: row(), trailing7: row(), trailing30: row(), today: row(), yesterday_same_time: row() } },
    expect: { bottleneck: 'insufficient_data', allRatesNull: true },
  },
  {
    id: 'extreme_anomaly',
    title: 'Extreme metric anomaly',
    data: { history: LONG_HISTORY, windows: baseline({ ...normal, new_visitors: 6000, attributed_visitors: 60, new_visitors_signed_up: 13, visitors_by_channel: { tiktok: 40, google: 10, direct: 10 } }) },
    expect: { bottleneck: 'visitorToSignup', biggestChange: 'newVisitors', anomalyWarning: true },
  },
];

/** A fake service-role rpc() serving one scenario. */
export function scenarioRpc(scenario) {
  return async (name) => {
    if (name === 'intelligence_metrics') {
      if (scenario.fallback) throw new Error('function public.intelligence_metrics does not exist');
      return JSON.parse(JSON.stringify(scenario.data));
    }
    if (scenario.fallback?.[name]) return JSON.parse(JSON.stringify(scenario.fallback[name]));
    throw new Error(`unexpected rpc ${name}`);
  };
}
