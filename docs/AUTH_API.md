# The account API

Everything the log-in and sign-up pages need from the backend, in one contract.

The frontend is finished and runs today against a local store. Connecting the
real service is one environment variable and three endpoints that match the
shapes below — no frontend changes.

```
VITE_FYNLIQ_AUTH_URL=https://api.fynliq.com/v1/auth
```

Unset, accounts are created and checked in the browser by
`src/auth/localAccounts.ts`, and the log-in page says on screen that the
account is local. Set, the pages talk to your endpoints and render what comes
back.

---

## Contents

- [What the account gates](#what-the-account-gates)
- [The three endpoints](#the-three-endpoints)
- [The session](#the-session)
- [A worked example](#a-worked-example)
- [Errors](#errors)
- [Cookies or tokens](#cookies-or-tokens)
- [Five rules the frontend enforces](#five-rules-the-frontend-enforces)
- [What the frontend already does](#what-the-frontend-already-does)
- [Checking your implementation](#checking-your-implementation)

---

## What the account gates

Three routes, listed in one place — `BEHIND_THE_ACCOUNT` in `src/App.tsx`:

| Route | Tab |
|---|---|
| `/beta`, `/beta/results` | My Aid |
| `/search`, `/search/<slug>` | Search |
| `/ask` | Ask Fynliq |

Anyone reaching one of them without a session is sent to `/login`, and on to
where they were going the moment they have an account. The landing page and
`/gradi` stay public: they are how somebody decides whether to sign up at all.

Moving a page in or out of the account is one line in that array and nothing
else. If you would rather first-timers land on the sign-up form than the
log-in form, `GATE_LANDS_ON` in the same file is the one word to change.

---

## The three endpoints

All three are `application/json` in and out, and all three are called with
`credentials: 'include'`.

### `POST {VITE_FYNLIQ_AUTH_URL}/signup`

```json
{ "email": "sam@school.edu", "password": "rainyTuesday7" }
```

Creates the account and returns a [session](#the-session) — the student is
logged in by signing up and is never asked to log in a second time.

### `POST {VITE_FYNLIQ_AUTH_URL}/login`

Same body. Returns a session.

### `GET {VITE_FYNLIQ_AUTH_URL}/session`

Called once on every page load, with `Authorization: Bearer <token>` when the
frontend is holding one. Returns a session, or `401`/`404` for a token that is
no longer good. **A `401` here is an answer, not an error** — it means "nobody
is logged in", and the student simply sees the log-in page.

### `POST {VITE_FYNLIQ_AUTH_URL}/logout`

Best effort. The frontend has already forgotten the student by the time this
is sent and ignores whatever comes back, including a failure. Invalidate the
session and return anything.

### The email you are sent

Always trimmed and lower-cased before it leaves the browser. Store and compare
it in that form, and return it in that form — see rule 2 below.

CORS: the browser sends these cross-origin from the site's domain. The
endpoints need `Access-Control-Allow-Origin` for that domain, must answer the
preflight `OPTIONS`, and — because every request carries credentials — must
send `Access-Control-Allow-Credentials: true` and a specific origin rather
than `*`.

---

## The session

`200 OK`, `application/json`. The same shape from all three endpoints.

| Field | Type | Notes |
|---|---|---|
| `account` | object | Required. See below. |
| `token` | string \| null | The bearer token. `null` (or omitted) when you keep the session in a cookie instead. Never an empty string. |
| `expiresAt` | string \| null | ISO-8601. `null` (or omitted) for a session with no stated end. |

### `account`

| Field | Type | Notes |
|---|---|---|
| `email` | string | **Trimmed and lower-cased.** Rejected otherwise. |
| `firstName` | string \| null | **Required key.** `null` when you have no name on file — an empty string is rejected. |
| `createdAt` | string | ISO-8601. Parsed with `Date.parse`. |

`firstName` is shown in the app header in place of the address when you send
one. Nothing in the product asks for it, so `null` is the expected answer
until something does.

---

## A worked example

`POST /signup`

```json
{ "email": "sam@school.edu", "password": "rainyTuesday7" }
```

`201` or `200`:

```json
{
  "token": "sess_9f2a1c8e4b7d",
  "expiresAt": "2026-10-19T09:30:00.000Z",
  "account": {
    "email": "sam@school.edu",
    "firstName": "Sam",
    "createdAt": "2026-09-19T09:30:00.000Z"
  }
}
```

This exact payload is the fixture in `src/auth/__tests__/contract.test.ts`.

---

## Errors

Return the status; the frontend turns it into a sentence. Where the table says
the body is shown, send a plain-text or JSON body and the **first 200
characters are shown to the student verbatim** — so write it as something a
nineteen-year-old can act on.

| Status | On | The student sees |
|---|---|---|
| `400` / `422` | signup | Your body, or a generic "check your details". |
| `400` / `422` | login | Your body, treated as a credentials problem. |
| `401` / `403` | either | "That email and password do not match an account." Your body is **not** shown. |
| `409` | signup | Your body, or "There is already an account with that email address. Log in instead." |
| `429` | either | Your body, or "Too many attempts. Wait a minute and try again." |
| other `4xx` | either | Your body, or "The account service refused that request." |
| `5xx` | either | "The account service is not responding right now." |

**`401` deliberately ignores your body.** "No account with that address" and
"wrong password" are shown as one sentence, because telling them apart tells a
stranger which addresses have signed up. Please return `401` for both.

Rate limiting is yours to do. The frontend cannot do it — there is nothing
stopping somebody skipping the page entirely and posting to `/login` directly,
which is also why every rule in `src/auth/validate.ts` has to be enforced
again on your side.

---

## Cookies or tokens

Both work, and the cookie is the better of the two.

**A session cookie (preferred).** Set an `HttpOnly`, `Secure`,
`SameSite=Lax` cookie on the signup and login responses, and return
`"token": null`. The frontend stores nothing, the browser sends the cookie on
its own, and no script on the page — including one that arrived through an
injection — can read the session.

**A bearer token.** Return it as `token` and the frontend keeps it in
`localStorage` and sends it as `Authorization: Bearer <token>`. Simpler to
implement and readable by any script that gets onto the page.

`src/auth/token.ts` is the whole of that decision on this side, and it already
handles both.

---

## Five rules the frontend enforces

These are checked in `src/auth/contract.ts` and will reject a response that
breaks them.

**1. A session without an account is not a session.**
`{ "ok": true }` fails at the boundary with the path named, rather than
leaving the app convinced it has a student it cannot identify.

**2. The address comes back normalised.**
`"Sam@School.edu"` is rejected. The app looks accounts up by the normalised
address and shows it back to the student; a different string is a different
account as far as every comparison downstream is concerned.

**3. `firstName` is present, as a name or as `null`.**
Omitting the key is a bug, not a shorthand, and an empty string is not a name.

**4. Timestamps are parseable.**
`createdAt` and `expiresAt` must be something `Date.parse` understands. A
session is treated as expired the instant `expiresAt` is reached, never after.

**5. A password never leaves the boundary of a request.**
Nothing in this frontend stores, logs or echoes one. The local store hashes
with PBKDF2-SHA-256 and 210,000 iterations over a per-account random salt, and
compares in constant time — please do at least as well.

---

## What the frontend already does

| Where | What |
|---|---|
| `src/auth/validate.ts` | Email shape, password length and composition, confirmation match — all pure, all tested. **Enforce it again on your side.** |
| `src/auth/contract.ts` | Validates every response before the app sees it |
| `src/auth/AuthProvider.tsx` | Holds the session, restores it on load, clears it on log out |
| `src/App.tsx` | The gate, the redirect, and returning the student to where they were going |
| `src/pages/Auth.tsx` | Both forms, the rules checklist, the errors, the pending states |

Logging out also empties the analysis held in memory, so a shared laptop does
not show the last person's award to the next one.

---

## Checking your implementation

The contract tests double as an executable spec:

```bash
npm test -- auth
```

`src/auth/__tests__/contract.test.ts` contains the worked example above and
every rejection case. If your response passes `parseSession`, it will render.

The whole journey is also driven end to end in a real browser:

```bash
npm run build && npm run preview      # then, in another shell:
SHOT_URL=http://localhost:4173 node docs/auth-screenshots.js
```

That run fails loudly if Join the beta stops reaching the log-in page, if a
new account does not land on upload with the other two tabs open, if logging
out does not close them again, or if a refusal starts saying which half of the
credentials was wrong.

To point the pages at a local backend while developing:

```bash
echo 'VITE_FYNLIQ_AUTH_URL=http://localhost:8000/auth' >> .env.local
npm run dev
```
