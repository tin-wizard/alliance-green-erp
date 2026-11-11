# ADR 0015 — Database residency: keep Neon in Ohio, compute in Montréal

- **Status:** Accepted (D22, 2026-11-11). Client decision recorded by the human.
- **Date:** 2026-11-11
- **Owners:** Platform, with the client sponsor
- **Relates to:** `plan/REBUILD-PLAN.md` D18/D22, ADR 0014 (hosting), ADR 0003 (Drizzle + Neon),
  `plan/modules/SAGE-CLOUD.md` §1.2

## Context

The client requirement was "data must stay in Canada". Checking it against the providers in use
produced a conflict:

- **Neon has no Canadian region.** Its documented regions are `us-east-1`, `us-east-2`, `us-west-2`,
  `eu-central-1`, `eu-west-2`, `ap-southeast-1`, `ap-southeast-2` and `sa-east-1`. The project
  (`Alliance`, branch `production`) runs in **`aws-us-east-2` (Ohio)**.
- **Vercel does have a Canadian region**: Montréal, `yul1`.
- **Sage's hosting is outside our control** in either case. The Sage Accounting tenant is provisioned
  by Sage in whatever region Sage chooses for a Canadian business; we can state that, not change it.

So the options were: keep the database in the US and accept it, move the database to a
Canadian-region provider, or wait for a Neon Canadian region with no timeline. The client chose to
**accept US database hosting** and to keep the current stack.

## Decision

1. **The database stays on Neon `aws-us-east-2` (Ohio).** No migration, no provider change.
2. **US residency is accepted by the client for the database**, with the trade-off recorded rather
   than glossed: the data lives outside Canada, and the client is told that plainly.
3. **Compute may still be Canadian.** Vercel Functions deploy to `yul1` (Montréal), which keeps the
   application tier in Canada and within normal round-trip distance of the Ohio database.
4. **`packages/auth` stays on Neon Auth** and **object storage stays on Neon Object Storage.** Both
   are portable in principle (Neon Auth is managed Better Auth over our Postgres; storage is
   S3-compatible) and both stay where they are because the residency question was answered the other
   way.
5. **The Sage tenant's hosting is stated, not implied.** It is Sage's decision and outside our
   control; the client should not be told the system is "Canadian-hosted" when the ledger is not.

## Reasons

- **It is the client's call, and they made it.** The requirement was theirs; the acceptance is
  theirs. The platform's job is to record it so a future reader does not discover it by accident.
- **Zero rework.** Auth, storage, driver, migrations, branching and the migration rehearsal all stay
  as built and as tested. Any residency migration would put a working system through a provider
  change for a policy outcome the client has already accepted without it.
- **The alternative is not a configuration flag.** Moving off Neon means a different managed Postgres
  with a different operational surface, and the honest cost is measured in weeks, not hours.
- **No Canadian Neon region exists to wait for.** A wish is not a plan.

## Consequences

- **Privacy and disclosure.** US hosting must be stated in the privacy policy and in any client
  data-handling summary: which categories of personal information are stored (staff identity,
  customer contacts, subcontractor documents), where, and under whose contract. Under PIPEDA the
  organisation remains accountable for personal information transferred to a processor, so the
  processing agreement with the provider matters more than the pin on the map. If Quebec's Law 25
  applies to any data subject, a privacy impact assessment before cross-border transfer and a policy
  disclosure are required; that is a legal question for the client's counsel, not a platform choice.
- **Backups and point-in-time recovery are US-hosted too.** A restore is not an escape from the
  residency decision, and the disaster-recovery plan should say so.
- **Latency.** Montréal functions to an Ohio database is a normal cross-region hop, tens of
  milliseconds, and the application is I/O-bound rather than latency-critical. It is not free: page
  loads that issue several sequential queries pay it more than once, so queries stay batched.
- **A future move is possible but not cheap.** The stack is deliberately portable — standard
  Postgres, Drizzle, S3 API, Better Auth — which keeps the option open without pretending it is a
  switch.
- **The Sage ledger is hosted by Sage, wherever Sage puts it.** Nothing in this ADR changes that, and
  the client should hear it in the same sentence as the database answer.

## What would reopen this

1. A regulatory or contractual requirement that personal information stay in Canada — the client's
   counsel decides, not the platform.
2. A Neon Canadian region becoming available, which would make the move a branch-and-cutover rather
   than a provider change.
3. A client policy change that prioritises residency over the migration cost.

## Verification

- The decision is recorded in `plan/REBUILD-PLAN.md` (D22) and referenced from ADR 0014 and
  `SAGE-CLOUD.md`.
- The deployed configuration matches it: `DATABASE_URL` points at the `aws-us-east-2` project, and
  Vercel functions run in `yul1`.
- The data-handling summary the client receives names the US database, the Montréal compute and the
  Sage tenant's third-party hosting, in that order, without euphemism.
- No code assumes a Canadian database region; nothing in the application reads a region setting.
