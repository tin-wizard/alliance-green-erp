# ADR 0006 — Monorepo layout and tooling

- **Status:** Accepted
- **Date:** 2026-11-11
- **Owners:** Platform

## Context

Several agents will add modules in parallel (work orders first, then quoting, purchasing,
inventory, invoicing, TJX, compliance, reports). They must not block each other on package
installs, schema files, route registration or navigation. At the same time the deployment unit
must stay simple: one process, one build.

## Decision

**pnpm workspaces, TypeScript project-free (path-mapped source), Vite build per app.**

```
cls-green-erp/
├─ apps/
│  └─ web/                 TanStack Start app (routes, server functions, shell)
├─ packages/
│  ├─ core/                config/env, error types, logger, shared primitives
│  ├─ db/                  Drizzle schema slices, client, migrations, seed
│  ├─ auth/                Neon Auth client, JWT verification, RBAC, audit, rate limit
│  ├─ sage/                Sage 50 adapter (MySQL discovery + connection verification)
│  ├─ storage/             object storage adapter (Neon S3 + local fallback)
│  ├─ ai/                  Neon AI Gateway client seam
│  └─ ui/                  design tokens + Tailwind theme seam + shell primitives
├─ docs/adr/
├─ e2e/                    Playwright specs against the production build
└─ scripts/                start.mjs, future ops scripts
```

Rules:

- **No package is built separately.** Workspace packages export TypeScript source
  (`"exports": { ".": "./src/index.ts" }`). Vite and Nitro compile them. This removes a
  build-order problem and makes cross-package refactors atomic.
- **Path aliases** (`@cls/*`) are declared once in `tsconfig.base.json` and resolved by Vite's
  `resolve.tsconfigPaths`. No relative `../../packages/...` imports from the app.
- **Dependency direction is one-way:**
  `apps/web → auth, sage, storage, ai, db, core, ui`; `auth → db, core`; `sage → core`;
  `storage → core`; `ai → core`; `db → core`; `ui → core` (types only). No package imports
  `apps/web`, and no cycle is allowed.
- **TypeScript strict**, plus `noUncheckedIndexedAccess` and `noUnusedLocals`.
- **Lint:** ESLint flat config with `typescript-eslint` recommended-type-checked for source
  files, and `eslint-plugin-react-hooks` for the app.
- **Tests:** Vitest at the root, one config, files colocated (`*.test.ts`). Playwright lives in
  `e2e/` and runs against `pnpm start`.
- **No secrets in packages.** Config is read from `process.env` through `@cls/core/env.server`.
- **Package names are `@cls/*`.** The app is `@cls/web`.

## Alternatives considered

1. **Single package (no workspaces).** Fewer moving parts today, but module agents would all edit
   the same `package.json` and `tsconfig`, and the DB layer would be impossible to test in
   isolation. Rejected.
2. **Built packages (`tsc -b` project references).** Correct for published libraries, but it
   adds a build step and stale-`dist` failures during rapid module work. Vite handles source
   packages well. Revisit only if a package must be published.
3. **Turborepo / Nx.** Useful at 10+ apps with shared caches. One app, five packages does not
   justify the configuration surface.
4. **npm/yarn workspaces.** pnpm's strict node_modules prevents phantom dependencies, which
   matters when several agents add packages.

## Consequences

- **Positive:** adding a dependency is `pnpm --filter @cls/web add x`; no lockfile conflict
  beyond the lockfile itself.
- **Positive:** typecheck is one command across the whole graph.
- **Negative:** every package's TypeScript is compiled by Vite, so a package cannot use
  Node-only APIs in code imported by the client. Mitigated by `.server.ts` naming and review.
- **Negative:** `tsc --noEmit` checks the app's graph, so a package file not imported by the app
  is not checked. Mitigated by each package having its own `tsconfig.json` included in
  `pnpm typecheck` when it grows tests (the platform packages are all imported today).

## Verification

- `pnpm install` from a clean clone.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm start` all succeed.
