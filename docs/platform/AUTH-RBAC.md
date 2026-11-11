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

**Public sign-up is disabled** on the `production` branch:
`neonctl neon-auth config email-password get` reports `Disable Sign Up: true`, and a sign-up
attempt returns `400 EMAIL_PASSWORD_SIGN_UP_DISABLED`. An account therefore exists only because
an administrator created it. Creating a Neon Auth identity still grants nothing: the person also
needs a linked `app.users` row with a role.

### 3.1 Invite (create the provider identity)

Preferred, via the Better Auth admin API. Sign in once as an existing admin to obtain the admin
session cookie, then create the user:

```bash
BASE="$NEON_AUTH_BASE_URL"          # e.g. https://ep-xxx.neonauth.../neondb/auth
ORIGIN="$APP_URL"

# 1. Admin session (cookie stays in this shell only)
COOKIE=$(curl -sS -D - -o /dev/null -X POST "$BASE/sign-in/email" \
  -H "content-type: application/json" -H "origin: $ORIGIN" \
  --data "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" \
  | sed -n 's/^set-cookie: \([^;]*\).*/\1/ip' | paste -sd'; ' -)

# 2. Create the invitee with a one-time password
curl -sS -X POST "$BASE/admin/create-user" \
  -H "content-type: application/json" -H "origin: $ORIGIN" -H "cookie: $COOKIE" \
  --data '{"email":"new.user@example.com","password":"<one-time>","name":"New User"}'
```

The CLI equivalent creates the identity **without a password**:
`neonctl neon-auth user create --email new.user@example.com --name "New User"`. Use the Console to
set the first password, or the admin API above.

Mark the address verified before an invited `app.users` row can be linked by email. The CLI and
admin API both create `emailVerified=false`. Set it in the Neon Console, or as a break-glass step:

```sql
update neon_auth."user" set "emailVerified" = true, "updatedAt" = now()
 where lower(email) = 'new.user@example.com';
```

### 3.2 First sign-in and app row

| Situation | Result |
|---|---|
| `sub` already linked | normal sign-in |
| verified email matches a pre-created `app.users` row with no `neon_user_id` | row is linked on first sign-in |
| unverified email matches an invited row | refused; verification required before linking |
| email matches `SEED_ADMIN_EMAIL`, `emailVerified=true`, no row | admin row created (only automatic provisioning path) |
| no match | `403`, audited as `auth.login_denied` |
| row exists but `is_enabled=false` | `403`, audited as `auth.login_failed` |
| row linked to a different `sub` | `401`, audited as `auth.login_denied` |

Until the Admin module ships, create the app row directly (or extend `packages/db/src/seed.ts`):

```sql
insert into app.users (email, username, display_name, role)
values ('new.user@example.com', 'newuser', 'New User', 'technician')
on conflict (email) do nothing;
```

The first successful sign-in binds `neon_user_id`, writes `auth.login`, and the user appears in the
shell with that role's grants.

### 3.3 Role assignment and grants

- **Role** — one of `admin`, `technician`, `subcontractor`, `supplier` on `app.users.role`.
  Change it in the Admin module (or SQL during transition); the next request re-evaluates.
- **Per-user grant or deny** — one row in `app.user_permissions` with `permission_key`,
  `is_allowed`, optional `expires_at` and `scope_subcontractor_id`. Use a deny to remove a default
  grant from one person without inventing a role.
- **Provider admin flag** — `admin` in `neon_auth."user".role` only controls the provider's admin
  API (`/admin/*`), not application permissions. Keep it for the one or two platform operators;
  application admins do not need it.

### 3.4 Disabling a user

Do both, in this order:

1. App: `update app.users set is_enabled = false, updated_at = now() where email = '...';`
2. Provider: `POST {NEON_AUTH_BASE_URL}/admin/ban-user` with the admin cookie and
   `{"userId":"<id>","banReason":"left company"}`, then revoke sessions with
   `POST /admin/revoke-user-sessions` `{"userId":"<id>"}`.

Step 1 blocks the app immediately; step 2 stops new provider sessions. Never delete the person's
audit history; `app.users` rows are referenced by `app.audit_log` with `on delete set null`.

### 3.5 Forced password reset

1. Sign in as an admin and call `POST {NEON_AUTH_BASE_URL}/admin/set-user-password` with
   `{"userId":"<id>","newPassword":"<one-time>"}`. The endpoint requires the admin session cookie
   and `Origin: APP_URL`.
2. The user signs in with the one-time password and changes it through Neon Auth.
3. Optionally set `--revoke-sessions-on-password-reset` on the provider so a reset ends every
   existing device session.

The provider CLI has no set-password command; the Console or the admin API is the supported path.

