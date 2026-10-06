// Request health log for every /api function: route, method, status, duration,
// how many database calls failed, and the error class if the handler threw.
// Never bodies, query strings, cookies, IPs or messages.
//
// observe() wraps a handler. The record is written after the response has
// been sent: through Vercel's waitUntil when the platform provides it, else
// with a short bounded wait. Either way it can't fail or slow the request in
// any way the student would notice, and a missing database means no record.
import { AsyncLocalStorage } from 'node:async_hooks';
import { clients, rpc } from './beta.js';

const storage = new AsyncLocalStorage();

/** Called by rpc() when a database call fails, so the request log can count it. */
export function noteDbError() {
  const store = storage.getStore();
  if (store) store.dbErrors += 1;
}

const ROUTE = /^\/api\/[a-z0-9/_-]{1,60}$/;
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);
const SYNTHETIC = /fynq-uptime-check|fynq-ops/i; // our own probes and the ops metrics reads

function waitUntilFn() {
  // Same lookup @vercel/functions uses internally; absent outside Vercel.
  try {
    const ctx = globalThis[Symbol.for('@vercel/request-context')]?.get?.();
    return typeof ctx?.waitUntil === 'function' ? ctx.waitUntil.bind(ctx) : null;
  } catch {
    return null;
  }
}

export async function writeRequestRecord(record, dependencies = {}) {
  try {
    const env = dependencies.env || process.env;
    const db = dependencies.db || (dependencies.clients || clients)(env).db;
    await Promise.race([
      rpc(db, 'api_request_record', record).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, dependencies.timeoutMs ?? 1500)),
    ]);
  } catch { /* health logging must never affect a request */ }
}

export function observe(route, handler, dependencies = {}) {
  if (!ROUTE.test(route)) throw new Error(`observe(): invalid route ${route}`);
  const write = dependencies.write || writeRequestRecord;
  return async function observed(req, res) {
    const store = { dbErrors: 0 };
    const started = Date.now();
    let errorClass = null;
    try {
      return await storage.run(store, () => handler(req, res));
    } catch (error) {
      errorClass = typeof error?.name === 'string' && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : 'Error';
      if (!res.headersSent) {
        try { res.status(500).send('Something went wrong. Please try again.'); } catch { /* already closed */ }
      }
      return undefined;
    } finally {
      const method = String(req?.method || '').toUpperCase();
      const status = Number.isInteger(res?.statusCode) ? res.statusCode : 500;
      const record = {
        p_route: route,
        p_method: METHODS.has(method) ? method : 'OTHER',
        p_status: status >= 100 && status <= 599 ? status : 500,
        p_duration: Math.max(0, Date.now() - started),
        p_db_errors: Math.min(store.dbErrors, 100),
        p_error_class: errorClass,
        p_synthetic: SYNTHETIC.test(String(req?.headers?.['user-agent'] || '')),
      };
      const pending = write(record, dependencies).catch(() => {});
      const waitUntil = waitUntilFn();
      if (waitUntil) waitUntil(pending);
      else await pending;
    }
  };
}

/**
 * Lets bookkeeping finish after the response without holding it: on Vercel
 * the work is handed to waitUntil and this resolves at once; elsewhere (tests,
 * local) it simply waits for the work, which is itself time-bounded.
 */
export function afterResponse(promise) {
  const safe = Promise.resolve(promise).catch(() => 0);
  const waitUntil = waitUntilFn();
  if (waitUntil) { waitUntil(safe); return Promise.resolve(0); }
  return safe;
}
