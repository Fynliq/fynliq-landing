// FYNLIQ Intelligence: the deterministic metric engine.
//
// Every number the CEO brief shows is computed here, in code, never by the
// model: time windows, rates, percentage changes, per-day normalisation,
// sample-size reliability and the ranked candidates for "biggest change" and
// "primary bottleneck". Pure functions, no I/O, no dependencies.

export const DAY_MS = 86_400_000;

/** Rate denominators below these are flagged. */
export const VERY_SMALL_SAMPLE = 10;
export const SMALL_SAMPLE = 30;
/** A step needs at least this many people entering it to be called a bottleneck. */
export const MIN_BOTTLENECK_DENOMINATOR = 5;
/** Relative decline (vs baseline) that marks a funnel step as deteriorating. */
export const DETERIORATION_THRESHOLD = 0.15;

/**
 * Metric catalog. `since` names the history marker after which the metric is
 * recorded at all; a window that starts before it is incomplete and is never
 * compared (so "tracking started" can't look like growth).
 */
export const COUNT_METRICS = {
  newVisitors: { label: 'New visitors (new browsers)', field: 'new_visitors', since: 'first_visitor_at', group: 'traffic' },
  returningAccounts: { label: 'Returning accounts', field: 'returning_accounts', since: 'first_account_at', group: 'traffic' },
  attributedVisitors: { label: 'Visitors with a known source', field: 'attributed_visitors', since: 'first_attributed_at', group: 'acquisition' },
  tiktokVisitors: { label: 'TikTok visitors', field: ['visitors_by_channel', 'tiktok'], since: 'first_attributed_at', group: 'acquisition' },
  signups: { label: 'Account sign-ups', field: 'signups', since: 'first_account_at', group: 'funnel' },
  uploads: { label: 'Aid upload batches', field: 'uploads', since: 'first_upload_at', group: 'funnel' },
  uploadsFailed: { label: 'Failed uploads', field: 'uploads_failed', since: 'first_upload_at', group: 'quality', lowerIsBetter: true },
  questions: { label: 'Ask FYNLIQ questions', field: 'questions', since: 'first_visitor_at', group: 'funnel' },
  questionsFailed: { label: 'Failed Ask answers', field: 'questions_failed', since: 'first_visitor_at', group: 'quality', lowerIsBetter: true },
  paywallViewers: { label: 'Accounts that saw the $1 unlock', field: 'preview_accounts', since: 'first_funnel_event_at', group: 'funnel' },
  checkoutStarts: { label: 'Checkout starts (accounts)', field: 'checkout_accounts', since: 'first_funnel_event_at', group: 'funnel' },
  payments: { label: 'Payments (live)', field: 'payments', since: 'first_funnel_event_at', group: 'revenue' },
  revenueCents: { label: 'Gross revenue (cents, live)', field: 'revenue_cents', since: 'first_funnel_event_at', group: 'revenue' },
  failedPayments: { label: 'Failed payments', field: 'failed_payments', since: 'first_funnel_event_at', group: 'quality', lowerIsBetter: true },
};

export const RATE_METRICS = {
  visitorToSignup: { label: 'Visitor → Signup', num: 'new_visitors_signed_up', den: 'new_visitors', since: 'first_account_at', stage: true },
  signupToUpload: { label: 'Signup → Upload', num: 'signups_uploaded', den: 'signups', since: 'first_upload_at', stage: true },
  uploadToCheckout: { label: 'Upload → Checkout', num: 'upload_then_checkout_accounts', den: 'eligible_upload_accounts', since: 'first_funnel_event_at', stage: true },
  checkoutToPayment: { label: 'Checkout → Payment', num: 'checkout_then_paid_accounts', den: 'checkout_accounts', since: 'first_funnel_event_at', stage: true },
  visitorToPayment: { label: 'Visitor → Payment', num: 'new_visitors_paid', den: 'new_visitors', since: 'first_funnel_event_at' },
  uploadReadRate: { label: 'Uploads read successfully', num: 'uploads_read', den: 'uploads', since: 'first_upload_at' },
  answerSuccessRate: { label: 'Ask answers succeeded', num: 'questions_answered', den: 'questions', since: 'first_visitor_at' },
};

