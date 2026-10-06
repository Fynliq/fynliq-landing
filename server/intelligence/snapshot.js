// FYNLIQ Intelligence: the normalized company snapshot.
//
// Reads aggregate metrics for each comparison window and hands them to the
// deterministic engine (metrics.js). Two sources, chosen at run time:
//
//   'rpc'      public.intelligence_metrics (migration 202610060003): every
//              metric, exact windows, cohort-in-window conversions.
//   'fallback' the existing Command Center RPCs' per-day series
//              (beta_metrics, account_metrics, upload_metrics): visitors,
//              sign-ups and uploads only. Everything else is reported as
//              unavailable, never guessed.
//
// Only aggregate numbers leave this module. The fallback RPCs also return
// emails and ids; those are discarded here and never reach the snapshot.
import {
  buildWindows, buildComparisons, buildTodaySoFar, rankBiggestChanges, rankBottlenecks,
  dataQualityWarnings, COUNT_METRICS, RATE_METRICS, round,
} from './metrics.js';

export const CHANNELS = ['tiktok', 'instagram', 'facebook', 'google', 'referral', 'direct', 'other'];
const RPC_WINDOWS = ['current', 'previous', 'trailing7', 'trailing30', 'today', 'yesterday_same_time'];

const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
const isoOrNull = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

/** Keeps only the numeric fields the engine knows, plus channel counts for known channels. */
export function cleanWindowRow(row) {
  if (!row || typeof row !== 'object') return null;
  const fields = new Set([
    ...Object.values(COUNT_METRICS).map((d) => (Array.isArray(d.field) ? d.field[0] : d.field)),
    ...Object.values(RATE_METRICS).flatMap((d) => [d.num, d.den]),
    'expired_checkouts', 'checkout_sessions', 'paid_accounts', 'duplicate_payments', 'my_aid_accounts', 'unlock_click_accounts', 'logins', 'uploaders', 'askers',
  ]);
  const out = {};
  for (const f of fields) {
    if (f === 'visitors_by_channel') continue;
    if (f in row) out[f] = num(row[f]);
  }
  if (row.visitors_by_channel && typeof row.visitors_by_channel === 'object') {
    out.visitors_by_channel = Object.fromEntries(CHANNELS.map((c) => [c, num(row.visitors_by_channel[c]) ?? 0]));
  }
  if (row.uploads_by_outcome && typeof row.uploads_by_outcome === 'object') {
    const outcomes = ['read', 'no_aid_lines', 'unreadable', 'privacy_blocked', 'reader_error'];
    out.uploads_by_outcome = Object.fromEntries(outcomes.map((o) => [o, num(row.uploads_by_outcome[o]) ?? 0]));
  }
  return out;
}

function cleanHistory(h) {
  const keys = ['first_visitor_at', 'first_account_at', 'first_upload_at', 'first_attributed_at', 'first_funnel_event_at'];
  return Object.fromEntries(keys.map((k) => [k, isoOrNull(h?.[k])]));
}

// ------------------------------------------------------------------ sources

async function fromIntelligenceRpc(rpc, plan, testIds) {
  const p_windows = RPC_WINDOWS.map((key) => ({ key, start: plan.windows[key].start, end: plan.windows[key].end }));
  const data = await rpc('intelligence_metrics', { p_windows, p_test: [...testIds], p_livemode: true });
  if (!data || typeof data !== 'object' || !data.windows) throw new Error('intelligence_metrics returned no windows');
  const rows = Object.fromEntries(RPC_WINDOWS.map((k) => [k, cleanWindowRow(data.windows[k])]));
  return { dataSource: 'rpc', rows, history: cleanHistory(data.history) };
}

/** Sums a [{period:'YYYY-MM-DD', ...}] series over [start, end). */
export function sumDays(series, field, start, end) {
  if (!Array.isArray(series)) return null;
  const s = Date.parse(start); const e = Date.parse(end);
  let total = 0;
  for (const row of series) {
    const t = Date.parse(`${row?.period}T00:00:00Z`);
    if (Number.isNaN(t) || t < s || t >= e) continue;
    total += num(row[field]) ?? 0;
  }
  return total;
}

const firstDay = (series) => {
  if (!Array.isArray(series) || !series.length) return null;
  const days = series.map((r) => r?.period).filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p ?? '')).sort();
  return days.length ? `${days[0]}T00:00:00.000Z` : null;
};