### 3.6 The first administrator

`developer@tin.info` is the first admin on the `production` branch:

- Neon Auth user id `283f66b8-1f20-4422-b813-b75af38d42ec`, provider role `admin`,
  `emailVerified=true`.
- `app.users` row: username `admin`, role `admin`, linked on first sign-in.
- `SEED_ADMIN_EMAIL=developer@tin.info` in the host `.env`.

The generated password is **not** in git, the docs or this report. It lives on the server host at
`.secrets/neon-auth-admin.txt` (mode `600`, directory mode `700`, ignored by `.gitignore`). Rotate it
with §3.5, then overwrite that file and verify one sign-in. Never copy it into `docs/`, a commit,
or a shared folder.

---

## 4. Roles

Four roles on `app.users.role`: `admin`, `technician`, `subcontractor`, `supplier`.
`users.legacy_access` preserves the legacy numeric level for reconciliation only; it is never
consulted for authorization.

---

## 5. Permission matrix (role defaults)

39 permissions, 54 role grants. Generated from `packages/core/src/permissions.ts`.

| Permission | Module | Admin | Technician | Subcontractor | Supplier |
|---|---|---|---|---|---|
| `workorder:read` | workorder | yes | yes | yes | – |
| `workorder:write` | workorder | yes | yes | – | – |
| `workorder:approve` | workorder | yes | – | – | – |
| `workorder:override_wsib_hold` | workorder | yes | – | – | – |
| `workorder:dispatch` | workorder | yes | – | – | – |
| `workorder:capture` | workorder | yes | yes | yes | – |
| `quote:read` | quote | yes | yes | yes | – |
| `quote:write` | quote | yes | yes | – | – |
| `quote:approve` | quote | yes | – | – | – |
| `purchasing:read` | purchasing | yes | yes | – | yes |
| `purchasing:write` | purchasing | yes | yes | – | – |
| `purchasing:approve` | purchasing | yes | – | – | – |
| `po.approve` | purchasing | – | – | – | – |
| `po.issue` | purchasing | – | – | – | – |
| `inventory:read` | inventory | yes | yes | – | yes |
| `inventory:write` | inventory | yes | – | – | – |
| `inventory:adjust` | inventory | yes | – | – | – |
| `inventory:edit_price` | inventory | yes | – | – | – |
| `invoice:read` | invoice | yes | yes | yes | – |
| `invoice:write` | invoice | yes | – | – | – |
| `invoice:issue` | invoice | yes | – | – | – |
| `invoice.calculate` | invoice | yes | – | – | – |
| `invoice.post_sage` | invoice | – | – | – | – |
| `tjx:read` | tjx | yes | yes | – | – |
| `tjx:write` | tjx | yes | yes | – | – |
| `compliance:read` | compliance | yes | yes | – | – |
| `compliance:write` | compliance | yes | – | – | – |
| `pma.certificate.download` | compliance | – | – | – | – |
| `customer:read` | customer | yes | yes | yes | – |
| `customer:write` | customer | yes | – | – | – |
| `subcontractor.rates.download` | customer | – | – | – | – |
| `reports:read` | reports | yes | yes | – | – |
| `report.download_rates` | reports | – | – | – | – |
| `admin:users` | admin | yes | – | – | – |
| `admin:audit` | admin | yes | – | – | – |
| `admin:settings` | admin | yes | – | – | – |
| `sage:read` | sage | yes | – | – | – |
| `sage:sync` | sage | yes | – | – | – |
| `sage:write` | sage | yes | – | – | – |

`inventory:edit_price` replaces the legacy `user_permissions_price_management` table.
`workorder:override_wsib_hold` replaces `user_permissions_without_wsib_insurance`.

### 5.1 Invoice authorization: an accepted widening of financial control

The legacy calculator gate was **not** a role. Roughly twenty files compared the session username
against two hard-coded names — `carmen` and `ASzpytka` — plus `$PowerUserName = 'ASzpytka'` in
`session.php:27`. Of the 13 admin-level legacy users, only those two could calculate an invoice,
post it to Sage, issue/approve a PO, download rate sheets or a PMA certificate.

The rebuild replaces the names with capabilities:

| Legacy behaviour | Rebuild |
|---|---|
| `carmen` or `ASzpytka` may run the invoice calculator | `invoice.calculate` |
| `ASzpytka` may transfer a calculated invoice to Sage | reserved `invoice.post_sage` |
| hard-coded PO issue / approval checks | reserved `po.issue`, `po.approve` |
| hard-coded rate-sheet download | reserved `report.download_rates`, `subcontractor.rates.download` |
| hard-coded PMA certificate download | reserved `pma.certificate.download` |

