# Public guest rollout — 2026-09-17

The owner authorized public access without accounts or invite codes and approved a 10,000-question daily ceiling. This supersedes the earlier closed-beta plan.

## Current status
Supabase schema applied and verified on 2026-09-18: all six tables have RLS enabled and anon cannot SELECT. Vercel settings now include the live preview branch, public guest access and the approved 10,000/day budget. Deployment and live end-to-end verification are pending.

## Access and metrics
Guest sessions start automatically. A random UUID identifies each browser, authenticated by a separate random Secure/HttpOnly/SameSite cookie. Only the cookie hash is stored in the database. Guest creation does not require Supabase email signup or an invite. Admin access still requires verified email, a private admission list and a configured UUID allowlist.

anonymous_users contains id, created_at and last_active_at. events contains id, user_id, event_type and created_at. Internal private tables provide session authentication and atomic question quotas. All tables have RLS; only the server service role can call the functions or read the data.

Total users means guest browser identities, not deduplicated people. Clearing cookies or changing devices can create another identity. DAU counts UTC-today question activity; WAU and MAU count distinct guests with questions in the previous 7 and 30 days. Passive visits never count as active. Returning means question activity on at least two UTC dates. Activated means at least one successful answer.

## Required deployment steps
1. Inspect existing Supabase schema, then apply supabase/migrations/202609170002_closed_beta.sql to project jvuvrwqmcauorlqrxpqj. This is a new-schema migration, not an idempotent update.
2. Configure server-only Vercel variables on the actual live branch feat/connect-ask-backend: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY, BETA_ENABLED=true, BETA_ORIGIN=https://www.fynliq.com, BETA_RATE_SECRET (random 32+ characters), BETA_MAX_QUESTIONS_PER_DAY=10000, ASK_USER_MAX_PER_DAY=50, ASK_USER_MAX_PER_MINUTE=8, OPENAI_MAX_OUTPUT_TOKENS=1200. Preserve existing OPENAI_API_KEY and OPENAI_MODEL. No guest invitation variable is used.
3. For the optional app admin dashboard, provision admin email OTP and beta_invites plus BETA_ADMIN_USER_IDS. The owner can inspect tracking through the Supabase dashboard without enabling app-admin access.
4. Deploy the tested code to the branch actually mapped to www.fynliq.com, verify automatic guest cookies and server-only database access, then verify synthetic question success and persistence in Supabase. No real student documents or questions should be used for verification.

## Privacy and limitations
Every Responses call uses store:false with an explicit output ceiling. The server blocks obvious SSNs, tax/bank/account identifiers and credentials before AI calls. Pattern detection does not guarantee that every kind or disguise of PII is caught. Fynliq code does not persist question/answer text in analytics, database or application logs; platform telemetry and provider retention still need production verification. store:false is not a Zero Data Retention claim.

Raw document processing remains disabled in this pending privacy patch, since arbitrary PDFs and images cannot pass the text-only privacy screen. Do not advertise working personalized document uploads for this patch. Existing live code has not been changed.

The 10,000/day ceiling is database-backed and counts accepted attempts including failed answers. Per-user and per-IP limits remain. It is not a load test or guarantee of capacity for thousands of simultaneous visitors.