export const METRIC_KEYS = [...Object.keys(COUNT_METRICS), ...Object.keys(RATE_METRICS)];
export const STAGES = Object.keys(RATE_METRICS).filter((k) => RATE_METRICS[k].stage);
export const metricLabel = (key) => (COUNT_METRICS[key] ?? RATE_METRICS[key])?.label ?? key;

// ------------------------------------------------------------------ helpers

/** Rounds to `dp` decimals; null for anything that isn't a finite number. */
export function round(value, dp = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const f = 10 ** dp;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/** numerator ÷ denominator, or null when the denominator is 0 or either side is missing. */
export function safeRate(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return round(numerator / denominator, 4);
}

/**
 * Percentage change from base to current. Never Infinity/NaN:
 *   both 0          -> 0 (flat)
 *   base 0, cur > 0 -> null, direction 'up', reason 'base_zero'
 */
export function percentChange(current, base) {
  if (!Number.isFinite(current) || !Number.isFinite(base)) return { changePercent: null, direction: null, reason: 'missing' };
  if (base === 0 && current === 0) return { changePercent: 0, direction: 'flat', reason: null };
  if (base === 0) return { changePercent: null, direction: current > 0 ? 'up' : 'down', reason: 'base_zero' };
  const change = round(((current - base) / Math.abs(base)) * 100, 1);
  return { changePercent: change, direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat', reason: null };
}

/** Reliability of a rate from its denominator, or of a count change from its two sides. */
export function reliabilityOf(n) {
  if (!Number.isFinite(n)) return 'unavailable';
  if (n < VERY_SMALL_SAMPLE) return 'very_small';
  if (n < SMALL_SAMPLE) return 'small';
  return 'ok';
}

const get = (row, field) => {
  if (!row) return null;
  if (Array.isArray(field)) {
    const [obj, key] = field;
    const container = row[obj];
    if (!container || typeof container !== 'object') return null;
    const v = container[key];
    return Number.isFinite(Number(v)) ? Number(v) : 0; // channel absent from the object => 0 visitors
  }
  const v = row[field];
  return v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null;
};

// ------------------------------------------------------------------ windows

export function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * The comparison windows, all [start, end) in UTC.
 * period 'day'  -> current = the last complete UTC day
 * period 'week' -> current = the last 7 complete UTC days
 */
export function buildWindows(now = new Date(), period = 'day') {
  const days = period === 'week' ? 7 : 1;
  const end = startOfUtcDay(now);
  const start = new Date(end.getTime() - days * DAY_MS);
  const iso = (d) => d.toISOString();
  const at = (ms) => new Date(ms);
  return {
    period: period === 'week' ? 'week' : 'day',
    days,
    windows: {
      current: { start: iso(start), end: iso(end), days },
      previous: { start: iso(at(start.getTime() - days * DAY_MS)), end: iso(start), days },
      trailing7: { start: iso(at(start.getTime() - 7 * DAY_MS)), end: iso(start), days: 7 },
      trailing30: { start: iso(at(start.getTime() - 30 * DAY_MS)), end: iso(start), days: 30 },
      today: { start: iso(end), end: iso(now), days: (now.getTime() - end.getTime()) / DAY_MS, partial: true },
      yesterday_same_time: { start: iso(at(end.getTime() - DAY_MS)), end: iso(at(now.getTime() - DAY_MS)), days: (now.getTime() - end.getTime()) / DAY_MS, partial: true },
    },
  };
}

/** Whether a metric was being recorded for the whole of a window. */
export function coveredBy(window, metricSince, history) {
  const since = history?.[metricSince];
  if (!since) return false; // never recorded at all
  return Date.parse(since) <= Date.parse(window.start);
}

// --------------------------------------------------------------- comparisons

function countComparison(key, def, rows, plan, history) {
  const cur = rows.current;
  const current = get(cur, def.field);
  const entry = {
    metric: key, kind: 'count', label: def.label, current, lowerIsBetter: Boolean(def.lowerIsBetter),
    sampleSize: current, reliability: current === null ? 'unavailable' : reliabilityOf(current), notes: [],
    previous: null, trailing7: null, trailing30: null,
  };
  if (current === null) { entry.notes.push('not_collected'); return entry; }
  if (!coveredBy(plan.windows.current, def.since, history)) entry.notes.push('tracking_started_during_period');

  for (const [name, w] of [['previous', plan.windows.previous], ['trailing7', plan.windows.trailing7], ['trailing30', plan.windows.trailing30]]) {
    const raw = get(rows[name], def.field);
    if (raw === null || !rows[name]) { entry[name] = null; continue; }
    if (!coveredBy(w, def.since, history)) { entry[name] = { value: null, changePercent: null, direction: null, reason: 'insufficient_history' }; continue; }
    // Normalise trailing totals to the current period's length (per-day average x period days).
    const value = name === 'previous' ? raw : round((raw / w.days) * plan.days, 2);
    const change = percentChange(current, value);
    const lowVolume = Math.max(current, value) < VERY_SMALL_SAMPLE;
    entry[name] = { value, ...change, reason: change.reason ?? (lowVolume ? 'low_volume' : null) };
  }
  return entry;
}

function rateComparison(key, def, rows, plan, history) {
  const num = get(rows.current, def.num);
  const den = get(rows.current, def.den);
  const current = num === null || den === null ? null : safeRate(num, den);
  const entry = {
    metric: key, kind: 'rate', label: def.label, current, numerator: num, denominator: den,
    sampleSize: den, reliability: den === null ? 'unavailable' : reliabilityOf(den), notes: [],
    previous: null, trailing7: null, trailing30: null,
  };
  if (num === null || den === null) { entry.notes.push('not_collected'); return entry; }
  if (den === 0) entry.notes.push('no_one_entered_this_step');
  if (!coveredBy(plan.windows.current, def.since, history)) entry.notes.push('tracking_started_during_period');

  for (const [name, w] of [['previous', plan.windows.previous], ['trailing7', plan.windows.trailing7], ['trailing30', plan.windows.trailing30]]) {
    const n = get(rows[name], def.num); const d = get(rows[name], def.den);
    if (n === null || d === null || !rows[name]) { entry[name] = null; continue; }
    if (!coveredBy(w, def.since, history)) { entry[name] = { value: null, changePercent: null, direction: null, sampleSize: d, reason: 'insufficient_history' }; continue; }
    const value = safeRate(n, d); // pooled over the window, never an average of daily rates
    // Conversions are cohort-in-window: a longer window gives people more time
    // to reach the next step, so its rate is structurally higher. Only a window
    // of the same length is a fair comparison; longer ones are context only.
    if (w.days !== plan.days) {
      entry[name] = { value, numerator: n, sampleSize: d, changePercent: null, direction: null, reason: 'different_window_length' };
      continue;
    }
    const change = current === null || value === null ? { changePercent: null, direction: null, reason: 'no_denominator' } : percentChange(current, value);
    entry[name] = { value, numerator: n, sampleSize: d, ...change, reason: change.reason ?? (reliabilityOf(Math.min(d, den)) !== 'ok' ? 'small_sample' : null) };
  }
  return entry;
}

export function buildComparisons(rows, plan, history) {
  const counts = Object.entries(COUNT_METRICS).map(([k, d]) => countComparison(k, d, rows, plan, history));
  const rates = Object.entries(RATE_METRICS).map(([k, d]) => rateComparison(k, d, rows, plan, history));
  return [...counts, ...rates];
}

/** Today so far vs yesterday up to the same clock time. Counts only. */
export function buildTodaySoFar(rows, plan) {
  if (!rows.today || !rows.yesterday_same_time) return null;
  const metrics = Object.entries(COUNT_METRICS).map(([key, def]) => {
    const today = get(rows.today, def.field); const yesterday = get(rows.yesterday_same_time, def.field);
    if (today === null || yesterday === null) return null;
    const change = percentChange(today, yesterday);
    return { metric: key, today, yesterdaySameTime: yesterday, ...change };
  }).filter(Boolean);
  return { asOf: plan.windows.today.end, since: plan.windows.today.start, partial: true, metrics };
}

// ---------------------------------------------------------------- candidates

/**
 * Biggest changes vs the previous equivalent period. Reliable movements
 * (both sides >= VERY_SMALL_SAMPLE) rank ahead of low-volume ones; base-zero
 * changes (no percentage) are left out. Deterministic order.
 */
export function rankBiggestChanges(comparisons, limit = 5) {
  const rows = comparisons
    .filter((c) => c.previous && Number.isFinite(c.previous.changePercent) && c.previous.changePercent !== 0 && c.previous.reason !== 'insufficient_history')
    .map((c) => {
      // A rate move needs enough people in the step AND enough events: 2 payments vs 2 is noise even out of 60 visitors.
      const lowSample = c.kind === 'count'
        ? Math.max(c.current, c.previous.value) < VERY_SMALL_SAMPLE
        : reliabilityOf(Math.min(c.denominator ?? 0, c.previous.sampleSize ?? 0)) === 'very_small'
          || Math.max(c.numerator ?? 0, c.previous.numerator ?? 0) < VERY_SMALL_SAMPLE;
      return {
        metric: c.metric, label: c.label, kind: c.kind, lowerIsBetter: Boolean(c.lowerIsBetter), current: c.current, base: c.previous.value,
        changePercent: c.previous.changePercent, magnitude: Math.abs(c.previous.changePercent),
        direction: c.previous.direction, reliability: lowSample ? 'low_sample' : 'ok',
      };
    });
  rows.sort((a, b) => (a.reliability === b.reliability ? 0 : a.reliability === 'ok' ? -1 : 1)
    || b.magnitude - a.magnitude || a.metric.localeCompare(b.metric));
  return rows.slice(0, limit);
}

/**
 * Funnel steps ranked as bottleneck candidates.
 *   1. Steps whose rate fell by >= DETERIORATION_THRESHOLD vs the baseline
 *      (the most recent like-for-like window: trailing 7 days when it is the
 *      same length as the period, else the previous period), largest drop first.
 *      A longer window is never a baseline: its cohort had more time to convert.
 *   2. Then the remaining eligible steps by people lost at the step
 *      (denominator - numerator), most first.
 * A step is eligible only with denominator >= MIN_BOTTLENECK_DENOMINATOR, and a
 * baseline counts only with the same minimum: "1 of 2 yesterday" is noise, not
 * a rate a step can fall from.
 */
export function rankBottlenecks(comparisons) {
  const steps = comparisons.filter((c) => c.kind === 'rate' && RATE_METRICS[c.metric]?.stage);
  const candidates = steps.map((c) => {
    const baseline = [c.trailing7, c.previous].find((b) => b && Number.isFinite(b.value) && b.reason !== 'different_window_length'
      && Number.isFinite(b.sampleSize) && b.sampleSize >= MIN_BOTTLENECK_DENOMINATOR) ?? null;
    const eligible = Number.isFinite(c.denominator) && c.denominator >= MIN_BOTTLENECK_DENOMINATOR && c.current !== null;
    const relativeDrop = eligible && baseline && baseline.value > 0 ? round((baseline.value - c.current) / baseline.value, 4) : null;
    const deteriorating = relativeDrop !== null && relativeDrop >= DETERIORATION_THRESHOLD;
    return {
      stage: c.metric, label: c.label, rate: c.current, numerator: c.numerator, denominator: c.denominator,
      lost: eligible ? c.denominator - c.numerator : null,
      baselineRate: baseline?.value ?? null, baselineWindow: baseline === c.trailing7 && baseline ? 'trailing7' : baseline ? 'previous' : null,
      changePercent: baseline?.changePercent ?? null, reliability: c.reliability,
      baselineSampleSize: baseline?.sampleSize ?? null, baselineReliability: baseline ? reliabilityOf(baseline.sampleSize) : null,
      relativeDrop, eligible, deteriorating,
      reason: !eligible ? (c.denominator ? `fewer than ${MIN_BOTTLENECK_DENOMINATOR} entered this step` : 'no one entered this step')
        : deteriorating ? 'rate fell vs baseline' : 'most people lost at this step',
    };
  });
  const eligible = candidates.filter((c) => c.eligible);
  eligible.sort((a, b) => Number(b.deteriorating) - Number(a.deteriorating)
    || (a.deteriorating ? b.relativeDrop - a.relativeDrop : 0)
    || b.lost - a.lost
    || STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage));
  return { primary: eligible[0]?.stage ?? 'insufficient_data', ranked: [...eligible, ...candidates.filter((c) => !c.eligible)] };
}

// ------------------------------------------------------------ data quality

/** A reliable move at least this large (in %) is called out as a possible anomaly. */
export const ANOMALY_CHANGE_PERCENT = 300;

export function dataQualityWarnings({ comparisons, bottlenecks, dataSource, history, plan, paywall, biggestChanges = [] }) {
  const w = [];
  for (const c of biggestChanges) {
    if (c.reliability === 'ok' && c.magnitude >= ANOMALY_CHANGE_PERCENT) {
      w.push(`Possible anomaly: ${c.label} moved ${c.changePercent}% vs the previous period. Rule out bots, tracking errors or test traffic before acting on it.`);
    }
  }
  if (dataSource === 'fallback') w.push('The full metrics function (intelligence_metrics) could not be read: either its migration is not applied yet, or the database call failed (see the fynliq_intelligence log line). Only visitors, sign-ups and uploads are available; Ask, paywall, checkout and payment comparisons are missing.');
  w.push('Visitors are new browsers (guest cookies), not people. Sessions are not tracked.');
  const stages = comparisons.filter((c) => c.kind === 'rate' && RATE_METRICS[c.metric]?.stage && Number.isFinite(c.denominator));
  const thin = stages.filter((c) => c.denominator > 0 && c.reliability !== 'ok');
  const empty = stages.filter((c) => c.denominator === 0);
  if (thin.length) w.push(`Small samples: ${thin.map((c) => `${c.label} (n=${c.denominator})`).join(', ')}. Treat rate changes as directional only.`);
  if (empty.length) w.push(`No one entered: ${empty.map((c) => c.label).join(', ')} in this period.`);
  if (bottlenecks.primary === 'insufficient_data') w.push(`No funnel step had at least ${MIN_BOTTLENECK_DENOMINATOR} people entering it in this period, so no bottleneck can be identified from evidence.`);
  if (dataSource !== 'fallback') {
    if (!history?.first_attributed_at) w.push('Traffic source attribution has no data yet.');
    else if (Date.parse(history.first_attributed_at) > Date.parse(plan.windows.trailing30.start)) w.push(`Traffic source attribution only exists since ${history.first_attributed_at.slice(0, 10)}. Earlier visitors are "legacy" (unknown source).`);
  }
  if (paywall && paywall.enabled === false) w.push('The paywall is off, so checkout and payment numbers are expected to be near zero.');
  if (paywall?.pilot) w.push('The paywall is in pilot mode (PAYWALL_PILOT_EMAILS), so the checkout funnel covers pilot accounts only.');
  w.push('Paywall funnel events are recorded only for paywall-eligible (post-cutoff) accounts. Grandfathered users are not in Upload → Checkout.');
  const noTrailing30 = comparisons.every((c) => !c.trailing30 || c.trailing30.reason === 'insufficient_history');
  if (noTrailing30) w.push('Less than 30 days of history: no 30-day baseline.');
  return w;
}
