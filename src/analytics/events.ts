/**
 * Canonical browser analytics events (docs/analytics-events.md).
 *
 * `trackEvent()` never waits and never throws: events are batched for a
 * moment and sent to the same-origin /api/activity endpoint with
 * `keepalive`, so they survive a navigation. If anything fails the event is
 * simply lost; the student never sees a difference.
 *
 * Only names and small allow-listed metadata leave the browser. The server
 * decides who sent them from its own httpOnly cookies and drops anything it
 * doesn't recognise. Never pass document text, file names, figures, names,
 * emails or free text here.
 */

export type ClientEventName =
  | 'signup_started'
  | 'my_aid_viewed'
  | 'upload_started'
  | 'upload_failed'
  | 'results_viewed'
  | 'checkout_viewed'
  | 'client_error';

export interface ClientEventMetadata {
  reason?: string;
  view?: 'preview' | 'full';
  kind?: string;
  files?: number;
  error_name?: string;
  source_file?: string;
  path?: string;
}

interface Queued {
  id: string;
  name: ClientEventName;
  metadata?: ClientEventMetadata;
  experiment?: string;
}

export const ACTIVITY_ENDPOINT = '/api/activity';
const FLUSH_MS = 400;
const MAX_BATCH = 10;

let queue: Queued[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
const sentOnce = new Set<string>();

/** Live site only: previews and local development never send analytics. */
export function analyticsEnabled(hostname = typeof window === 'undefined' ? '' : window.location.hostname): boolean {
  return import.meta.env.PROD && (hostname === 'www.fynliq.com' || hostname === 'fynliq.com');
}

function uuid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Older in-app browsers: a v4-shaped id from Math.random is fine for dedupe.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
}

export function flushEvents(send: typeof fetch = fetch): void {
  if (timer) { clearTimeout(timer); timer = undefined; }
  while (queue.length) {
    const batch = queue.slice(0, MAX_BATCH);
    queue = queue.slice(MAX_BATCH);
    try {
      void send(ACTIVITY_ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: batch }),
      }).catch(() => {});
    } catch {
      /* analytics must never affect the page */
    }
  }
}

/**
 * Queue one event. `once` makes it fire at most once per page load for that
 * key (for example one `my_aid_viewed` however often the component renders).
 */
export function trackEvent(name: ClientEventName, metadata?: ClientEventMetadata, options: { once?: string; enabled?: boolean } = {}): void {
  try {
    if (!(options.enabled ?? analyticsEnabled())) return;
    if (options.once) {
      const key = `${name}:${options.once}`;
      if (sentOnce.has(key)) return;
      sentOnce.add(key);
    }
    queue.push({ id: uuid(), name, metadata });
    if (queue.length >= MAX_BATCH) flushEvents();
    else if (!timer) timer = setTimeout(() => flushEvents(), FLUSH_MS);
  } catch {
    /* never */
  }
}

/** Reset between tests. */
export function resetEventsForTest(): void {
  queue = [];
  sentOnce.clear();
  if (timer) clearTimeout(timer);
  timer = undefined;
}

export function pendingEventsForTest(): readonly Queued[] {
  return queue;
}

const MAX_ERRORS_PER_PAGE = 5;

/**
 * Counts uncaught frontend errors: the error's type and the script file it
 * came from (only our own /assets bundles), and the page's route. Never the
 * message, which can contain anything the page was showing.
 */
export function installErrorTracking(
  target: Window = window,
  pathFor: (path: string) => string | null = () => null,
  send: (name: 'client_error', metadata: ClientEventMetadata) => void = (name, metadata) => trackEvent(name, metadata),
): void {
  let count = 0;
  const report = (error: unknown, filename?: string) => {
    if (count >= MAX_ERRORS_PER_PAGE) return;
    count += 1;
    const name = error && typeof error === 'object' && 'name' in error && typeof (error as Error).name === 'string'
      ? (error as Error).name : 'Error';
    const file = typeof filename === 'string' ? /\/assets\/([A-Za-z0-9_.-]{1,80})$/.exec(filename.split('?')[0])?.[1] : undefined;
    const path = pathFor(target.location.pathname) ?? undefined;
    send('client_error', {
      error_name: /^[A-Za-z]{1,40}$/.test(name) ? name : 'Error',
      ...(file ? { source_file: file } : {}),
      ...(path ? { path } : {}),
    });
  };
  target.addEventListener('error', (event) => report((event as ErrorEvent).error, (event as ErrorEvent).filename));
  target.addEventListener('unhandledrejection', (event) => report((event as PromiseRejectionEvent).reason));
  target.addEventListener('pagehide', () => flushEvents());
}
