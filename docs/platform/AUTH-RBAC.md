# Auth and RBAC — Neon Auth for identity, our layer for authorization

**Status:** implemented and enforcing. Neon Auth owns credentials and sessions; this repo owns
roles, permissions and audit.
**See also:** ADR 0004, `platform/NEON.md`.

---

## 1. Three identity layers

| Layer | Owner | Where |
|---|---|---|
| Credentials, password reset, email verification, OAuth, provider sessions, JWTs | **Neon Auth** | `neon_auth` schema |
| Application profile, role, enablement, legacy mapping | **Us** | `app.users` |
| Granular grants and audit | **Us** | `app.user_permissions`, `app.audit_log` |

There is **no password column and no hashing code** in this repository. A migrated user sets a
password through Neon Auth at cutover; the legacy MD5 value is never accepted.

---

## 2. Sign-in and session flow

```
browser                our server                         Neon Auth
  │  identifier+password   │                                   │
  ├───────────────────────▶│  resolve email (username→email)    │
  │                        ├──── POST /sign-in/email ─────────▶│
  │                        │◀── session cookie + JWT ──────────┤
  │                        │  verify JWT against JWKS          │
  │                        │  map sub → app.users              │
  │                        │  seal cookie, write audit         │
  │◀── cls_session ────────┤                                   │
  │                        │                                   │
  │  later request          │                                   │
  ├───────────────────────▶│  unseal → verify JWT              │
  │                        │  expired? GET /get-session ───────▶│
  │                        │  load role + grants               │
  │◀── page / 401 ─────────┤                                   │
```

- The browser never talks to Neon Auth and never receives the provider URL or token.
- The login form accepts an email **or** a legacy username. A username is resolved to its
  `app.users.email` before calling the provider.
- Sign-in failures are generic (`Invalid username or password.`). Rate limit: 10 attempts per
  15 minutes per IP + identifier, in memory (single process).
- `cls_session` is `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` when
  `SESSION_COOKIE_SECURE=true`, `Max-Age = SESSION_TTL_HOURS`. It holds the provider session cookie
  and the current JWT, sealed with AES-256-GCM under `SESSION_SECRET`.
- JWT verification: EdDSA only, issuer + audience = origin of `NEON_AUTH_BASE_URL`, expiry with a
  5-second tolerance, `sub` required.
- Provider JWTs live 15 minutes. The server refreshes through `/get-session` and caches the result
  for 10 minutes. The app session cap is 12 hours.
- Logout calls the provider's `/sign-out` (best effort), writes `auth.logout`, and clears the
  cookie.

**Trusted origin:** `APP_URL` must be registered in Neon Auth (`neon neon-auth domain add …`).
Otherwise sign-in returns `INVALID_ORIGIN`. The server sends `Origin: APP_URL` on the provider
call, which Better Auth requires.

---

## 3. Provisioning users

Neon Auth allows public sign-up by default. Signing up does **not** grant access: the person also
needs a linked `app.users` row.

| Situation | Result |
|---|---|
| `sub` already linked | normal sign-in |
| verified email matches a pre-created `app.users` row with no `neon_user_id` | row is linked on first sign-in |
| unverified email matches an invited row | refused; verification required before linking |
| email matches `SEED_ADMIN_EMAIL`, `emailVerified=true`, no row | admin row created (only automatic provisioning path) |
| no match | `403`, audited as `auth.login_denied` |
| row exists but `is_enabled=false` | `403`, audited as `auth.login_failed` |
| row linked to a different `sub` | `401`, audited as `auth.login_denied` |

Bootstrap for a new install:

1. Create the identity in Neon Auth (Console or Auth API) with a real address you control.
2. Enable email verification in Neon Auth and verify that address.
3. Set `SEED_ADMIN_EMAIL` to it, run `pnpm db:seed`, then sign in once to link and create the
   admin row. `SEED_ADMIN_EMAIL` has no default on purpose.

Administrators will be able to invite users (create `app.users` rows with role + email) when the
Admin module lands. Until then, insert rows directly or extend the seed.

---

## 4. Roles

Four roles on `app.users.role`: `admin`, `technician`, `subcontractor`, `supplier`.
`users.legacy_access` preserves the legacy numeric level for reconciliation only; it is never
consulted for authorization.

---

## 5. Permission matrix (role defaults)

30 permissions, 49 role grants. Generated from `packages/core/src/permissions.ts`.

