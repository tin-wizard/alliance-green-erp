# CLS Green ERP — Architecture

**Status:** foundation scaffold, bootable, Neon services wired. Work Orders is the first module.
**Repository:** `/Users/gene/Projects/cls-green-erp`
**Audience:** module agents, the platform owner, whoever runs the LAN server.

This document describes the new system's shape. It deliberately does not restate the legacy
analysis; see the cartographer's `green-system/*.md` in the workstream shared folder for that.

---

## 1. Deployment shape

```
LAN browsers
    │  HTTP (no public ingress)
    ▼
┌───────────────────────── Windows or Linux host (same machine as Sage 50) ─────────┐
│  node scripts/start.mjs  →  apps/web/.output/server/index.mjs                     │
│      ├── TanStack Start (SSR + server functions + server routes)                   │
│      ├── @cls/auth  → Neon Auth (HTTPS)  sign-in, /get-session, JWKS               │
│      ├── @cls/db    → postgres.js → Neon Postgres (TLS verify-full, pooled)        │
│      ├── @cls/sage  → MySQL 127.0.0.1:13541…13544 → Sage 50 `simply` (same host)   │
│      ├── @cls/storage → Neon Object Storage (S3 API) or local filesystem           │
│      ├── @cls/ai    → Neon AI Gateway (wired, disabled: no credits)                │
│      └── static assets from apps/web/.output/public                                │
└───────────────────────────────────────────────────────────────────────────────────┘
```

- One Node process. No Docker requirement in production, no Vercel, no Cloudflare.
- Outbound HTTPS to Neon is required for Postgres, Neon Auth and object storage. There is no
  public ingress.
- The app should run on the same host as Sage 50, because the Sage adapter preserves the legacy
  localhost MySQL probe.
- Identity lives in Neon Auth; business state lives in Postgres. A restart does not sign anyone
  out while the app cookie and provider session are valid.
- `HOST=0.0.0.0` exposes the port to the LAN. Firewall scope is the local subnet.

Runtime: Node.js 22.12+ (24 LTS tested), pnpm 12, built with Vite 8 and Nitro's `node-server`
preset.

---

## 2. Repository map

```
cls-green-erp/
├─ apps/web/                     TanStack Start application
│  ├─ src/routes/                file routes + server routes (routeTree.gen.ts is generated)
│  ├─ src/shell/                 sidebar, top bar, page header, navigation registry
│  ├─ src/server/                server functions + server-only implementations
│  ├─ src/modules/<module>/      module UI, nav registration, server modules
│  └─ src/styles/app.css         Tailwind + THEME SEAM (@theme inline mapping)
├─ packages/
│  ├─ core/                      env, errors, logger, status vocabulary, permissions
│  ├─ db/                        Drizzle schema slices, client, migrations, seed
│  ├─ auth/                      Neon Auth client, JWT verification, sealed cookie, RBAC, audit
│  ├─ sage/                      Sage 50 adapter: MySQL sentinel discovery + connection
│  ├─ storage/                   object storage adapter: Neon S3 + local fallback
│  ├─ ai/                        Neon AI Gateway seam (feature-flagged off)
│  └─ ui/                        design tokens (adopted) + cn()
├─ docs/adr/                     decision records 0001-0010
├─ docs/platform/                these operating documents
├─ e2e/                          Playwright against the production build
├─ neon.ts                       Neon service declaration (auth, AI, buckets)
└─ scripts/start.mjs             production entry: loads .env, starts Nitro output
```

### Dependency direction (one-way)

```
apps/web ──> @cls/auth ──> @cls/db ──> @cls/core
    │            │            │
    ├──> @cls/sage ───────────┘
    ├──> @cls/storage ────────┘
    ├──> @cls/ai ─────────────┘
    └──> @cls/ui
```

- `@cls/core` imports only `zod`. Client-safe.
- `@cls/db` imports `@cls/core`, `drizzle-orm`, `postgres`. Server only.
- `@cls/auth` imports `@cls/core`, `@cls/db`, `jose`. Server only.
- `@cls/sage` imports `@cls/core`, `mysql2`. Server only.
- `@cls/storage` imports `@cls/core`, the AWS S3 SDK. Server only.
- `@cls/ai` imports `@cls/core`. Server only in practice (token).
- `@cls/ui` has no runtime dependencies and no React components yet.
- No package imports `apps/web`. No cycles.

