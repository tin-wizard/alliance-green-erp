# CLS Green ERP

Rebuild of the Alliance Lighting workorder system (the "CLS Green System") as a local-first ERP.
TanStack Start + React 19 + TypeScript, Drizzle ORM, Neon Postgres, Neon Auth, Neon Object
Storage, Neon AI Gateway (wired, unfunded), and a preserved Sage 50 MySQL connection for the LAN
host that runs Sage.

The legacy PHP application remains at `../CLS-Green System` as a read-only reference. This
repository is the replacement.

## Status

Foundation scaffold, bootable and verified:

- Neon Auth sign-in (JWT verified against live JWKS), RBAC, audit logging
- full 175-table legacy schema contract mirrored in Drizzle (171 tables + 4 deliberate
  exclusions) and applied to the Neon `production` branch
- app schema (`app`) for users, permissions and audit
- object storage adapter (Neon S3 + local fallback)
- AI Gateway client seam, feature-flagged off (`credits_required`)
- app shell (sidebar, top bar, dashboard, admin users, settings and activity log)
- health, readiness and liveness endpoints covering every service
- Sage 50 discovery and connection verification (MySQL sentinel, 13541 first)
- design tokens adopted from the design agent, no placeholder palette

Business modules built: work orders, quotes, master data, purchasing, inventory,
invoicing, RGAs and warranties, reports, compliance, messaging and admin.
ServiceChannel, the quarterly sub-stock PDF cron, TJX historical PDFs and the
on-behalf TJX invoice are deferred. **No production business data was loaded.**

## Quick start

```bash
pnpm install
neon env pull --file .env      # Postgres, Auth, Object Storage, AI credentials
# edit .env: APP_URL, SESSION_SECRET, Sage credentials, optional SEED_ADMIN_EMAIL
neon neon-auth domain add http://localhost:3000
pnpm db:migrate                # direct connection; creates app + legacy mirror
pnpm db:seed                   # permission catalogue and role grants only
pnpm build
pnpm start                     # http://localhost:3000
```

Development:

```bash
pnpm dev                       # Vite dev server with HMR
```

Without a database the app still boots: `/api/health` returns `degraded`, the login page renders
and `/api/ready` returns 503. That is intentional.

Public sign-up is disabled; identities are created by an administrator from
`/admin/users`, which creates the Neon Auth identity, adds the application role
and sends a password-reset link. On a new install, create the identity in Neon
Auth, verify the address, set `SEED_ADMIN_EMAIL`, run `pnpm db:seed`, and sign in
once to link the admin row. On this machine the first admin is
`developer@tin.info`; its password lives only in the gitignored
`.secrets/neon-auth-admin.txt`. See `platform/AUTH-RBAC.md` §3.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | TanStack Start dev server |
| `pnpm build` | Production build to `apps/web/.output` |
| `pnpm start` | Runs `scripts/start.mjs` (loads `.env`, starts Nitro) |
| `pnpm typecheck` | `tsc --noEmit` across the app graph |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest unit and database integration tests |
| `pnpm test:e2e` | Build, then Playwright against the production output |
| `pnpm db:generate:schema` | Regenerate the legacy mirror from `packages/db/contract/schema.json` |
| `pnpm db:generate` | Generate a migration from schema changes |
| `pnpm db:migrate` | Apply pending migrations (direct Neon connection) |
| `pnpm db:seed` | Upsert permissions and role grants; optional bootstrap admin |
| `pnpm db:studio` | Drizzle Studio |
| `pnpm verify` | typecheck + lint + test + build |

Live service checks:

```bash
pnpm --filter @cls/auth smoke       # JWKS, invalid sign-in, forged-token rejection
pnpm --filter @cls/storage smoke    # put/get/sign/delete in both buckets
```

## Layout

```
apps/web/            TanStack Start application and shell
packages/core/       env, errors, logger, status vocabulary, permissions
packages/db/         app schema, generated legacy mirror, client, migrations, seed
packages/auth/       Neon Auth client, JWT verification, sealed cookie, RBAC, audit
packages/sage/       Sage 50 adapter (MySQL sentinel discovery + connection verification)
packages/storage/    object storage adapter (Neon S3 + local fallback)
packages/ai/         Neon AI Gateway client seam (disabled until funded)
packages/ui/         design tokens (adopted) and cn()
docs/adr/            architecture decisions 0001-0010
docs/platform/       architecture, runbook, data layer, auth/RBAC, Neon, module contract
e2e/                 Playwright specs
```

## Documentation

- `docs/platform/ARCHITECTURE.md` — system shape, layers, boundaries, what is stubbed
- `docs/platform/NEON.md` — services, env vars, wiring, verified results, offline behaviour
- `docs/platform/LOCAL-RUNBOOK.md` — install, Windows service, upgrades, troubleshooting
- `docs/platform/DATA-LAYER.md` — 175-table contract, domain map, type mapping, exclusions
- `docs/platform/AUTH-RBAC.md` — Neon Auth flow, roles, permission matrix, guarding code
- `docs/platform/MODULE-CONTRACT.md` — required layout for a module
- `docs/adr/` — the decisions behind the stack, runtime, data, auth, Sage, monorepo, modules,
  theme, storage and AI

## Requirements

Node.js 22.12+ and pnpm 12. The production host should be the machine running Sage 50, because
the Sage adapter preserves the legacy localhost MySQL probe (13541 first, sentinel-verified).

## Secrets

Never commit `.env` or `.neon`. They are gitignored; `.env.example` is the template. Generate the
cookie secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

The app has no password column: credentials live in Neon Auth.