| Permission | Module | Admin | Technician | Subcontractor | Supplier |
|---|---|---|---|---|---|
| `workorder:read` | workorder | yes | yes | yes | – |
| `workorder:write` | workorder | yes | yes | – | – |
| `workorder:approve` | workorder | yes | – | – | – |
| `workorder:override_wsib_hold` | workorder | yes | – | – | – |
| `quote:read` | quote | yes | yes | yes | – |
| `quote:write` | quote | yes | yes | – | – |
| `quote:approve` | quote | yes | – | – | – |
| `purchasing:read` | purchasing | yes | yes | – | yes |
| `purchasing:write` | purchasing | yes | yes | – | – |
| `purchasing:approve` | purchasing | yes | – | – | – |
| `inventory:read` | inventory | yes | yes | – | yes |
| `inventory:write` | inventory | yes | – | – | – |
| `inventory:adjust` | inventory | yes | – | – | – |
| `inventory:edit_price` | inventory | yes | – | – | – |
| `invoice:read` | invoice | yes | yes | yes | – |
| `invoice:write` | invoice | yes | – | – | – |
| `invoice:issue` | invoice | yes | – | – | – |
| `tjx:read` | tjx | yes | yes | – | – |
| `tjx:write` | tjx | yes | yes | – | – |
| `compliance:read` | compliance | yes | yes | – | – |
| `compliance:write` | compliance | yes | – | – | – |
| `customer:read` | customer | yes | yes | yes | – |
| `customer:write` | customer | yes | – | – | – |
| `reports:read` | reports | yes | yes | – | – |
| `admin:users` | admin | yes | – | – | – |
| `admin:audit` | admin | yes | – | – | – |
| `admin:settings` | admin | yes | – | – | – |
| `sage:read` | sage | yes | – | – | – |
| `sage:sync` | sage | yes | – | – | – |
| `sage:write` | sage | yes | – | – | – |

`inventory:edit_price` replaces the legacy `user_permissions_price_management` table.
`workorder:override_wsib_hold` replaces `user_permissions_without_wsib_insurance`.

---

## 6. Per-user grants

`app.user_permissions` is the single override store, replacing both legacy permission tables.

| Column | Meaning |
|---|---|
| `user_id` | application user |
| `permission_key` | one of the 30 keys |
| `is_allowed` | true = grant, false = explicit deny |
| `expires_at` | NULL = never; otherwise ignored after this instant |
| `scope_subcontractor_id` | for the WSIB override: a Sage vendor id; NULL = global |
| `granted_by`, `granted_at`, `note` | provenance |

Evaluation (`packages/auth/src/permissions.ts`, pure and unit-tested):

1. Start from role defaults.
2. An unexpired user grant adds the permission.
3. An unexpired explicit deny removes it.
4. An expired row is ignored entirely.
5. An explicit deny beats a role grant.
6. A scoped grant applies only to its vendor id; a global grant applies to all.

---

## 7. Enforcement

**Server functions are the boundary.** A route `beforeLoad` redirect is UX only.

```ts
// read-only
createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => { /* context.session is non-null */ })

// permissioned write
createServerFn({ method: 'POST' })
  .middleware([permissionMiddleware('workorder:write')])
  .handler(async ({ context, data }) => { /* ... */ })

// scoped (WSIB override)
assertScopedPermission(context.session, 'workorder:override_wsib_hold', vendorId)
```

- `authMiddleware` loads and verifies the session, then requires it.
- `permissionMiddleware(key)` adds the permission check.
- `assertPermission` / `assertScopedPermission` cover handlers where the resource is loaded after
  the check.
- Thrown `AppError`s carry 401/403/409/422/503; Start derives the response status.
- `/api/ready` and `/api/health` are intentionally unauthenticated; they expose no business data.

---

## 8. Audit

`app.audit_log` is append-only. `writeAudit(tx, event)` is called with the same transaction as the
business change, so a rollback removes both.

| Event | When |
|---|---|
| `auth.login` | successful sign-in |
| `auth.login_failed` | bad credentials, unknown username, disabled account, provider error |
| `auth.login_denied` | authenticated at Neon but not provisioned, or identity mismatch |
| `auth.logout` | sign-out |
| module events | written by the module in its transaction |

Never write passwords, tokens, JWTs or provider cookies to the audit row. Log the action, actor,
entity, summary and request metadata only.

---

## 9. Verification

- `packages/auth/src/neon-auth.test.ts`: EdDSA valid/expired/wrong-issuer/tampered/wrong-key;
  sign-in extraction; provider 401 mapping.
- `packages/auth/src/session-cookie.test.ts`: seal/unseal, wrong secret, tampering.
- `packages/auth/src/permissions.test.ts`: role defaults, grant, deny, expiry, scoped WSIB.
- `packages/auth/src/rate-limit.test.ts`: window and retry.
- Live: JWKS 200 with one Ed25519 key; unknown sign-in 401 `INVALID_EMAIL_OR_PASSWORD`; a
  locally-signed token rejected by the live JWKS.
- End-to-end sign-in with a **real** Neon user is still to be exercised; no user was created by
  the platform scaffold.

---

## 10. Known limits

- No MFA. Neon Auth supports more providers; adopting them is a provider setting plus UI.
- No app-side session list or "revoke other sessions". Provider revocation takes effect at the
  next token refresh (≤ 15 minutes + cache).
- Rotating `SESSION_SECRET` ends every app session.
- Rate limiting is in-memory and per process.
- Public sign-up is enabled at the provider; the provisioning gate protects access, but email
  verification should be mandatory before go-live.
