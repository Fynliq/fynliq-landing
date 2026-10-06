# Runbook: database (Supabase)

There is **one** Supabase project and it's production. There's no staging
database. Local and CI testing uses PGlite. `test:billing` and the attribution
suite run every file in `supabase/migrations/` in order; `test:beta` loads only
the closed-beta migration. Agents find the project id at runtime with the
read-only `list_projects` call.

## Access model (do not change without RED review)
- RLS is enabled on every table, with **no policies**. `anon` and
  `authenticated` have no grants, and `service_role` has all.
- Every read and write goes through `SECURITY DEFINER` functions with
  `set search_path=''`, executable by `service_role` only.
- The server uses the service-role client (`server/beta.js clients()`). The
  browser never talks to Postgres directly.
- The Supabase advisor reports "RLS enabled, no policy" (INFO) for these
  tables. **That's expected**, so don't "fix" it by adding policies. Other
  advisor findings go to the human. Auth settings changes are RED and
  human-only.

## Writing a migration (supabase-agent)
1. New file `supabase/migrations/YYYYMMDDNNNN_<name>.sql`, following the
   pattern in `.claude/agents/supabase-agent.md`.
2. Header: purpose, data stored and not stored, retention, access path,
   rollback.
3. `npm run test:billing && node test/attribution-integration.mjs` both apply
   the full migration chain on PGlite.
4. security-agent reviews it.
5. The PR states the order relative to code: **before merge**, **after merge**,
   or **independent**.

## Applying to production 👤
Only the human applies migrations, after the PR is approved. Use the Supabase
dashboard SQL editor or CLI, pasting the **exact file contents from the merged
commit**. Then:
- Check `list_migrations` (read-only) to confirm it's recorded.
- Run the advisors (security and performance) and compare with before.
- Smoke-test the affected RPC through the app, not through ad-hoc SQL.

## Drift between production and the repository
Production contains migration records and schema objects that don't come from
this repository, and its migration versions don't match the repo filenames
(migrations have been applied by hand). Before any schema change, run the drift
check: compare `list_migrations` and `list_tables` (read-only) with
`supabase/migrations/`. 👤 decides how to reconcile: bring the definitions into
git as documentation-only files, or remove the objects in a reviewed migration.
New migrations must not collide with objects that only exist in production.

## Data rules
- Never `SELECT` personal rows (emails, aid facts) into agent output. Use
  aggregate RPCs.
- `aid_analyses` holds verified aid figures for 30 days (purged on the next
  save). Treat it as PII-adjacent.
- 👤 Confirm backup and point-in-time-recovery coverage before any destructive
  migration.

## Irreversible operations (always STOP and ask)
`drop table`, `drop column`, `truncate`, type changes that lose data, `delete`
without a reversible archive, and any change to `auth.*` or `storage.*`.
