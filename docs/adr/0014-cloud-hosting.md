# ADR 0014 — Cloud hosting for the rebuild

- **Status:** Accepted (recommendation; the region and residency answer is a human decision)
- **Date:** 2026-11-11
- **Owners:** Platform
- **Supersedes:** ADR 0002 (local LAN runtime), and the hosting half of D4
- **Relates to:** `plan/REBUILD-PLAN.md` D18, ADR 0012 (jobs), ADR 0013 (notifications),
  `plan/modules/SAGE-CLOUD.md`

## Context

D18 moved the rebuild to the cloud: TanStack Start on Nitro, Neon Postgres primary, S3-compatible
object storage, and a Sage cloud API. Nothing local or offline was built, so there is nothing to
unwind. What the app needs from a host is modest in volume and specific in capability:

- a Node server runtime for Nitro server functions and route handlers;
- outbound TLS to Neon, Sage, the mail relay and object storage, with no inbound port to manage;
- a scheduled trigger for the jobs in ADR 0012 (compliance reminders, PO follow-ups, outbox drain);
- PDF rendering (`@react-pdf/renderer` with embedded fonts) and image work (`sharp`) on the server;
- encrypted secret storage per environment, not `.env` files on a disk;
- predictable cost and no operating system to patch.

Two facts shape the comparison. The repo's database access uses the `postgres` driver over TCP
(Drizzle), and PDF/image work is CPU- and memory-bound Node code. Both are ordinary on a Node
runtime and both are friction on a 128 MB V8 isolate.

## Decision

**Host on Vercel**, with Neon as the database (Vercel's Neon integration or a manually managed
`DATABASE_URL`) and the existing S3-compatible object storage. Build with the Nitro Vite plugin
(`nitro()` in `vite.config.ts`), which Vercel recognises and configures; no adapter rewrite.

Why this one:

1. **TanStack Start on Nitro is first-class there.** Vercel detects TanStack Start, sets the build
   command and output, and runs server functions on Vercel Functions. `nitro/vite` is the documented
   path, including scheduled tasks and queues if we later want platform primitives instead of the
   in-app job table.
2. **It runs Node, not isolates.** `postgres`, `sharp`, `@react-pdf/renderer`, font files and
   synchronous crypto all work unchanged. The alternative that saves money costs a rewrite of the
   paths that are hardest to test — document rendering and image cropping.
3. **Secrets live in a platform store**, scoped per environment, injected at runtime. That removes
   `.env` files from production and makes `SAGE_*`, `NOTIFICATION_LINK_SECRET` and `DATABASE_URL`
   rotatable without a deploy of the repository.
4. **Scheduled work has a platform trigger.** Vercel Cron calls an authenticated route; the
   advisory-lock and run-ledger design in ADR 0012 already assumes exactly that, so the host timer
   the LAN design needed becomes a cron entry.
5. **Operational surface is small**: Git deploys, per-PR previews, logs and tracing, a WAF, and no
   OS. For a two-person platform team supporting a business ERP, that is the difference between
   shipping modules and maintaining a server.
6. **Cost is dominated by seats, not compute at this volume.** Function pricing bills active CPU
   ($0.128/hour) and provisioned memory ($0.0106/GB-hour) plus invocations. A staff app doing
   roughly 2,000 requests a day at ~200 ms CPU each is single-digit dollars a month of compute; the
   plan fee is the real line item. An I/O-bound ERP (waiting on Neon) is the workload this pricing
   model favours.

Conditions attached to the decision:

- **Region.** Run functions in the region closest to the Neon primary and confirm on the plan that
  the region is available (Toronto if offered, otherwise the nearest North American region). The
  app is data-heavy and server-rendered; function-to-database latency dominates, not visitor
  distance.
- **Previews never touch production.** Preview deployments get their own Neon branch, their own
  secrets, and a fake or sandbox Sage adapter. A preview that can post to the real ledger is the
  modern version of two writers.
- **Residency is a human answer.** If accounting data must stay in Canada, the region choice (and
  possibly the platform) follows from that, not from this ADR.
- **Fallback is Cloudflare, not a VPS**, if cost or an outage forces a move: the framework is
  identical, and the migration path is documented on both sides.

## Options considered

| | **Vercel** | **Cloudflare Workers/Pages** | **Plain VPS** |
|---|---|---|---|
| TanStack Start build | `nitro/vite`, detected and configured | `@cloudflare/vite-plugin`, `wrangler.jsonc`, custom entrypoint for cron/queues | `nitro` node-server preset or a Node process manager |
| Runtime | Vercel Functions, full Node on AWS Lambda, Fluid compute | `workerd`, V8 isolates, `nodejs_compat` for Node APIs | Full Node, whatever the box runs |
| Memory / time | 2 GB default, up to 4 GB; 300 s (Hobby) / 800 s (Pro) wall clock | **128 MB per isolate**; 30 s CPU default, up to 5 min; cron/queue consumers 15 min CPU | The box's limits |
| Neon | TCP driver as-is, or the Neon integration | Needs the HTTP/WebSocket serverless driver (Drizzle `neon-http`) or Hyperdrive; `postgres` over TCP does not work | TCP as-is |
| PDF and images | `@react-pdf/renderer`, `sharp`, fonts unchanged | `sharp` native binary is not viable; PDF and font work is a rewrite or an external service | Unchanged |
| Scheduled jobs | Vercel Cron → our authenticated route; Queues/Workflows available | Cron Triggers, Queues, Durable Objects, Workflows — the richest set | systemd timers, the most manual |
| Secrets | Encrypted project env vars per environment | `wrangler secret`, bindings | A file on disk, your problem |
| Security extras | WAF, DDoS protection, observability built in | WAF, DDoS, global network, cheap | You build all of it |
| Cost at this volume | Plan fee dominates; compute a few dollars | ~$5/month Workers Paid (10M requests, 30M CPU-ms) plus near-zero | $20-40/month plus your time and the incident you will have |
| Operational load | Low | Low, with a runtime learning curve | High: TLS, patching, backups, monitoring, reboots |

