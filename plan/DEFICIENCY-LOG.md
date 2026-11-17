# Deficiency log

Written 2026-11-16 from what was built, run and tested in this stretch of work. It lists what is
missing, unproven or risky. It is not a code audit of every file: anything not named here was not
reviewed for this log. Severity: **S1** blocks cutover, **S2** must be fixed before cutover or
carried with an owner, **S3** should be fixed, **S4** housekeeping.

## 1. Data and migration

| ID | Sev | Deficiency | Evidence | Needed |
|---|---|---|---|---|
| D1 | S3 | **Updated 2026-11-17.** The full dump arrived (1.6 GB, 357 tables) and was staged and transformed on dev: 164 tables, 1,747,599 rows, 12 of 12 groups passed with 0 row errors. It matches the earlier restored copy closely (105 of 164 tables identical). Open: the dump is a point in time, not live. | Staging 292 s, transform about 17 min, both in a sandbox. | Take a fresh dump at cutover and rerun. |
| D2 | S1 | No import utility for the parallel-run period. The harness is a one-shot full rehearsal. There is no delta run from live MySQL, no Sage-precedence rule, no reconciliation job. | Owner's stated plan: run both systems, Sage as source of truth. | Build delta import, Sage precedence, nightly reconciliation report. |
| D3 | S1 | Sage is not connected. Customers, vendors and items are loaded from the legacy copy, not from Sage. 1,164 sites have no billing customer, 32 suppliers and 27 subcontractors have no Sage vendor. | Parity anchors and exception classes `orphan_site_customer`, `supplier_without_vendor`, `subcontractor_without_vendor`. | Sage cloud API connection, then map customers and vendors from Sage. |
| D4 | S2 | 436,207 exceptions are all `pending`; none has an owner decision. Largest: `unknown_enum` 193,559, `unparseable_json` 193,420, `orphan_line` 25,534, `orphan_workorder_site` 14,184. | `migration.exceptions` on dev. | Business owners decide per class; most are policy decisions, not row-by-row work. |
| D5 | S3 | **Updated 2026-11-17.** 14 of 62 parity anchors differ on the new dump (35 match, 0 error; run without a pre-import baseline). Traced to rows and explained: supplier invoice total (406 invoices with PO id -1 or -2 skipped, net -97,230.75; loaded rows match to the cent), supplier rate cards (46 rows, 3 Bell part codes absent), quote parts lines (186) and labour hours (34 h, parents absent from `customer_quote`), work-order labour hours (3 h, one row with `woid` 0). Also explained earlier: user duplicates, deleted-part price history, negative PO lines. Not traced: subcontractor documents (+6 in app), invoice part line total (+60), RGA part lines (+1), and the work-orders-by-status ordering (D10). | Every traced gap equals an `orphan_line` exception count. | Trace the three small ones; rerun with a baseline. |
| D6 | S2 | The generated report says 491,784 exceptions; the table holds 436,207. The report and the ledger disagree. | `report/run.md` vs `migration.exceptions` count. | Find which count is wrong before the report is used as evidence. |
| D7 | S2 | 28,552 unresolved row errors from earlier runs remain in `migration.errors`; the report prints 500 of them as if current. The latest pass has 0. | `migration.errors` by run. | Mark old errors resolved or scope the report to the latest run. |
| D8 | S2 | Negative PO quantities (71 lines, about -3,300 priced) are skipped. If they are returns, received stock is overstated by 11 units. | `negative_quantity` exceptions, PO received quantity anchor. | Owner decision; recommended: load as inventory adjustments. |
| D9 | S2 | 406 supplier invoices carrying PO id -1 or -2 (not "no PO"; 335 credits totalling -108,659.75 and 71 positive totalling 11,429.00; owner to say what -1 and -2 mean); 5,720 messages from 14 deleted users dropped; price history for deleted parts dropped. | Earlier analysis in this session. | Owner decision on each; messages need a nullable author plus author name. |
| D10 | S3 | Parity compares some totals as text or JSON blobs (work orders by status, row ordering differs and is flagged as a difference). | Parity table. | Normalise ordering and number formats in the anchors. |
| D11 | S3 | The harness only runs in apply mode in practice. Rollback and re-run semantics (what happens to rows the app edited after a run) are undefined. | Harness design; no test for edits after load. | Define and test re-run rules before parallel running. |
| D12 | S3 | Run speed depends on running near the database (1.4 ms vs 102 ms round trip). From a laptop it is days. | Measured. | Document that rehearsals run in the sandbox; script the sandbox setup (it was assembled by hand each time). 2026-11-17: the sandbox stops at its 4-hour limit and takes its report files with it, so write reports to durable storage. Parity needs only aggregate queries and can run from a laptop. |

## 2. Production and operations

