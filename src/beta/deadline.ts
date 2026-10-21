/**
 * A request that gives up on its own.
 *
 * `/api/analyze` stops itself at 60 seconds (its `maxDuration`). A request
 * still open well past that is not going to answer, and a student watching
 * "Fynliq is reading your document" forever is a student who leaves. The
 * returned signal aborts when the caller's signal does (they pressed cancel)
 * or when the time runs out — and `timedOut()` tells the two apart, because
 * one is a choice and the other is a failure to explain.
 */
export interface Deadline {
  signal: AbortSignal;
  timedOut: () => boolean;
  clear: () => void;
}

export function deadline(ms: number, outer?: AbortSignal): Deadline {
  const controller = new AbortController();
  let expired = false;

  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, ms);
  const follow = () => controller.abort();

  if (outer?.aborted) controller.abort();
  else outer?.addEventListener('abort', follow, { once: true });

  return {
    signal: controller.signal,
    timedOut: () => expired && !outer?.aborted,
    clear: () => {
      clearTimeout(timer);
      outer?.removeEventListener('abort', follow);
    },
  };
}

/** Comfortably past the server's own 60-second limit. */
export const ANALYZE_DEADLINE_MS = 70_000;
