#!/usr/bin/env node
// Synthetic uptime checks for www.fynliq.com.
//
// What the probes prove: the site is served, and each serverless function is
// deployed and answers the way it should for an anonymous visitor. Several
// routes also fail closed with 503 when the server configuration is missing
// (guest session, account session, log-in), so those catch a broken env.
// Billing and the reader only check configuration in some paywall modes.
//
// Read-only and anonymous: every probe is a GET without cookies, so nothing
// is written to the database, no session is created, and Stripe and OpenAI
// are never called. The probes don't prove the database is healthy, because
// anonymous requests stop before any query; server error tracking (phase 2,
// PR B) covers that.
//
//   node scripts/uptime-check.mjs                    # checks https://www.fynliq.com
//   UPTIME_BASE_URL=https://example.test node scripts/uptime-check.mjs
//
// Exit code 1 if any check fails after one retry. A Vercel bot challenge
// (403 + x-vercel-mitigated: challenge) is reported as inconclusive, not as
// down, so rate limiting doesn't page anyone; if every check is challenged,
// the run fails, because then nothing was actually verified.

import { pathToFileURL } from 'node:url';

const BASE = (process.env.UPTIME_BASE_URL || 'https://www.fynliq.com').replace(/\/+$/, '');
const TIMEOUT_MS = 10000;
const RETRY_DELAY_MS = Number(process.env.UPTIME_RETRY_DELAY_MS ?? 20000);

const isJson = (text) => { try { JSON.parse(text); return true; } catch { return false; } };

/** Each check: path, and a function deciding health from status + body. */
export const CHECKS = [
  {
    name: 'Site loads (landing page + app bundle)',
    path: '/',
    healthy: (status, body) => status === 200 && /assets\/index-[A-Za-z0-9_-]+\.js/.test(body),
  },
  {
    name: 'Guest session API configured',
    path: '/api/beta-auth',
    // Anonymous GET answers {"user":null,"admin":false}; 503 means config is missing.
    healthy: (status, body) => status === 200 && isJson(body) && 'user' in JSON.parse(body),
  },
  {
    name: 'Account session API configured',
    path: '/api/auth/session',
    // No cookie: 401 "Not logged in." after the config gate; 503 = config missing.
    healthy: (status) => status === 401,
  },
  {
    name: 'Log-in API configured',
    path: '/api/auth/login',
    // GET is refused (405) after the same config gate; 503 = config missing.
    healthy: (status) => status === 405,
  },
  {
    name: 'Billing function answers',
    path: '/api/billing',
    // 200 JSON when the paywall is off or open; 401 when it needs a login.
    healthy: (status, body) => (status === 200 && isJson(body)) || status === 401,
  },
  {
    name: 'Document reader function answers',
    path: '/api/analyze',
    // Anonymous GET: 404 {"error":"none"} (no saved analysis), or 401 when the
    // paywall needs a log-in. A plain-text 404 is Vercel's NOT_FOUND for a
    // missing function, so the JSON body is required. 503 = reader not configured.
    healthy: (status, body) => (status === 404 && isJson(body) && JSON.parse(body)?.error === 'none') || status === 401,
  },
  {
    name: 'Stripe webhook deployed',
    path: '/api/stripe-webhook',
    // GET is refused by design; any 5xx or 404 means the function is missing or broken.
    healthy: (status) => status === 405,
  },
];

async function probe(check, fetchImpl) {
  const started = Date.now();
  try {
    const res = await fetchImpl(`${BASE}${check.path}`, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': 'fynq-uptime-check/1 (+github-actions)', Accept: '*/*' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await res.text();
    const ms = Date.now() - started;
    if (res.status === 403 && /challenge/i.test(res.headers.get('x-vercel-mitigated') || '')) {
      return { state: 'inconclusive', status: res.status, ms, note: 'Vercel bot challenge' };
    }
    return check.healthy(res.status, body)
      ? { state: 'up', status: res.status, ms }
      : { state: 'down', status: res.status, ms, note: 'unexpected response' };
  } catch (error) {
    return { state: 'down', status: 0, ms: Date.now() - started, note: error?.name === 'TimeoutError' ? 'timeout' : (error?.name || 'network error') };
  }
}

export async function runChecks({ fetchImpl = fetch, retryDelayMs = RETRY_DELAY_MS, log = console.log } = {}) {
  // Probes run in parallel so a hanging site can't exceed the job time limit:
  // worst case is one timeout + retry delay + one timeout (about 40 s).
  const results = await Promise.all(CHECKS.map(async (check) => {
    let result = await probe(check, fetchImpl);
    if (result.state === 'down') {
      await new Promise((r) => setTimeout(r, retryDelayMs));
      result = await probe(check, fetchImpl);
      result.retried = true;
    }
    return { check, result };
  }));
  const down = results.filter((r) => r.result.state === 'down');
  const inconclusive = results.filter((r) => r.result.state === 'inconclusive');
  const allChallenged = inconclusive.length === results.length;

  const lines = [`## FYNQ uptime — ${BASE}`, '', '| Check | Result | HTTP | Time |', '| --- | --- | --- | --- |'];
  for (const { check, result } of results) {
    const icon = result.state === 'up' ? '✅ up' : result.state === 'down' ? '❌ DOWN' : '⚠️ inconclusive';
    const note = result.note ? ` (${result.note})` : '';
    lines.push(`| ${check.name} \`${check.path}\` | ${icon}${result.retried ? ' (after retry)' : ''}${note} | ${result.status || '—'} | ${result.ms} ms |`);
  }
  lines.push('', down.length ? `**${down.length} check(s) failing.** See ops/runbooks/incident-response.md.` : allChallenged ? '**Every check was challenged by Vercel; nothing was verified.**' : 'All verified checks passed.');
  log(lines.join('\n'));

  return { ok: down.length === 0 && !allChallenged, results, summary: lines.join('\n') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { ok, summary } = await runChecks();
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
  process.exit(ok ? 0 : 1);
}
