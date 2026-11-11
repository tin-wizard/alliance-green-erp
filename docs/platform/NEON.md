# Neon services — wiring, credentials and offline behaviour

**Project:** `Alliance` (`icy-leaf-84310790`), org `org-snowy-cloud-31770549`
**Branch:** `production` (`br-summer-pine-beb488ef`), region `aws-us-east-2`
**Declared in:** `neon.ts` (auth, AI gateway, `assets` bucket) and the Neon console
(`accounting` bucket)
**Local context:** `.neon` (gitignored)
**Credentials:** `.env` (gitignored), populated with `neon env pull`; never committed.

---

## 1. Services at a glance

| Service | State | Wired through |
|---|---|---|
| Postgres | Provisioned, schema applied, seed catalogue loaded, **no business data** | `@cls/db` → `postgres.js` |
| Neon Auth (Managed Better Auth) | Provisioned, JWKS live, no app users yet | `@cls/auth` → REST + `jose` |
| Object Storage | Two private buckets reachable, put/get/delete verified | `@cls/storage` → AWS S3 SDK |
| AI Gateway | Endpoint and model catalogue reachable, **inference blocked: `credits_required`** | `@cls/ai`, feature-flagged off |

---

## 2. Environment variables

`neon env pull --file .env` writes the first block; the rest are app settings.

| Variable | Used for | Notes |
|---|---|---|
| `DATABASE_URL` | runtime Postgres | pooled (`-pooler`), `prepare: false` |
| `DATABASE_URL_UNPOOLED` | migrations, DDL | direct connection; used by `drizzle.config.ts` and `pnpm db:migrate` |
| `NEON_AUTH_BASE_URL` | sign-in, `/get-session`, JWKS base | browser never sees it |
| `NEON_AUTH_JWKS_URL` | JWT verification | EdDSA / Ed25519 |
| `AWS_ENDPOINT_URL_S3` | branch-scoped S3 endpoint | `forcePathStyle: true` |
| `AWS_ACCESS_KEY_ID` | S3 credential (`token_id`) | storage read+write |
| `AWS_SECRET_ACCESS_KEY` | S3 secret | never logged |
| `AWS_REGION` | S3 signing region | `us-east-2` |
| `S3_BUCKET` | operational files | default `assets` |
| `S3_ACCOUNTING_BUCKET` | generated financial PDFs | default `accounting` |
| `STORAGE_DRIVER` | `auto` / `s3` / `local` | `auto` falls back to local when credentials are absent |
| `STORAGE_LOCAL_DIR` | local fallback root | default `.data/storage` |
| `AI_ENABLED` | feature flag | **false** |
| `NEON_AI_GATEWAY_BASE_URL` | chat/models base | no trailing `/v1` |
| `NEON_AI_GATEWAY_TOKEN` | gateway credential | `ai_gateway:invoke` |
| `AI_DEFAULT_MODEL` | default model id | `claude-haiku-4-5` |
| `SESSION_SECRET` | seals the app cookie (AES-256-GCM) | 32+ chars; rotating it ends app sessions |
| `SESSION_TTL_HOURS` | app session cap | default 12 |
| `APP_URL` | public app origin | **must be a trusted domain in Neon Auth** |
| `SEED_ADMIN_EMAIL` | optional bootstrap admin | no default; requires a verified Neon email |

`SEED_ADMIN_EMAIL` is deliberately unset. A default address would let anyone who signs up with
it claim the admin row. Set it to a real address you control, enable email verification in Neon
Auth, and sign in once.

---

## 3. Postgres

**Runtime:** pooled `DATABASE_URL`, `prepare: false` (PgBouncer transaction mode), TLS verified
against the system CA (`sslmode=require` is treated as verify-full).
**Migrations:** `DATABASE_URL_UNPOOLED`; DDL never goes through the pooler.

Applied to `production` on 2026-11-11:

```
pnpm db:migrate   → "Migrations applied" (30 s for the full schema)
pnpm db:seed      → 30 permissions, 49 role grants
                  → SEED_ADMIN_EMAIL unset; no admin row created
```

Verified counts:

| Check | Result |
|---|---|
| `public` tables (legacy mirror) | **171** |
| `public` columns | **1,509** |
| `public` NOT NULL columns | **465** |
| `public` primary keys | **168** |
| `public` secondary indexes | **53** |
| `public` unique constraints (non-PK) | **5** |
| `public` enum types | **17** |
| `app` tables | **5** (46 columns) |
| Business rows loaded | **0** |

The 175-table contract reconciles as 171 mirrored + 4 do-not-carry tables; see
`platform/DATA-LAYER.md`.

---

## 4. Neon Auth

**What it owns:** users, password hashes, email verification, OAuth, sessions, JWTs, JWKS.

**How the app uses it:**

1. `POST {NEON_AUTH_BASE_URL}/sign-in/email` from our server with `Origin: APP_URL`.
2. The provider returns a session cookie and, usually, a `set-auth-jwt` header. If the header is
   missing, `GET /get-session` with the cookie supplies the JWT.
