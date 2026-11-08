# Runbook: authentication and sessions

Owner: security-agent (review), backend-agent (code). All auth changes are RED.

## Three identities
| Identity | Cookie | Created by | Lifetime | Stored as |
| --- | --- | --- | --- | --- |
| Guest browser | `__Host-fynliq_beta` (httpOnly, Secure, SameSite=Strict) | `POST /api/beta-auth {action:'guest'}` | 30 days, renewed on Ask | SHA-256 hash in `beta_sessions` |
| Account (email + password) | `__Host-fynliq_account` (httpOnly, Secure, SameSite=Lax) | `/api/auth/signup`, `/api/auth/login` via Supabase Auth | about 400 days, renewed each visit | SHA-256 hash in `account_sessions` |
| Admin | `__Host-fynliq_admin` (httpOnly, Secure, SameSite=Strict) | Email OTP to an invited address, user id in `BETA_ADMIN_USER_IDS` | 1 hour | `beta_sessions` kind `admin` |

Passwords go to Supabase Auth only and are never stored or logged by FYNQ.
Supabase access and refresh tokens aren't persisted. FYNQ issues its own random
session token.

Two client-side account systems coexist (`src/auth/` and `src/accounts/`).
Read both before changing either (see `docs/DEPLOYMENT.md`).

## Guards that must stay
`sameOrigin()` on POSTs; `rate()` per scope; the email regex and length cap;
the `^[a-f0-9]{64}$` token format check; `kind` checks in `session()`; and
`Cache-Control: no-store`.

## Symptoms → checks (read-only)
| Symptom | Check |
| --- | --- |
| Everyone logged out / 503 on every API call | `BETA_ENABLED`, `SUPABASE_*` and `BETA_RATE_SECRET` (≥32 chars) present on the live env scope? `clients()` fails closed. |
| 403 "Please use the Fynliq website" | The `Origin` header doesn't equal `BETA_ORIGIN` (host change, in-app browser, or a preview host). |
| 429 on login / sign-up | Rate scopes `account-login` (10/min per IP) and `account-signup` (5/min). The admin OTP flow uses scope `auth` (10/min). Expected under attack. |
| Sign-up works on one device only | The user is on a host where `VITE_FYNLIQ_AUTH_URL` fell back to local accounts (see `docs/DEPLOYMENT.md`). |

## Emergency actions 👤
- **Revoke one account's sessions:** a DB write on `account_sessions`
  (`revoked=true`). Human only, with a written reason.
- **Revoke all sessions:** rotate the session tables' contents (RED, human). For
  admins, also remove ids from `BETA_ADMIN_USER_IDS`.
- **Suspected key leak:** rotate the Supabase service-role key (read by the
  code as `SUPABASE_SERVICE_ROLE_KEY`) in Supabase, then update every Vercel env
  scope that holds it, then redeploy. See `incident-response.md`.
- **Supabase Auth settings** (password policy, leaked-password protection, OTP
  expiry) are RED and human-only. Agents may report advisor findings about them
  privately to the human.
