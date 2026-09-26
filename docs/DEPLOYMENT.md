# Deployment — where the site actually builds from

Rewritten 26 September 2026, after the accounts work landed on `main` and both
`.vercel.app` hosts were pointed at the custom domain. An earlier version of
this file said the opposite; it was measured before that change and is wrong.

## The short version

**`https://www.fynliq.com` is the site.** It builds from `main`, it is where
accounts live, and it is what the README links. Everything else redirects to
it.

| URL | What it does |
| --- | --- |
| `www.fynliq.com` | **The site.** Builds from `main`, accounts in Supabase |
| `fynliq-landing-nine.vercel.app` | 308 → `www.fynliq.com` |
| `fynliq-landing.vercel.app` | 308 → `www.fynliq.com` |

The redirects are in `vercel.json`, not in DNS, so they are reviewable in a
pull request like anything else.

## Why the `.vercel.app` hosts redirect

They used to serve a build of their own, and that turned out to be worse than
useless for accounts. With `VITE_FYNLIQ_AUTH_URL` unset, the app falls back to
a local account store — a real, working sign-up whose accounts exist only in
the one browser that made them. A student who signed up on a preview host had
an account that vanished on their phone and that `www.fynliq.com` had never
heard of, with no way to tell from the screen which of the two they were on.

One live site, one account store, everything else a redirect.

## Checking whether a change is live

Status codes prove nothing: the SPA rewrite answers `200` for any path, and
the app falls through to the landing page on a route it does not recognise. A
green `/gradi/start` can still be the landing page.

Check for something only the new build has:

```bash
curl -s https://www.fynliq.com/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'
```

Compare that against `dist/assets/` after `npm run build`. Same hash, same
code. Or open the route in a browser and look for its heading — that is what
`docs/gradi-screenshots.js` and the other harnesses do.

Repeated automated requests trip Vercel's bot challenge and start returning
`403` with `X-Vercel-Mitigated: challenge`. That is rate limiting, not an
outage: wait, or check in a browser.

## For whoever wires the backend

The frontend talks to four endpoints, each behind one environment variable and
each with a written contract. Leave a variable unset and that seam falls back
to something that runs locally and says on screen that it is doing so.

| Variable | Contract |
| --- | --- |
| `VITE_FYNLIQ_AUTH_URL` | `docs/AUTH_API.md` |
| `VITE_FYNLIQ_ANALYZE_URL` | `docs/ANALYSIS_API.md` |
| `VITE_FYNLIQ_SEARCH_URL` | `docs/SEARCH_ANALYTICS_API.md` |
| `VITE_FYNLIQ_ASK_URL` | `docs/ASK_API.md` |

`ACCOUNTS_SETUP.md` covers the Supabase side: provisioning, RLS, the storage
bucket, and the release checks that were still outstanding when it was written.

Two account systems currently coexist on `main` — `src/auth/` (the log-in page
and the route gate) and `src/accounts/` (the Supabase-backed provider, guest
sessions and the admin views). They were built from different premises and have
not been reconciled. Anyone touching authentication should read both before
changing either.

## Local development

`npm install`, then `npm run dev`. `cp .env.example .env.local` and fill in
whichever of the four endpoints you have.

The repository needs roughly 400 MB of free disk once `node_modules` is
installed — `pdfjs-dist` and `tesseract.js` are most of it. That is worth
knowing before cloning onto a full drive.
