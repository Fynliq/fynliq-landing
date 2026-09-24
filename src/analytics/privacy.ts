import type { BeforeSendEvent } from '@vercel/analytics/react';
import { questionBySlug } from '../search/library';

const pages = new Set(['/', '/beta', '/beta/results', '/search', '/ask', '/gradi']);

// Only public, predefined routes may be reported. Never send search text,
// arbitrary path segments, query parameters, fragments or student data.
export function analyticsPath(path: string): string | null {
  const normalized = path.replace(/\/+$/, '') || '/';
  if (pages.has(normalized)) return normalized;
  if (normalized.startsWith('/search/') && questionBySlug(normalized.slice(8))) return normalized;
  return null;
}

export function redactPageview(event: BeforeSendEvent): BeforeSendEvent | null {
  if (event.type !== 'pageview') return null;
  try {
    const url = new URL(event.url);
    if (!['https://fynliq.com', 'https://www.fynliq.com'].includes(url.origin)) return null;
    const path = analyticsPath(url.pathname);
    return path ? { type: 'pageview', url: `${url.origin}${path}` } : null;
  } catch {
    return null;
  }
}
