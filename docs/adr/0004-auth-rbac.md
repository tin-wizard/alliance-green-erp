# ADR 0004 — Authentication with Neon Auth, and our RBAC layer

- **Status:** Accepted; supersedes the original Argon2id + opaque-session decision
- **Date:** 2026-11-11
- **Owners:** Platform

## Context

The legacy system authenticates with `SELECT * FROM users WHERE username='$user' AND
password=md5('$pass')`. It has four practical user populations:

| Population | How legacy identifies it |
|---|---|
| Admin | `users.access > 8` |
| Staff / technician | `users.access` 1–8, no `subid` |
| Subcontractor | `users.subid` points at a vendor in Sage (`tvendor`) |
| Supplier | separate supplier portal rows/users |

It also has **granular, expiring flags**:

- `user_permissions (user_id, permission_name, is_allowed, permission_date)` — named capabilities
  with an optional expiry date, catalogued by `permission_type`.
- `user_permissions_without_wsib_insurance (user_id, subid, allowed_by, permission_date)` —
  an override allowing a user to process work for a subcontractor whose WSIB insurance lapsed.
- `user_permissions_price_management (user_id, allowed_by, permission_date)` — the parts
  price editor grant, now modelled as `inventory:edit_price`.

The first scaffold implemented Argon2id password hashes and opaque database sessions, because no
identity provider had been chosen. The human then provisioned **Neon Auth (Managed Better Auth)**
on the same Neon project. Building a second password store next to it would be a security and
migration liability, so that plan is withdrawn.

## Decision

### Identity and credentials: Neon Auth

- Credentials, sign-up, password reset, OAuth (if enabled) and sessions belong to **Neon Auth**,
  a managed Better Auth service. Its tables live in the `neon_auth` schema of this same Neon
  database and branch with it.
- The app has **no password column, no password hash and no hashing dependency**. The legacy MD5
  hash is never accepted. Every migrated user sets a password through Neon Auth at cutover.
- Sign-in is a **server-side call** from our login server function to
  `POST {NEON_AUTH_BASE_URL}/sign-in/email` with an `Origin` header equal to `APP_URL`
  (Better Auth requires a trusted origin). The browser never talks to the provider directly.

Why not the browser SDK on the LAN: the SDK relies on a Secure, `SameSite=None` provider cookie.
The app is served over plain HTTP on a LAN address, where browsers reject that cookie, and
third-party-cookie blocking breaks the refresh path. Calling the REST API from our server avoids
the whole class of problems and keeps the provider URL off the client.

### Token and session validation

- `POST /sign-in/email` returns a session cookie and (usually) a `set-auth-jwt` header. If the
  header is absent we call `GET /get-session` with the cookie and read the JWT there.
- The JWT is verified **on our server** against `NEON_AUTH_JWKS_URL` with `jose`:
  EdDSA only, issuer and audience equal to the origin of `NEON_AUTH_BASE_URL`, expiry enforced,
  5-second clock tolerance. `sub` must be present.
- Tokens live 15 minutes. The provider's session cookie is kept, **sealed with AES-256-GCM**
  under a key derived from `SESSION_SECRET`, in our HttpOnly app cookie together with the current
  JWT and our own 12-hour expiry. On an expired JWT, the server calls `/get-session` with the
  stored cookie to obtain a fresh one. A 10-minute in-memory cache avoids one provider call per
  request; it holds no independent session state.
