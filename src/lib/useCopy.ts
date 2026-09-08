import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Copies a message to the clipboard and reports it for two seconds.
 *
 * The confirmation replaces the label in a fixed-width control, so the button
 * does not resize when the text changes.
 */
export function useCopy() {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const timer = useRef<number>();

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = useCallback(async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard access can be denied. Still confirm the intent locally
      // rather than failing silently.
    }
    setCopiedId(id);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopiedId(null), 2000);
  }, []);

  return { copiedId, copy };
}