3. The JWT is verified with `jose`: EdDSA, issuer and audience = origin of `NEON_AUTH_BASE_URL`,
   expiry, `sub` present.
4. Our HttpOnly `cls_session` cookie carries the provider session cookie plus the JWT, sealed with
   AES-256-GCM under `SESSION_SECRET`. When the JWT expires (15 min), the server refreshes it via
   `/get-session`; a 10-minute cache avoids a call per request.
5. `sub` maps to `app.users.neon_user_id`. A verified email may link an invited row. Anyone
   without a linked row is refused and audited (`auth.login_denied`).

**Trusted domains:** the app origin must be registered in Neon Auth, otherwise sign-in returns
`INVALID_ORIGIN`. `http://localhost:3000` is trusted in this project. For a LAN address, run:

```bash
neon neon-auth domain add http://192.168.1.50:3000
```

**Access control:** Neon allows public sign-up by default. The provisioning gate — a linked
`app.users` row — is the control. Enable email verification before go-live, and disable open
sign-up if the provider exposes that setting.

**Live checks performed:**

```
GET  {NEON_AUTH_JWKS_URL}            → 200, 1 key, OKP/Ed25519/EdDSA
POST /sign-in/email (unknown user)   → 401 {"code":"INVALID_EMAIL_OR_PASSWORD"}
JWT signed with a random EdDSA key   → rejected by the live JWKS
```

No test user was created. End-to-end sign-in requires a provisioned Neon user; create it in the
Neon Console or via the Auth API, then set `SEED_ADMIN_EMAIL` if it is the bootstrap admin.

**Offline behaviour:** a user with an unexpired JWT keeps working without Neon. Once it expires,
the refresh fails and the session middleware returns `null`, redirecting to `/login`. No provider,
no new sign-in.

---

## 5. Object storage

**Buckets:** `assets` (operational) and `accounting` (generated financial PDFs), both private.
**Endpoint:** branch-scoped `https://br-summer-pine-beb488ef.storage.c-9.us-east-2.aws.neon.tech`.
**Driver:** `@aws-sdk/client-s3`, `forcePathStyle: true`.

Verified on 2026-11-11 (`pnpm --filter @cls/storage smoke`):

| Bucket | HEAD | put | get | signed URL | delete |
|---|---|---|---|---|---|
| `assets` | ok (513 ms) | 41 bytes, ETag | 41 bytes, byte-for-byte match | issued | confirmed gone |
| `accounting` | ok (391 ms) | 41 bytes, ETag | 41 bytes, byte-for-byte match | issued | confirmed gone |

**Key layout** (also in ADR 0009):

```
workorders/<woid>/photos/<uuid>.<ext>
workorders/<woid>/documents/<uuid>-<filename>
customers/<customerId>/documents/...
suppliers/<supplierId>/documents/...
subcontractors/<subId>/compliance/...
generated/<kind>/<yyyy>/<mm>/<uuid>.pdf      → accounting bucket
quarantine/<uuid>-<filename>
```

**Credential lineage:** a credential created on `production` works on that branch and its
descendants, not on a sibling branch from another lineage. A preview branch needs its own
credential or `neon env pull` on that branch.

**Offline behaviour:** `STORAGE_DRIVER=auto` with no `AWS_*` credentials writes under
`.data/storage/<bucket>`. Signed URLs return `null`; the document module must stream through an
authenticated route in local mode.

---

## 6. AI Gateway

Verified on 2026-11-11:

```
GET  {NEON_AI_GATEWAY_BASE_URL}/v1/models             → 200, catalogue returned
POST {NEON_AI_GATEWAY_BASE_URL}/v1/chat/completions   → 403
{"error":{"message":"AI Gateway credits required. Add credits to continue.",
          "unavailable_reason":"credits_required"}}
```

`AI_ENABLED=false`. `chat()` throws `AiUnavailableError`; `aiHealth()` reports `disabled`.
Nothing in the app fabricates a model response. Enabling it is a billing step plus
`AI_ENABLED=true`; no code change.

---

## 7. Operational checks

| Check | Command / endpoint |
|---|---|
| All services | `GET /api/health` |
| Database readiness | `GET /api/ready` (503 when unreachable) |
| Process liveness | `GET /healthz` |
| Live auth | `pnpm --filter @cls/auth smoke` |
| Live storage | `pnpm --filter @cls/storage smoke` |
| Schema counts | SQL in `platform/DATA-LAYER.md` §9 |
| Migrations | `pnpm db:migrate` (direct URL) |

---

## 8. Known gaps

- No business data. The 77 InnoDB tables with unrecoverable rows are definitions only.
- No production app user yet; sign-in is implemented but untested end-to-end against a real Neon
  identity.
- AI inference is unfunded.
- Neon Auth's public sign-up remains enabled; the provisioning gate protects the app, but
  verification should be turned on before go-live.
- The Sage business sync (reads/writes) is still the Sage module's work; discovery and connection
  verification are done.
