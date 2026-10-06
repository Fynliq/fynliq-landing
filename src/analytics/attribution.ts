/**
 * Captures where this page load came from, BEFORE the router runs.
 *
 * The router rewrites the URL on the first client-side navigation and drops
 * the query string, so UTM tags must be read the moment the app boots
 * (main.tsx calls captureArrival first thing). The touch is kept in
 * sessionStorage until the server has recorded it, so it survives in-app
 * navigation and a failed first request. Supabase is the source of truth;
 * this is only the hand-off.
 *
 * Privacy: only utm_* values, a ?ref= tag, the referring site's HOST name,
 * the landing PATH, and whether an ad click id was present (never the id
 * itself). No full URLs, no search text, nothing typed by the student.
 */

export interface ArrivalTouch {
  utm: { source?: string; medium?: string; campaign?: string; content?: string; term?: string };
  referrer?: string;
  landing: string;
  clickIds: { ttclid: boolean; gclid: boolean; fbclid: boolean };
  ref?: string;
}

const KEY = 'fynq.arrival';
const MAX = 100;

const short = (value: string | null): string | undefined => {
  const text = (value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, MAX);
  return text || undefined;
};

/** Builds the touch for a URL and referrer. Pure, for tests. */
export function arrivalFrom(href: string, referrer: string): ArrivalTouch {
  const url = new URL(href);
  const q = url.searchParams;
  let host: string | undefined;
  try { host = referrer ? new URL(referrer).hostname.toLowerCase() : undefined; } catch { host = undefined; }
  // A referrer from this same site is a page change, not an arrival.
  if (host && host === url.hostname.toLowerCase()) host = undefined;
  const utm = {
    source: short(q.get('utm_source')), medium: short(q.get('utm_medium')), campaign: short(q.get('utm_campaign')),
    content: short(q.get('utm_content')), term: short(q.get('utm_term')),
  };
  return {
    utm: Object.fromEntries(Object.entries(utm).filter(([, v]) => v !== undefined)) as ArrivalTouch['utm'],
    referrer: host,
    landing: /^\/[A-Za-z0-9/_.-]{0,199}$/.test(url.pathname) ? url.pathname : '/',
    clickIds: { ttclid: q.has('ttclid'), gclid: q.has('gclid'), fbclid: q.has('fbclid') },
    ref: short(q.get('ref')),
  };
}

/** Called once per full page load, before React renders. */
export function captureArrival(): void {
  try {
    const touch = arrivalFrom(window.location.href, document.referrer);
    sessionStorage.setItem(KEY, JSON.stringify(touch));
  } catch { /* storage blocked: the visit is simply not attributed */ }
}

/** The touch waiting to be recorded, if any. */
export function pendingArrival(): ArrivalTouch | undefined {
  try {
    const value = sessionStorage.getItem(KEY);
    if (!value || value.length > 1500) return undefined;
    return JSON.parse(value) as ArrivalTouch;
  } catch { return undefined; }
}

/** The server has recorded it; do not send it again in this page load. */
export function arrivalSent(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}
