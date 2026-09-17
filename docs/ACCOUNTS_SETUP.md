# Fynliq accounts — release gate

This feature is under development on `feat/accounts`; it is disabled by default.
Do not set either enable flag on the live site until every release check below passes.

## Architecture

React/Vite UI; Vercel APIs verify Supabase user tokens before private operations.
Supabase Auth handles Google and email OTP, persistent sessions and token refresh.
Postgres records use server-assigned ownership. RLS permits owner-only reads and
denies direct client writes. Storage has a private bucket and no client policies;
the API checks the document owner before downloading its bytes.

No existing database was configured in the source. The signed-in Supabase account
had no organizations/projects on inspection. A free Fynliq organization was created;
project creation requires the owner to supply the database password.

## Provisioning

1. Finish the free `fynliq-beta` project. Keep automatic table exposure off and RLS on.
2. Inspect public tables and storage policies in that project before running the migration.
3. Apply `supabase/migrations/202609170001_accounts.sql`. It deliberately fails if
   identically named tables/bucket already exist, rather than overwriting them.
4. Configure Auth site URL `https://www.fynliq.com`, allow callback
   `https://www.fynliq.com/account` and the exact isolated test deployment callback.
5. Configure a Google OAuth client in Google Cloud and enable Google in Supabase.
   Store the client secret in Supabase only. Do not request Drive/Gmail scopes.
6. Configure email delivery and the Magic Link template to show `{{ .Token }}` for
   code entry. Test actual delivery and rate limits before inviting beta users.
7. Add the settings named in `.env.example` to Vercel. Only the public URL/key and
   the client enable flag use `VITE_`. Use an independent random 32+ character
   `ACCOUNT_SESSION_SECRET`. Never expose service-role keys in frontend variables.

## Current semantics

The anonymous experience stays available. Files/results/questions are kept in memory
until Save is selected. Only that explicit save stages an encrypted, one-hour draft
in IndexedDB, with the decryption key in this tab's sessionStorage. OAuth returns to
the same tab. Before migration, the user confirms the destination account. A change
from one authenticated user to another clears cached private data and staged saves.
Document source IDs and question IDs make repeated saves idempotent.

Events go to the first-party database, not Vercel custom analytics. There are no
free-text event properties. Event IDs deduplicate retries; user IDs come from token
verification and anonymous IDs come from signed HttpOnly cookies. First-party events
are pseudonymous, not anonymous, and should be covered by the product privacy notice.

## Required release checks (not yet completed)

- Real Google sign-in, email code delivery, invalid/expired code, refresh and reopen.
- Two real test accounts: owner reads succeed; cross-owner REST and API reads fail;
  direct table writes and direct private-bucket access fail.
- Upload/save/return/reopen, original-file download, saved question history.
- Explicit anonymous migration through OAuth; duplicate and interrupted saves.
- Logout and cross-tab account changes clear every rendered/cached private result.
- Activity deduplication across refresh, OAuth, retries, and multiple tabs.
- Existing anonymous My Aid, Search and Ask flows remain operational.
- Keyboard focus, mobile layout and error recovery in the account panel.

The current unit tests cover request authorization and cookie verification only;
they do not replace live RLS or provider tests.

## Remaining implementation review before enabling

- Validate provider callback errors and expired sessions in the browser.
- Validate file-bound signatures and delete/download controls against actual Storage.
- Test transactional profile/signup-event recording and telemetry retry semantics.
- Validate admin metric queries against seeded activity, including zero-activity months.
- Validate that pending drafts cannot cross account changes and expired encrypted
  IndexedDB records are cleaned up on subsequent use.
- Review account panel keyboard/mobile behavior with actual provider configuration.

## Local validation checkpoint

The initial full suite passed (209 tests). Four additional document-save tests pass,
covering duplicate saves, substituted files, forged summaries and cross-owner lookups.
The feature-enabled build passes with local-only placeholder configuration. Browser
checks verified the passwordless account dialog, initial focus, Escape dismissal and
continued access to anonymous upload. These checks do not establish live Auth/RLS correctness.