Workspace packages export TypeScript source (`./src/index.ts`). Vite compiles them; there is no
separate package build.

---

## 3. Application layers

### 3.1 Routes (UX and composition)

- File-based TanStack Router. `src/routeTree.gen.ts` is generated and committed; never edit it.
- Authenticated routes live under the `_app` pathless layout, which loads the session and renders
  the shell.
- `beforeLoad` guards are **UX only**. Every server function enforces its own auth and permission.
- Error, not-found and loading boundaries are defined at the root and at the authenticated layout.

### 3.2 Server functions (the security and data boundary)

- Defined in `apps/web/src/server/*.functions.ts` (or module `server/` folders).
- Each imports a server-only implementation (`*.server.ts`) **inside the handler** via dynamic
  `import()`, and middleware from a client-safe module.
- Every data-touching function declares `authMiddleware` and, where relevant,
  `permissionMiddleware('<key>')`.
- Thrown `AppError`s carry an HTTP `status`; TanStack derives the response status from
  `error.status` (401, 403, 409, 422, 503).
- The client bundle contains RPC stubs, not implementations.

Why the dynamic import ceremony is mandatory: the Start compiler replaces handler bodies in the
client bundle, but **module-scope imports are not removed**. A top-level `import '@cls/db'` in a
client-reachable file would pull the driver into the browser build (or fail the build through
import protection). The pattern is documented in `MODULE-CONTRACT.md`.

### 3.3 Server routes (HTTP endpoints)

- `src/routes/api/health.ts` → `GET /api/health` (200, per-service detail)
- `src/routes/api/ready.ts` → `GET /api/ready` (200/503 readiness; database is the gate)
- `src/routes/healthz.ts` → `GET /healthz` (liveness, no dependencies)
- Future file/PDF downloads and webhooks belong here, not in server functions.

### 3.4 Data layer

- `packages/db/src/schema/<domain>.ts`, one file per domain, re-exported by `schema/index.ts`.
- `packages/db/src/client.ts` owns the lazy connection, TLS verification and the health probe.
- Runtime uses the pooled `DATABASE_URL` with `prepare: false`; migrations use the direct
  `DATABASE_URL_UNPOOLED`.
- Migrations are generated SQL files in `packages/db/drizzle/`, applied by `pnpm db:migrate`.
- Every multi-row write runs in a transaction. The audit row is written in the same transaction.

Domains declared today: `identity`, `audit`, `customer`, `workorder`, `quote`, `purchasing`,
`inventory`, `invoice`, `tjx`, `compliance`. Only `identity` and `audit` contain tables; the rest
are explicit placeholders until their module lands.

### 3.5 Auth and RBAC

- **Neon Auth (Managed Better Auth)** owns credentials and sessions. There is no password column
  in our schema and no hashing dependency.
- Sign-in runs server-side against the provider. The returned JWT is verified on every request
  against the provider JWKS (EdDSA, issuer, audience, expiry).
- The provider session cookie plus current JWT are sealed with AES-256-GCM in our HttpOnly
  `cls_session` cookie. An expired JWT is refreshed through `/get-session`.
- Four roles (`admin`, `technician`, `subcontractor`, `supplier`) plus 30 granular, optionally
  expiring `user_permissions` grants. The WSIB override is scoped by
  `scope_subcontractor_id`; the price editor is `inventory:edit_price`.
- Every write emits an `audit_log` row. Sign-in, sign-out, failure and denial are audited.
- Details: `AUTH-RBAC.md`, ADR 0004.

### 3.6 Object storage

- `@cls/storage` exposes put/get/signed URL/delete/health over two buckets: `assets` (operational
  files) and `accounting` (generated financial PDFs).
- The S3 driver points at the branch-scoped Neon endpoint with `forcePathStyle: true`.
- With no credentials, `STORAGE_DRIVER=auto` falls back to the local filesystem, so development
  and an offline install still work.
- Key layout and upload rules: ADR 0009.

### 3.7 AI Gateway

- `@cls/ai` is wired with `listModels`, `chat` and `aiHealth`.
- `AI_ENABLED=false` by default. Inference is unavailable because the project has no prepaid
  credits (`403 credits_required`, verified live).
- `chat()` throws instead of fabricating a response. See ADR 0010.

### 3.8 Presentation