- The app cookie is `cls_session`: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` when
  `SESSION_COOKIE_SECURE=true`, `Max-Age = SESSION_TTL_HOURS`. It is a transport for the
  provider's session, not a second credential store.
- Logout calls the provider's `/sign-out` (best effort) and clears the cookie. Deleting the cookie
  alone ends our access; provider-side revocation takes effect at the next refresh.
- CSRF: TanStack Start's `createCsrfMiddleware` is installed globally for server functions, plus
  SameSite=Lax as defence in depth.

### Application identity and provisioning

- `users` owns profile, role, enablement, legacy mapping and audit references. It is keyed to Neon
  by `users.neon_user_id` (the JWT `sub`), unique and nullable until first sign-in.
- A verified email may **link** an existing row that an administrator pre-created. Unverified
  emails never link and never auto-provision: otherwise anyone could sign up with an invited
  address and claim it.
- The only automatic provisioning path is the bootstrap admin: `SEED_ADMIN_EMAIL` must be set
  explicitly (there is deliberately **no default**), the sign-in email must match it, and the
  claim `emailVerified` must be true. The seed creates no admin unless that variable is set.
- Anyone who authenticates with Neon but has no linked row is refused with a clear message and an
  `auth.login_denied` audit row. Neon allows public sign-up by default, so **the provisioning gate
  is the access control**, not sign-up itself. Email verification should be enabled in Neon Auth.

### Roles and permissions (our layer, unchanged)

Coarse role on `users.role`: `admin | technician | subcontractor | supplier`. The legacy numeric
level is preserved in `users.legacy_access` for reconciliation only.

Fine-grained capabilities are string keys in `permission_definitions`, granted by
`role_permissions` (defaults for a role) and overridden per user by `user_permissions`
(`is_allowed`, optional `expires_at`). Effective permission = explicit user grant that is not
expired, otherwise role default. Explicit deny wins.

Keys are `<domain>:<action>`. The WSIB override is `workorder:override_wsib_hold`, scoped by
`user_permissions.scope_subcontractor_id`. The legacy price-editor table is
`inventory:edit_price`.

### Enforcement and audit

- **Server functions are the security boundary.** Every function that touches data declares
  `authMiddleware` plus a permission middleware. A route `beforeLoad` guard is UX only.
- Every write emits an `audit_log` row in the same transaction via `writeAudit()`. Login success,
  failure, denial and logout are audited by the auth server function.
- Login is rate-limited per IP + identifier in memory (10 / 15 min). Single-process; documented.

## What Neon Auth covers, and what it does not

| Concern | Owner |
|---|---|
| Passwords, hashing, reset, email verification, OAuth | Neon Auth |
| Session creation, refresh, revocation at the provider | Neon Auth |
| JWT signing keys and JWKS | Neon Auth |
| JWT verification on every request | **Us** (`@cls/auth`) |
| App cookie sealing, TTL, logout | **Us** |
| Linking provider identity to app user | **Us** |
| Roles, 30 permissions, scoped grants | **Us** |
| Audit trail and login rate limit | **Us** |

## Alternatives considered

1. **Original plan: Argon2id + opaque sessions in `sessions`.** Withdrawn: Neon Auth was
   provisioned, and keeping both would create two credential stores and two revocation paths.
2. **Browser SDK (`@neon/auth`) with its own cookie.** Rejected for this deployment: Secure /
   `SameSite=None` provider cookies and third-party-cookie blocking do not work reliably on an
   HTTP LAN origin.
3. **JWT-only cookie, no refresh.** Rejected: a 15-minute token would force a login every 15
   minutes; there is no silent refresh without the provider session cookie.
4. **Opaque app session rows pointing at a Neon session.** Rejected as unnecessary state: the
   sealed cookie already carries the provider session, and Neon remains the source of truth.
5. **Trust the provider's session cookie without JWT verification.** Rejected: the cookie is
   opaque and never reaches our origin; signature verification is the documented server path.
6. **Keep the numeric `access` level as the only role.** Rejected: it cannot express supplier vs
   subcontractor or the expiring WSIB override.

## Consequences

- **Positive:** no password material in this repository or database; provider-managed resets,
  verification and OAuth without new code.
- **Positive:** every request is verified server-side against live JWKS; a forged token fails.
- **Positive:** RBAC and audit stay explicit and testable, independent of the provider.
- **Negative:** if Neon is unreachable when a JWT has expired, the user is redirected to login
  until it recovers. An unexpired JWT keeps working. This is the cost of a hosted provider.
- **Negative:** rotating `SESSION_SECRET` ends every app session (provider sessions survive but
  cannot be unsealed). Documented.
- **Negative:** no server-side list of active app sessions. Provider revocation is authoritative
  at the next refresh, up to one token lifetime (15 minutes) plus cache (10 minutes).
- **Risk:** public sign-up is enabled by default at the provider. Access control is the
  provisioning gate; enable email verification and restrict sign-up before go-live.

## Verification

- Unit tests (`packages/auth/src/neon-auth.test.ts`) sign EdDSA tokens with a local key and prove:
  valid token accepted; expired, wrong issuer, tampered, and wrong-key tokens rejected; sign-in
  extracts the cookie and JWT; provider 401 maps to a generic 401.
- `packages/auth/src/session-cookie.test.ts` proves the sealed cookie round-trips and rejects
  another secret or tampering.
- Live smoke (`pnpm --filter @cls/auth smoke`) confirms the JWKS advertises an Ed25519 key, an
  unknown sign-in returns 401 `INVALID_EMAIL_OR_PASSWORD`, and a token signed with a random key is
  rejected by the live JWKS. No real user is created by this check.
- Permission resolution is unit-tested for role defaults, user grants, expiry and scoped WSIB.
