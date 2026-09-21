# Deployment — where the site actually builds from

Measured 21 September 2026. Four URLs serve some version of Fynliq, across at
least two Vercel accounts. Only one of them follows pushes to this repository,
and it is not the one on the custom domain. This document says which is which,
so nobody spends another afternoon wondering why a merged change is not live.

## What is live where

| URL | Build | Follows `main`? | Account |
| --- | --- | --- | --- |
| `fynliq-landing-nine.vercel.app` | Current | **Yes** | Not visible from here |
| `www.fynliq.com` | Stale — no `/login` route | No | Not visible from here |
| `fynliq-landing.vercel.app` | 13 days old, **404s on every deep link** | No | `dorsanes-projects` |
| `fynliq-beta-review.vercel.app` | 9 days old | No | `dorsanes-projects` |

`fynliq-landing-nine.vercel.app` is the one to trust and the one the README
links. It picked up the log-in page within minutes of the push to `main`.

## The problem

The custom domain and the project that auto-deploys are both on a Vercel
account that the `dorsanes-projects` team cannot see:

- `vercel domains ls --scope team_I8G7dhNRm4nRxnbIfLXAJiPX` returns **zero
  domains**, so `fynliq.com` is not held by that team.
- `fynliq-landing-nine.vercel.app` does not appear in that team's alias list
  either, yet it serves the current build.
- `www.fynliq.com` resolves to `1344aa72d295063e.vercel-dns-017.com`, which is
  Vercel — just somebody else's project on it.

So `www.fynliq.com` and `fynliq-landing-nine.vercel.app` are two different
deployments. Merging to `main` updates the second and leaves the first alone.

## To put the domain on the branch that builds

Whoever owns the account holding `fynliq.com` has to do this; it cannot be done
from this repository or from the `dorsanes-projects` team.

1. Sign in to the Vercel account that owns `fynliq.com`. The project serving
   `fynliq-landing-nine.vercel.app` is in there too — find it by that URL.
2. Confirm that project's Git connection points at
   `github.com/Fynliq/fynliq-landing`, production branch `main`.
3. In that project's **Domains**, add `www.fynliq.com` and `fynliq.com`. Vercel
   will report the domain as in use by another project and offer to move it —
   accept, or remove it from the old project first.
4. Keep `fynliq.com` as a redirect to `www.fynliq.com`; it already 308s today.
5. DNS is at Namecheap (`dns1.registrar-servers.com`). If Vercel asks for a
   record change, it goes there. The existing `www` CNAME already points at
   Vercel, so usually nothing needs editing.
6. Push a trivial commit to `main` and confirm `www.fynliq.com/login` renders
   the log-in page rather than the landing page.

Until step 3 is done, treat `www.fynliq.com` as a separate, older site.

## Checking whether a change is live

Status codes prove nothing: the SPA rewrite answers `200` for any path and the
app falls through to the landing page when it does not know the route. Check
for something only the new build has.

```
curl -s https://fynliq-landing-nine.vercel.app/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'
```

Compare that against `dist/assets/` after `npm run build`. Same hash, same code.
Repeated automated requests trip Vercel's bot challenge and start returning
`403` with `X-Vercel-Mitigated: challenge`; that is rate limiting, not an
outage. Wait, or check in a browser.

## The local `vercel link`

`.vercel/project.json` is gitignored, so each machine links itself. This folder
was linked to `fynliq-beta-review`, meaning a `vercel --prod` here would have
deployed to the review project rather than anything public. It is now linked to
`fynliq-landing`:

```
vercel link --project fynliq-landing --scope team_I8G7dhNRm4nRxnbIfLXAJiPX --yes
```

Note that neither project auto-deploys, so a manual `vercel --prod` is the only
way either of them changes. Deploying to `fynliq-landing` would at least repair
`fynliq-landing.vercel.app`, which 404s on `/login`, `/beta` and `/search`
because it predates the SPA rewrite in `vercel.json`. Two branches still
advertise that URL in their README —`feat/connect-ask-backend` and
`feat/beta-upload-flow`— and both are advertising a link that dies on a refresh.