**Decision:** `invoice.calculate` is granted to **every application admin** (33 of 39 permissions
for that role). This is a deliberate widening: legacy allowed 2 of 13 admin-level users to invoice;
the rebuild allows all admins. It is accepted as a change in financial control because admin is
now an explicit, audited grant that can be denied per user with `app.user_permissions.is_allowed =
false`, and every use records the permission key. The six `*.*` keys other than
`invoice.calculate` are reserved with **no default role grant**; their modules decide who gets them
and can scope them.

There is no separate `super_admin` role in the rebuild. The legacy super-admin accounts are
application `admin` users, so mapping `invoice.calculate` to `admin` covers them without adding a
fifth role. Adding one later is a schema and seed change, not a permission change.

**Legacy quirk worth remembering while mapping the remaining names:** `editsubcontractor.php:103`
gates on `($user_login == 'carmen' || $user_login <> '')`. The second clause is true for every
logged-in user, so that restriction never worked; every authenticated user could pass it. Treat the
vendor-edit route as ungated in the legacy behaviour map, and use `subcontractor.rates.download`
for the actual rate download rather than copying the broken check.

---

## 6. Per-user grants

`app.user_permissions` is the single override store, replacing both legacy permission tables.

| Column | Meaning |
|---|---|
| `user_id` | application user |
| `permission_key` | one of the 39 keys |
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
| `auth.permission_denied` | a server function rejected a caller for a missing permission |
| module events | written by the module in its transaction |

Every financial or otherwise sensitive audit row must record the **permission checked**, not a
username: pass `permission: '<key>'` to `writeAudit`, which stores it under
`after.permission`. The actor columns still identify who acted; the decision itself is expressed as
a capability.

```ts
await writeAudit(tx, {
  action: 'invoice.calculate',
  actorUserId: session.user.id,
  actorRole: session.user.role,
  entityType: 'invoice',
  entityId: String(invoiceId),
  permission: 'invoice.calculate',
  summary: 'Calculated invoice totals',
})
```

`permissionMiddleware` writes `auth.permission_denied` with the same `after.permission` value
before throwing `403`, so a denial is queryable:

```sql
select created_at, actor_label, after->>'permission' as permission
  from app.audit_log
 where action = 'auth.permission_denied'
 order by id desc
 limit 20;
```

Never write passwords, tokens, JWTs or provider cookies to the audit row. Log the action, actor,
entity, permission, summary and request metadata only.

---

## 9. Verification

- `packages/auth/src/neon-auth.test.ts`: EdDSA valid/expired/wrong-issuer/tampered/wrong-key;
  sign-in extraction; provider 401 mapping.
- `packages/auth/src/session-cookie.test.ts`: seal/unseal, wrong secret, tampering.
- `packages/auth/src/permissions.test.ts`: role defaults, grant, deny, expiry, scoped WSIB, the
  `invoice.calculate` matrix (admins only) and the six reserved keys (no default grants).
- `packages/auth/src/rate-limit.test.ts`: window and retry.
- Live: JWKS 200 with one Ed25519 key; unknown sign-in 401 `INVALID_EMAIL_OR_PASSWORD`; a
  locally-signed token rejected by the live JWKS.
- Live sign-up: `400 EMAIL_PASSWORD_SIGN_UP_DISABLED` after `--disable-sign-up`.
- Live admin sign-in for `developer@tin.info`: provider 200, `/get-session` 200, JWT
  `emailVerified=true`; the app row links on first sign-in.
- `pnpm test:e2e`: **9 passed**, including the real signed-in flow (sign in → dashboard → sign out
  → login) and the sealed `cls_session` cookie check.
- Database: 39 permission definitions, 54 role grants; `invoice.calculate` is held by `admin`
  only; the six reserved keys have zero grants.

---

## 10. Known limits

- No MFA. Neon Auth supports more providers; adopting them is a provider setting plus UI.
- No app-side session list or "revoke other sessions". Provider revocation takes effect at the
  next token refresh (≤ 15 minutes + cache).
- Rotating `SESSION_SECRET` ends every app session.
- Rate limiting is in-memory and per process.
- Public sign-up is **disabled**; provisioning is administrator-only. Email verification is not
  required at sign-in (`Require Verification: false`), but an invited row is linked by email only
  when the provider marks the address verified. Keep that rule: re-enabling sign-up without it
  would let anyone claim an invited address.
- The provider admin API needs an existing admin session cookie. There is no standalone CLI
  command to set a password, verify an email, ban a user or revoke sessions; use the admin
  endpoints in §3 or the Neon Console.
- No separate `super_admin` role. Application `admin` covers the legacy super-admin accounts.
