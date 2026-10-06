# fynq-ops (PRIVATE)

This private repository holds FYNQ's business numbers, so they never appear in
the public app repo. It runs two scheduled workflows and keeps milestone state.

| Workflow | When | Does |
| --- | --- | --- |
| `nightly.yml` | 10:30 UTC daily | CEO morning report and engineering report (as issues here), trigger issues, milestone issues, `state/` commit |
| `health.yml` | hourly | Production health triggers (error spike, webhook failure, AI failures, auth failures) as issues here |

Both only **read** production, through `GET https://www.fynliq.com/api/beta-admin?view=ops`,
which returns aggregates only and runs the database reads in read-only
transactions. They write only issues and `state/` in this private repo. The
scripts refuse to publish anywhere that isn't a private repository.

## Setup (once, by the human)
1. Create a **private** repository `fynq-ops` (same owner as `fynliq-landing`).
2. Copy `.github/workflows/nightly.yml` and `.github/workflows/health.yml` from
   `ops/ops-repo-template/` in the app repo into it.
3. Create the read token, and store its hash in Vercel. On any computer:
   ```bash
   TOKEN=$(openssl rand -hex 32); echo "$TOKEN"; printf %s "$TOKEN" | shasum -a 256
   ```
   - In **fynq-ops** → Settings → Secrets and variables → Actions → New secret:
     `OPS_READ_TOKEN` = the token.
   - In **Vercel** → fynliq-landing → Environment Variables:
     `OPS_READ_TOKEN_SHA256` = the hash (64 hex characters). Scope it like the
     other live variables, then redeploy the live branch.

   The raw token never goes to Vercel, and the hash alone can't be used to
   read anything.
4. Actions → Nightly → Run workflow, to check it works. The first report
   appears as an issue.
5. Watch the repo (Watch → All activity) so new reports and triggers notify you.

## Rotating or revoking access
Change `OPS_READ_TOKEN_SHA256` in Vercel and redeploy. The old token stops
working immediately. To switch the automation off, disable the two workflows
here.
