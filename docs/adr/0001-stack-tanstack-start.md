# ADR 0001 — Application stack: TanStack Start (not Next.js)

- **Status:** Accepted
- **Date:** 2026-11-11
- **Owners:** Platform

## Context

The legacy system is PHP 5.6 + `mysql_*` + MySQL, with 675 files in one directory, no version
control and no tests. The rebuild is a full replacement of all modules (work orders, quoting,
purchasing, inventory, invoicing, TJX, compliance, Sage sync), delivered module by module.

The human constraint that decides the framework is **runtime location**: the application must
run as a normal long-lived server on a Windows or Linux box on the company LAN, with no cloud
platform and no public ingress. Outbound HTTPS to Neon Postgres is the only network dependency.

The prior assessment (`docs/legacy-system-critical-assessment.md`, §7) recommended Next.js.
That recommendation was written before the LAN-only constraint was fixed, and its stack list
already includes TanStack Query. React 19 + TypeScript is agreed in both cases; only the
meta-framework differs.

## Decision

Use **TanStack Start v1** with **TanStack Router**, **TanStack Query**, **TanStack Table** and
**TanStack Form**, on React 19 + TypeScript 5.9, built with Vite 8 and served by Nitro's
`node-server` preset. TanStack Start owns server functions, server routes, SSR and the router.

The meta-framework decision does not change the data layer (ADR 0003), the auth model
(ADR 0004) or the module boundaries (ADR 0007).

## Alternatives considered

1. **Next.js App Router.** The prior assessment's recommendation. Rejected for this deployment
   because:
   - Its production story is built around a hosting platform (Vercel) or a hand-rolled Node
     server plus `next start`. Both work locally, but the framework's cache semantics, RSC
     bundling and server-action model add machinery we do not need for an authenticated LAN
     ERP.
   - The rest of the chosen stack is TanStack. Using TanStack Query/Table/Form inside Next.js
     means two routers, two data-loading models and two caching layers, which is exactly the
     kind of accidental complexity that made the legacy system unmaintainable.
   - Route-level authorization in Next.js is conventionally enforced in middleware and layouts;
     TanStack Start's server functions + middleware give one enforcement point that is also
     the data boundary.
2. **TanStack Router + a hand-written Vite/Node server, no Start.** Rejected: we would
   reimplement SSR, server functions, cookie handling and CSRF, all of which Start already
   provides and tests.
3. **Remix / React Router framework mode.** Credible, but the team standard and the requested
   table/form stack are TanStack. Splitting router from table/form costs integration work.
4. **Keep PHP, modernize in place.** Rejected by the prior assessment and by the human
   decision: the vulnerabilities are the architecture.

## Consequences

- **Positive:** one router, one query client, one table model, one form model; typed server
  functions; file-based routes that generate `routeTree.gen.ts` (no hand-maintained route
  registry, so module agents do not conflict on it); SSR without a platform dependency.
- **Positive:** the production artifact is a single Node process (`.output/server/index.mjs`),
  which is exactly what a LAN server needs. See ADR 0002.
- **Negative:** TanStack Start is younger than Next.js. We pin exact minor versions and keep
  the upgrade surface small. Hosting documentation for "Node.js" routes through Nitro, which
  is currently a release candidate; if Nitro becomes a problem we can serve the Start handler
  from our own Node server without changing application code.
- **Negative:** the prior assessment's written recommendation is contradicted. That
  contradiction is recorded and reported to the orchestrator; the human's later constraint
  (LAN host, TanStack stack) takes precedence.
- **Guardrail:** no Next.js-specific primitives (RSC, server actions, `next/*` imports) may
  enter the codebase. Server-only code lives behind `createServerFn` / server routes and
  `*.server.ts` modules.

## Verification

- `pnpm build` emits `.output/server/index.mjs`; `pnpm start` serves it on `HOST:PORT`.
- `/api/health` returns 200 from the production build.