async function fromExistingRpcs(rpc, plan) {
  const [beta, accounts, uploads] = await Promise.all([
    rpc('beta_metrics').catch(() => null),
    rpc('account_metrics').catch(() => null),
    rpc('upload_metrics').catch(() => null),
  ]);
  // Only the per-day series are read. Emails, ids and per-user rows are dropped here.
  const visitorsByDay = beta?.signups_by_day ?? null;
  const accountsByDay = accounts?.accounts_by_day ?? null;
  const uploadsByDay = uploads?.by_day ?? null;
  const row = (w) => {
    const up = sumDays(uploadsByDay, 'uploads', w.start, w.end);
    const read = sumDays(uploadsByDay, 'read_ok', w.start, w.end);
    return {
      new_visitors: sumDays(visitorsByDay, 'users', w.start, w.end),
      signups: sumDays(accountsByDay, 'accounts', w.start, w.end),
      uploads: up,
      uploads_read: read,
      uploads_failed: up === null || read === null ? null : up - read,
    };
  };
  const rows = Object.fromEntries(['current', 'previous', 'trailing7', 'trailing30'].map((k) => [k, row(plan.windows[k])]));
  // Day buckets can't express "yesterday up to the same time", so there is no today-so-far comparison.
  rows.today = null; rows.yesterday_same_time = null;
  const history = {
    first_visitor_at: firstDay(visitorsByDay), first_account_at: firstDay(accountsByDay),
    first_upload_at: firstDay(uploadsByDay), first_attributed_at: null, first_funnel_event_at: null,
  };
  return { dataSource: 'fallback', rows, history };
}

// ----------------------------------------------------------------- snapshot

/**
 * @param {object} o
 * @param {(name:string,args?:object)=>Promise<any>} o.rpc  service-role RPC caller
 * @param {Date} [o.now]
 * @param {'day'|'week'} [o.period]
 * @param {Set<string>|string[]} [o.testIds]  admin/test account ids to exclude
 * @param {{enabled:boolean,pilot:boolean}} [o.paywall]
 */
export async function buildSnapshot({ rpc, now = new Date(), period = 'day', testIds = [], paywall = null }) {
  const plan = buildWindows(now, period);
  let source;
  let fallbackReason = null;
  try {
    source = await fromIntelligenceRpc(rpc, plan, testIds);
  } catch (error) {
    fallbackReason = 'intelligence_metrics_unavailable';
    source = await fromExistingRpcs(rpc, plan);
  }
  const { rows, history, dataSource } = source;
  const comparisons = buildComparisons(rows, plan, history);
  const byKey = Object.fromEntries(comparisons.map((c) => [c.metric, c]));
  const value = (k) => byKey[k]?.current ?? null;
  const cur = rows.current ?? {};
  const bottlenecks = rankBottlenecks(comparisons);
  const biggestChanges = rankBiggestChanges(comparisons);
  const warnings = dataQualityWarnings({ comparisons, bottlenecks, dataSource, history, plan, paywall, biggestChanges });
  if (dataSource === 'fallback') warnings.push('In fallback mode, sign-ups include admin and test accounts.');

  const unavailable = comparisons.filter((c) => c.current === null).map((c) => ({ metric: c.metric, reason: 'not_collected_by_current_data_source' }));
  unavailable.unshift({ metric: 'sessions', reason: 'not_tracked' });

  return {
    version: 1,
    generatedAt: now.toISOString(),
    timezone: 'UTC',
    period: { type: plan.period, days: plan.days, start: plan.windows.current.start, end: plan.windows.current.end },
    dataSource,
    fallbackReason,
    traffic: { visitors: value('newVisitors'), sessions: null, returningUsers: value('returningAccounts') },
    funnel: {
      signups: value('signups'), uploads: value('uploads'), questions: value('questions'),
      paywallViewers: value('paywallViewers'), checkoutStarts: value('checkoutStarts'), payments: value('payments'),
    },
    revenue: {
      gross: value('revenueCents') === null ? null : round(value('revenueCents') / 100, 2),
      grossCents: value('revenueCents'), transactions: value('payments'), currency: 'usd', mode: 'live',
    },
    conversion: Object.fromEntries(Object.keys(RATE_METRICS).filter((k) => !['uploadReadRate', 'answerSuccessRate'].includes(k)).map((k) => [k, value(k)])),
    quality: {
      uploadsFailed: value('uploadsFailed'), uploadReadRate: value('uploadReadRate'),
      uploadsByOutcome: cur.uploads_by_outcome ?? null,
      questionsFailed: value('questionsFailed'), answerSuccessRate: value('answerSuccessRate'),
      failedPayments: value('failedPayments'), expiredCheckouts: cur.expired_checkouts ?? null,
    },
    acquisition: {
      attributedVisitors: value('attributedVisitors'),
      byChannel: cur.visitors_by_channel ?? null,
      attributionSince: history.first_attributed_at,
    },
    comparisons,
    todaySoFar: buildTodaySoFar(rows, plan),
    candidates: { biggestChanges, primaryBottleneck: bottlenecks.primary, bottlenecks: bottlenecks.ranked },
    unavailable,
    dataQualityWarnings: warnings,
    history,
  };
}
