# ADR 0007 — Module ownership boundaries

- **Status:** Accepted
- **Date:** 2026-11-11
- **Owners:** Platform

## Context

The rebuild is delivered module by module, by different agents, possibly concurrently. The
legacy system's central failure was that everything touched everything: 675 files in one
directory, a 6,136-line `functions.php`, and no boundary between domains. If the rebuild allows
modules to import each other's internals, we will reproduce that failure with better syntax.

The first module is **Work Orders**. Later modules: quoting, purchasing, inventory, invoicing,
TJX, compliance, reporting, Sage sync.

## Decision

### One vertical slice per module

Each module owns:

```
apps/web/src/modules/<module>/
├─ nav.ts                  navigation registration (exported, no central edit)
├─ server/                 server functions (the only place module writes happen)
├─ components/             module UI
├─ lib/                    pure domain logic (unit-tested)
└─ types.ts                module-local types

apps/web/src/routes/(app)/<module>/...      TanStack file routes (thin; delegate to modules/)
packages/db/src/schema/<domain>.ts          that module's tables only
```

### Boundaries

- A module may import `@cls/core`, `@cls/db`, `@cls/auth`, `@cls/ui` and **its own** internals.
- A module may call another module **only** through that module's published `server/` functions
  or a documented `lib/` export. It may not import another module's components or query its
  tables directly.
- Cross-module reads that are genuinely needed (e.g. work orders reading customer names) go
  through a small, named read model exported by the owning module, or a database view owned by
  that module. Ad-hoc joins across module schema files are forbidden.
- `@cls/db` provides the client and the schema registry only. It contains no business queries.
- Foreign keys across domains are allowed at the database level (they are facts), but the
  application must not assume it can mutate another module's rows.

### Route and navigation registration without conflicts

- Routes are file-based; `routeTree.gen.ts` is generated, never hand-edited. Two agents adding
  files in different directories cannot conflict.
- Navigation is **discovered**, not registered centrally:
  `apps/web/src/shell/navigation.ts` globs `../modules/*/nav.ts` and concatenates the exports.
  A module adds navigation by adding a file. No shared array is edited.
- Permissions are string keys seeded from `packages/db/src/seed.ts`; a module adds its keys and
  default role grants there (one small append, documented in the module contract).

### Shared writes

- All writes go through a module server function with `authMiddleware` + permission middleware.
- All writes call `writeAudit()` inside the same transaction.
- Money and status transitions are domain logic in `lib/`, not in components.

### Status vocabulary

Work order and purchasing statuses are **shared** across modules (the design system defines
eleven). They live in `@cls/core/status` as a typed union once the cartographer confirms the
legacy values. Until then, modules must not invent their own status strings.

## Alternatives considered

1. **Separate packages per module (`@cls/workorders`).** Stronger isolation, but each module
   would need its own route tree integration and the app would still import them all. Directory
   ownership gives the same discipline with less ceremony. Revisit if a module grows a worker
   or a second consumer.
2. **Feature folders with central route/nav registration.** Rejected: the central files become
   merge-conflict hotspots for parallel agents, which is the exact problem we are avoiding.
3. **Microservices.** Absurd for one LAN server and a handful of users.
4. **Database-per-module.** Loses cross-domain transactions (invoice + work order status) that
   the business genuinely needs.

## Consequences

- **Positive:** parallel module work with no shared-file conflicts.
- **Positive:** a module can be deleted or rewritten by deleting one directory, one route
  directory and one schema file.
- **Negative:** some duplication across modules (each has its own table component usage). This
  is preferred to premature shared abstractions; shared primitives are promoted to `@cls/ui`
  only when a second module needs them.
- **Negative:** cross-module reads need an explicit read model, which is more work than a join.
  That friction is the point.
- **Guardrail:** code review rejects imports matching
  `modules/<other-module>/(components|lib internal)`. This becomes an ESLint rule when the
  second module lands.

## Verification

- The module contract (`platform/MODULE-CONTRACT.md`) is the checklist.
- Work Orders is built against it first and is the reference implementation.