| ID | Sev | Deficiency | Evidence | Needed |
|---|---|---|---|---|
| P1 | S3 | **Resolved 2026-11-17 for the schema.** Migrations 0018 to 0020 and the Bell data are on production. Open: the Sage outbox draft migration `0018_fuzzy_siren` exists only on the main checkout's local `main` and collides with `0018_bell_quoting`; production Bell quotes have no site or customer links; no Neon snapshot of production was taken. | Production migration state. | Reconcile the draft 0018 before the next migration. |
| P2 | S3 | **Resolved 2026-11-17.** The build guard is removed and PRs #2 to #4 are merged. Every push to `main` now deploys to production, so `main` needs review discipline. `develop` is protected (changes go through PRs). Rollback target: `dpl_BV42u5CyS7Jont91dRkrC1LGmMMu`. | Vercel project settings. | Keep as is. |
| P3 | S2 | Three test PDFs were uploaded to the production `assets` bucket by an e2e run before I found that the main checkout `.env` points at production. | Found and reported earlier; not deleted. | Owner approval to delete. |
| P4 | S2 | The legacy database password was shown in a WhatsApp screenshot from the old programmer. | Screenshot in this session. | Rotate it. I did not use or store it. |
| P5 | S2 | The main checkout `.env` points at production. Any test run from it writes to production. | Incident above. | Separate dev and prod env files; fail e2e if `DATABASE_URL` is not a dev branch. |
| P6 | S2 | No monitoring, alerting, backup restore test or runbook for the app. Neon snapshots are manual. | Nothing found in the repo. | Scheduled snapshots, restore drill, error reporting, uptime check. |
| P7 | S3 | Only one custom Vercel environment is allowed on the current plan, so staging is the only non-production target. | Vercel plan. | Fine for now; revisit if a second is needed. |
| P8 | S3 | Dependency on the Vercel Sandbox for rehearsals ties a data-critical process to a short-lived runner with presigned URLs and hand-built tarballs. | This session. | A committed runbook or a script that builds the bundle. |

## 3. Features not built

| ID | Sev | Deficiency |
|---|---|---|
| F1 | S1 | Email and CRM (Brevo). Needs an API key from the owner. "Boss hubs" is unexplained; ask before building. Closes the legacy gaps: Send Email, subcontractor mass email, customer emails. |
| F2 | S2 | Bell quoting: **Updated 2026-11-17.** Bell is now a harness group (`bell`, 15 tables, links quotes to sites, customers and work orders, records an exception for every dropped row; 5 lookup or empty tables are out of scope). There are still no screens, server functions or pricing logic. Production still holds the earlier script-loaded rows, so empty them before the production run (see PRODUCTION-LOAD B2). |
| F3 | S2 | ServiceChannel integration (live), batch import, work-order split, admin settings. |
| F4 | S2 | Notification transports are deferred (depends on F1). |
| F5 | S3 | Legacy portal parity matrix (54 rows) has open rows; it was last checked before the database arrived. Recheck against the real data. |

## 4. Code and tests

| ID | Sev | Deficiency | Evidence | Needed |
|---|---|---|---|---|
| C1 | S2 | The e2e suite passes only with a 25 s expect timeout against the dev branch, because of network latency from a laptop. A slow run hides real timing regressions. | `E2E_EXPECT_TIMEOUT_MS`. | Run e2e near the database or against a local Postgres. |
| C2 | S2 | The inventory spec and test depended on a small catalogue and failed on the real data (first 100 rows). I changed them to search. Other specs may carry the same assumption. | Fixed for inventory only. | Review specs for catalogue-size assumptions. |
| C3 | S2 | Harness tests use fixed legacy ids that now exist in real data (work order 999999, room 41). I moved them to unused ids. Other tests may still collide with real ids. | Two failures found. | Use generated ids, not literals. |
| C4 | S3 | The harness has 5 skipped tests and one skipped file. | Test run: 207 passed, 5 skipped. | Review and enable or delete. |
| C5 | S3 | The in-memory crosswalk and existence memo make the runner depend on process-local state. A crash mid-run loses buffered writes; correctness relies on replay with savepoints and idempotent upserts. | Runner design. | Add a test that kills a run mid-slice and resumes. |
| C6 | S3 | A `sub_stock_notifications` uniqueness change (0019) alters an upsert target in the app. Only the integration test covers it. | Commit 13e638e. | Check the stock-notification screens by hand. |
| C7 | S3 | `.data/` (local storage emulation) is untracked and not ignored. | `git status`. | Add to `.gitignore`. |
| C8 | S4 | Stale local processes (ERP on port 3200, old pipeline runners) may still run on this machine. | Earlier incident. | Clean up. |

## 5. Suggested order

1. Apply 0018–0020 to production behind a Neon snapshot, then merge PR #1 and lift the build guard (P1, P2).
2. Get the full mysqldump and rerun the rehearsal (D1).
3. Connect Sage and fix customer and vendor sourcing (D3).
4. Put the exception classes to the owners (D4, D8, D9) and trace the unexplained parity gaps (D5, D6).
5. Build the delta import and reconciliation (D2).
6. Brevo email and the remaining features (F1–F4).
7. Rotate the leaked password, delete the test PDFs, add monitoring and a restore drill (P3, P4, P6).
