// FYNLIQ Intelligence routes, served by the existing admin function
// (api/beta-admin.js) so no new Vercel function is needed. The caller has
// already verified an admin session; this module adds the rest.
//
//   GET  /api/beta-admin?view=intelligence-snapshot[&period=day|week]
//        Deterministic snapshot. No model call.
//   POST /api/beta-admin  {"action":"intelligence-brief","period":"day"|"week"}
//        Same-origin + DB rate limit + INTELLIGENCE_ENABLED=true. Runs
//        FynliqAnalyst and returns a validated brief or a controlled error.
//
// Helpers that need Supabase (rpc, sameOrigin, body, rate) are injected so
// this file has no SDK dependency and is unit-testable.
import { buildSnapshot } from './snapshot.js';
import { runAnalyst, AnalystError } from './analyst.js';
import { createProvider, ProviderError } from './providers.js';
import { createLogger, newRequestId } from './observability.js';

export const SNAPSHOT_VIEW = 'intelligence-snapshot';
export const BRIEF_ACTION = 'intelligence-brief';
const PERIODS = ['day', 'week'];

export function queryParam(req, name) {
  if (req.query && typeof req.query[name] === 'string') return req.query[name];
  try { return new URL(req.url || '/', 'http://localhost').searchParams.get(name); } catch { return null; }
}

/** True when this request is for the intelligence routes. */
export function isIntelligenceRequest(req) {
  return (req.method === 'GET' && queryParam(req, 'view') === SNAPSHOT_VIEW) || req.method === 'POST';
}

/**
 * @param {object} req
 * @param {object} res
 * @param {object} ctx
 * @param {object} ctx.env
 * @param {(name:string,args?:object)=>Promise<any>} ctx.rpc
 * @param {{sameOrigin:Function, body:Function, rate:Function, BetaError:Function}} ctx.helpers
 * @param {Set<string>} ctx.testIds
 * @param {{enabled:boolean,pilot:boolean}} ctx.paywall
 * @param {Function} [ctx.providerFactory]  (env) => AIProvider
 * @param {Function} [ctx.log]
 * @param {() => Date} [ctx.clock]
 */
export async function handleIntelligence(req, res, ctx) {
  const { env, rpc, helpers, testIds, paywall } = ctx;
  const clock = ctx.clock ?? (() => new Date());
  const log = ctx.log ?? createLogger();

  if (req.method === 'GET') {
    const period = queryParam(req, 'period') ?? 'day';
    if (!PERIODS.includes(period)) throw new helpers.BetaError(400, 'Unknown period.');
    const snapshot = await buildSnapshot({ rpc, now: clock(), period, testIds, paywall });
    return res.json({ snapshot });
  }

  // POST: generating a brief costs money, so it is same-origin, rate limited and opt-in.
  helpers.sameOrigin(req, env);
  const input = helpers.body(req, 2000);
  if (input?.action !== BRIEF_ACTION) throw new helpers.BetaError(400, 'Unknown request.');
  const period = input.period ?? 'day';
  if (!PERIODS.includes(period)) throw new helpers.BetaError(400, 'Unknown period.');
  if (env.INTELLIGENCE_ENABLED !== 'true') return res.status(503).json({ error: 'intelligence_disabled', message: 'FYNLIQ Intelligence is not enabled. Set INTELLIGENCE_ENABLED=true on the server.' });
  await helpers.rate(req, 'intelligence', 5);

  let provider;
  try {
    provider = (ctx.providerFactory ?? createProvider)(env);
  } catch (error) {
    const code = error instanceof ProviderError ? error.code : 'not_configured';
    return res.status(503).json({ error: 'intelligence_not_configured', code, message: 'The AI provider is not configured on the server.' });
  }

  const requestId = newRequestId();
  const snapshot = await buildSnapshot({ rpc, now: clock(), period, testIds, paywall });
  try {
    const result = await runAnalyst({ snapshot, provider, log, env, requestId });
    return res.json({ ...result, snapshot });
  } catch (error) {
    if (error instanceof AnalystError) {
      return res.status(502).json({ error: 'brief_unavailable', code: error.code, requestId: error.requestId, message: 'The brief could not be produced with validated output. The metrics above are unaffected.', snapshot });
    }
    throw error;
  }
}
