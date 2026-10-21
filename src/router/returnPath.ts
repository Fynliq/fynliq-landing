/**
 * Where to send somebody once they have logged in, as a same-origin path.
 *
 * The account gate remembers the page it stopped them on, query string
 * included: Stripe's return to `/beta/checkout?result=cancelled` means
 * something different without its `?result`. Anything that is not plainly a
 * path on this site — another origin, a scheme, a protocol-relative `//host`,
 * a backslash a browser would read as one — comes back `null`, and the
 * caller falls back to its default page.
 */
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 2000) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return null;

  const base = 'https://return.invalid';
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  if (url.origin !== base) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The path part of a return path, for matching it against routes. */
export const pathOf = (returnPath: string) => returnPath.replace(/[?#].*$/, '');
