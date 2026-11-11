# ADR 0003 — Data access: Drizzle ORM + Neon Postgres

- **Status:** Accepted
- **Date:** 2026-11-11
- **Owners:** Platform

## Context

The legacy data layer is MySQL 5.7 with MyISAM tables, no foreign keys in practice, 303 tables
of which 117 are dated copies, and every query built by string concatenation. The rebuild needs
a transactional relational store with a schema that is reviewable in version control, typed at
the query boundary, and migratable by module agents working in parallel.

The human decision is **Neon Postgres + Drizzle ORM**. A project (`Alliance`, id
`icy-leaf-84310790`) and its `production` branch are provisioned; `neon env pull` supplies both
connection strings and the storage/AI credentials used by ADR 0009 and ADR 0010.

## Decision

1. **Database:** Neon Postgres, database `neondb`, branch `production`. Branching is used for
   schema experiments, not as part of the runtime. The physical database name comes from the
   provider and is not renamed.
2. **Driver:** `postgres` (postgres.js) through `drizzle-orm/postgres-js`.
   - The app is a long-lived Node process, which is exactly the case where a normal TCP pool is
     correct. Neon's serverless HTTP driver is optimised for short-lived edge functions and
     cannot run interactive transactions over HTTP.
   - **Runtime uses `DATABASE_URL` (pooled, host contains `-pooler`).**
   - **Migrations use `DATABASE_URL_UNPOOLED` (direct).** `drizzle.config.ts` and
     `pnpm db:migrate` both prefer it and fall back to the pooled URL only when it is absent.
     Pooled PgBouncer in transaction mode is the wrong place for DDL and migration bookkeeping.
   - TLS is required and **verified against the system CA**. `sslmode=require` is treated as
     `verify-full`; `sslmode=disable` is the explicit escape hatch for a local throwaway
     database. Verified against the provisioned project: both the pooled and direct endpoints
     connect with `rejectUnauthorized: true`.
   - `prepare: false` on the runtime connection: PgBouncer transaction mode does not support
     session-level prepared statements.
3. **Schema as code:** `packages/db/src/schema/<domain>.ts`, one file per domain, re-exported
   from `packages/db/src/schema/index.ts`. Domains: `identity`, `customer`, `workorder`,
   `quote`, `purchasing`, `inventory`, `invoice`, `tjx`, `compliance`, `audit`.
4. **Migrations:** `drizzle-kit generate` produces SQL into `packages/db/drizzle/`. Those files
   are committed. `pnpm db:migrate` applies them with `drizzle-orm/postgres-js/migrator` inside
   a transaction. **No agent edits an already-applied migration**; corrections are new
   migrations. No `db:push` against the production database.
5. **Naming:** `snake_case` in the database, `camelCase` in TypeScript, explicit column names
   for every column (never rely on inference). Tables are singular (`work_order`, `invoice`)
   and join tables are `<a>_<b>`.
6. **Types:** `bigint` timestamps are banned. All timestamps are `timestamptz`. Money is
   `numeric(12,2)`, never `float`. Identifiers are `uuid` (internal) plus a human-facing
   `number`/`code` text column where the legacy system had one.
7. **Transactions:** every multi-row write runs in `db.transaction()`. The audit row is written
   in the same transaction as the business change, so a rollback removes both.
8. **Access model:** server-only. The browser never imports `@cls/db`; `db` is imported only by
   server functions, server routes and scripts. Row-level security is not used in phase 1;
   authorization is enforced in the server-function layer (ADR 0004) and by scoping queries in
   repository functions. This is revisited if a second tenant ever appears.

## Alternatives considered

1. **Prisma.** Good migration tooling, but a separate schema language, a generated client and a
   query engine process. Drizzle's SQL-shaped API keeps the queries auditable, which matters
   when translating 12k legacy queries.
2. **Kysely.** Excellent typed query builder, but migrations and schema introspection are more
   manual. Drizzle covers both halves.
3. **Raw `pg` + hand-written SQL.** Maximum control, no schema types. Rejected: the rebuild's
   main cost is translation errors, and typed columns catch them.
4. **`@neondatabase/serverless` (HTTP or WebSocket).** Rejected for the main runtime: HTTP has
   no interactive transactions; WebSocket pooling adds a proxy that a LAN server does not need.
   Kept as a fallback only if the host's network blocks 5432.
5. **Local Postgres instead of Neon.** The only reason to prefer Neon is managed backups and
   branching. The code is driver-compatible, so this remains a configuration change, not a
   rewrite.

## Consequences

- **Positive:** one typed schema, one migration history, transactions everywhere, and SQL that
  can be read in code review.
- **Positive:** module agents own one schema file each, so schema work parallelises.
- **Negative:** Drizzle migrations are additive SQL files; renames require a two-step migration
  (add, backfill, drop). This is documented in `platform/DATA-LAYER.md`.
- **Negative:** the app depends on outbound TLS to Neon. Health checks make the dependency
  visible instead of hiding it; the app boots and reports `degraded` when the DB is unreachable.
- **Guardrail:** no table is created outside `packages/db/src/schema`. If a module needs a
  table, it adds it to its own domain file and opens a migration.