- Tailwind v4 with a single seam: `apps/web/src/styles/app.css` maps semantic design custom
  properties to utility names via `@theme inline`.
- `packages/ui/src/tokens.css` is the design agent's published token file, adopted verbatim.
- Components use `bg-app`, `text-fg`, `border-hair`, `bg-ink`, `text-brand`, etc., or inline
  `var(--status-*-fg)` for status triples. No hex values in components. See ADR 0008.

---

## 4. Module boundaries

A module owns one vertical slice: routes, components, server functions, pure domain logic, tests,
a schema slice and its navigation registration.

Rules:

1. A module may import `@cls/core`, `@cls/db`, `@cls/auth`, `@cls/storage`, `@cls/ui` and its own
   files. Sage access is through `@cls/sage` only.
2. A module may not import another module's components or internal `lib/`. Cross-module reads go
   through the owning module's published server function or read model.
3. Cross-domain foreign keys are allowed; cross-module writes are not.
4. Routes are added as files. Navigation is discovered by glob, so no shared array is edited.
   Permission keys are appended to `PERMISSIONS` in `@cls/core/permissions.ts` and seeded.
5. Status strings come from `@cls/core` `STATUSES`; modules do not invent their own vocabulary.

The full checklist is `MODULE-CONTRACT.md`; the decision is ADR 0007.

---

## 5. What is real today, and what is stubbed

| Area | State |
|---|---|
| Monorepo, typecheck, lint, unit tests, build, production start | Working |
| Postgres migrations and seed against the provisioned Neon branch | Applied; 30 permissions, 49 role grants, no seeded business data |
| Neon Auth JWT verification (JWKS, EdDSA, issuer, audience, expiry) | Working; forged/expired/wrong-issuer tokens rejected |
| Sign-in / logout through the provider | Implemented; live provider rejection path verified |
| RBAC evaluation, role matrix, scoped grants | Working, unit-tested |
| Object storage put/get/signed URL/delete | Working against `assets` and `accounting` |
| AI Gateway seam | Wired; inference unavailable (`credits_required`), flag off |
| Sage discovery + connection verification (MySQL sentinel) | Working; tested against two MySQL servers |
| Sage business reads/writes (invoices, journals, inventory) | Not implemented; belongs to the Sage module |
| UI login page, shell, dashboard, admin placeholders | Working |
| Business modules (work orders, quoting, …) | Not started; schema slices are empty on purpose |
| User management UI, audit viewer, MFA | Not built |

Health semantics: `/api/health` is 200 even when the DB is absent, with `status: "degraded"`.
`/api/ready` is the probe that returns 503 when the database is unreachable. The shell and login
page must boot before the database exists.

Sage, auth and storage do not make the app `degraded`: they report their own state in the payload
and on the dashboard.

---

## 6. Request lifecycle

1. Nitro receives the request.
2. Global request middleware adds security headers and applies CSRF checks to server functions.
3. For a document route, the router runs `beforeLoad` (session lookup) and then renders. SSR uses
   the same React tree as the browser.
4. Session lookup reads the sealed cookie, verifies the JWT (or refreshes it through Neon Auth),
   maps the `sub` to an application user, and loads role + user grants.
5. For a server function, the middleware chain runs: session load → auth → permission. Then the
   handler opens a transaction, writes, audits, commits.
6. Errors are converted to HTTP status + JSON by Start; the client shows the message from
   `AppError`.

---

## 7. Non-goals in phase 1

- Public internet exposure, CDN, a second cloud.
- Multi-tenancy and row-level security.
- A separate worker process. Scheduled jobs, when they arrive, run in-process behind a
  single-instance lock.
- Replacing Sage with a cloud API.
- AI on any authorization, pricing or accounting path.

---

## 8. Decision records

| ADR | Subject |
|---|---|
| 0001 | TanStack Start instead of Next.js |
| 0002 | Local runtime topology |
| 0003 | Drizzle + Neon access model (pooled runtime, direct migrations) |
| 0004 | Neon Auth, our RBAC and audit layer |
| 0005 | Sage 50 adapter and the MySQL sentinel protocol |
| 0006 | Monorepo layout and tooling |
| 0007 | Module ownership boundaries |
| 0008 | Theme seam and token adoption |
| 0009 | Object storage (Neon S3 + local fallback) |
| 0010 | AI Gateway seam, disabled until funded |