**Cloudflare rejected for now**, not on quality but on fit: 128 MB per isolate and CPU limits make
server-side PDF generation and image cropping risky, `sharp` effectively does not run there, and
switching the database driver to the HTTP variant is a code change in the middle of preserving
behaviour. It is the right answer if the app becomes edge-served and compute-light; it is the wrong
answer while the heaviest workloads are document rendering.

**VPS rejected**: it reintroduces exactly what the cloud move removed — a machine to patch, a
single point of failure, TLS to renew, backups to verify — for a compute bill that is already small.
It stays the escape hatch if a residency or vendor constraint rules out the platforms.

## Security posture changes

Public hosting changes the threat model, not just the address. The legacy system's de facto control
was "you must be on the LAN"; that is gone.

1. **HTTPS only.** `APP_URL` is the canonical origin, cookies are `Secure`, `HttpOnly`,
   `SameSite=Lax` with the `__Host-` prefix where possible, HSTS is on, and no absolute `http://`
   URL may be generated. Mixed content is a bug, not a cosmetic issue.
2. **Secrets out of files.** No `.env` in the deployed artifact. Every secret is a platform
   environment variable, per environment, with a rotation procedure and an owner. Secrets never
   appear in client bundles: server-only modules and `createServerFn` bodies are the boundary, and a
   lint rule plus a bundle grep check the boundary.
3. **Rate limiting and abuse controls.** Login, invitation acceptance, signed-link redemption,
   password reset, PDF generation, CSV/Excel export and every write server function are rate
   limited per IP and per user. The platform WAF covers volumetric traffic; the app covers
   application-level abuse. Failed logins lock progressively and are audited.
4. **Trusted proxy handling.** `X-Forwarded-For` and `X-Forwarded-Proto` are trusted only from the
   platform, not from arbitrary clients. The client IP used for rate limiting is derived from the
   platform header, never from a user-supplied one.
5. **Authentication is now the only wall.** Multi-factor authentication becomes a requirement for
   admin-level roles rather than a nice-to-have, sessions have an idle timeout, and impersonation
   (if ever added) is audited.
6. **Audit-log integrity.** The audit log is append-only: the application role has `INSERT` and
   `SELECT` but no `UPDATE` or `DELETE`, entries carry a hash chain so a deleted or edited row is
   detectable, retention is bounded by policy rather than by convenience, and exports are logged.
   "Who posted this invoice" must survive a compromised application account.
7. **Least privilege in the database.** The runtime role cannot `ALTER`, `DROP` or create roles;
   migrations run with a separate credential from CI, not from the app.
8. **Object storage stays private.** Short-TTL signed URLs only, no public bucket, uploads
   validated by magic bytes and scanned before they are served, and the download path is
   authenticated and `no-store` (already implemented for compliance documents).
9. **Logs carry no PII or secrets.** Record ids and outcomes, not recipient addresses, bodies or
   tokens. Redaction is tested, not assumed.
10. **Availability is a dependency, not a guarantee.** The platform is a supplier: its status page
    is part of the operating picture, `/api/health` reports database and Sage state, and the app
    degrades (queues postings, shows status) instead of failing closed.

## Consequences

- **Positive:** deployment becomes a Git push with previews; the runtime matches what the code was
  written for; secrets and TLS stop being local responsibilities.
- **Positive:** the job runner (ADR 0012) works unchanged: the platform cron calls the same
  authenticated trigger the LAN host timer would have called, and the advisory lock makes duplicate
  invocations harmless.
- **Negative:** a recurring platform cost that a VPS would not have, and a vendor in the request
  path. Mitigated by the framework staying Vanilla Nitro and the database staying standard
  Postgres.
- **Negative:** serverless functions have no long-lived process, so anything that assumed a resident
  ticker must be triggered. The design already allows this; the implementation must not assume
  `setInterval`.
- **Negative:** a second environment (preview) multiplies secrets and database branches, and must be
  actively prevented from reaching production Sage or sending real mail.
- **Risk:** the chosen region may not be the one the database sits in, adding tens of milliseconds
  per query. Measure first, and co-locate rather than optimising queries.
- **Risk:** residency requirements could force a different platform after implementation. Keeping
  the app on standard Postgres, S3 API and Nitro keeps that move to configuration plus a driver
  swap, not a rewrite.

## Verification

- `pnpm build` produces a Nitro output that the platform deploys; `/api/health` responds with
  database connectivity and no secret material.
- A preview deployment cannot reach production: its `DATABASE_URL` is a branch, its Sage connection
  is `disabled`, its mail transport is `memory`, asserted by an environment check that fails the
  build if a production secret is present in a preview context.
- A scheduled invocation of the jobs trigger with the wrong `x-job-secret` returns `403`; two
  concurrent invocations produce one run-ledger row and one execution.
- A login through the deployed origin sets `Secure`/`HttpOnly`/`SameSite` cookies and rejects the
  same request over `http://`.
- A PDF for the largest realistic document renders inside the function's memory and time budget on
  the chosen plan; if it does not, the document moves to a background job rather than raising the
  limit.
- Rate limits are exercised: N+1 login attempts and N+1 signed-link redemptions are refused and
  audited.
