# Deficiency log

Written 2026-11-16 from what was built, run and tested in this stretch of work. It lists what is
missing, unproven or risky. It is not a code audit of every file: anything not named here was not
reviewed for this log. Severity: **S1** blocks cutover, **S2** must be fixed before cutover or
carried with an owner, **S3** should be fixed, **S4** housekeeping.

## 1. Data and migration

| ID | Sev | Deficiency | Evidence | Needed |
|---|---|---|---|---|
| D1 | S1 | No full mysqldump of the live system (gate G0). The rehearsal runs on files restored from a physical copy (MyISAM plus InnoDB recovered by tablespace import without `ibdata1`). Row counts and some tables may not match what the live system holds. | Old programmer promised the dump; not delivered. | Obtain the dump, rerun, compare to the restored copy. |
| D2 | S1 | No import utility for the parallel-run period. The harness is a one-shot full rehearsal. There is no delta run from live MySQL, no Sage-precedence rule, no reconciliation job. | Owner's stated plan: run both systems, Sage as source of truth. | Build delta import, Sage precedence, nightly reconciliation report. |
| D3 | S1 | Sage is not connected. Customers, vendors and items are loaded from the legacy copy, not from Sage. 1,164 sites have no billing customer, 32 suppliers and 27 subcontractors have no Sage vendor. | Parity anchors and exception classes `orphan_site_customer`, `supplier_without_vendor`, `subcontractor_without_vendor`. | Sage cloud API connection, then map customers and vendors from Sage. |
| D4 | S2 | 436,207 exceptions are all `pending`; none has an owner decision. Largest: `unknown_enum` 193,559, `unparseable_json` 193,420, `orphan_line` 25,534, `orphan_workorder_site` 14,184. | `migration.exceptions` on dev. | Business owners decide per class; most are policy decisions, not row-by-row work. |
| D5 | S2 | 12 of 62 parity anchors differ. Explained: user duplicates, deleted-part price history, negative PO lines. Unexplained: supplier invoice total (about 97,230 higher in the app than the old data), supplier rate cards (46 rows), quote parts lines (186) and labour hours (34 h), work-order labour hours (3 h). | `report/parity.md`. | Trace each to rows; fix or document. |
| D6 | S2 | The generated report says 491,784 exceptions; the table holds 436,207. The report and the ledger disagree. | `report/run.md` vs `migration.exceptions` count. | Find which count is wrong before the report is used as evidence. |
| D7 | S2 | 28,552 unresolved row errors from earlier runs remain in `migration.errors`; the report prints 500 of them as if current. The latest pass has 0. | `migration.errors` by run. | Mark old errors resolved or scope the report to the latest run. |
| D8 | S2 | Negative PO quantities (71 lines, about -3,300 priced) are skipped. If they are returns, received stock is overstated by 11 units. | `negative_quantity` exceptions, PO received quantity anchor. | Owner decision; recommended: load as inventory adjustments. |
| D9 | S2 | 406 supplier invoices with no PO; 5,720 messages from 14 deleted users dropped; price history for deleted parts dropped. | Earlier analysis in this session. | Owner decision on each; messages need a nullable author plus author name. |
| D10 | S3 | Parity compares some totals as text or JSON blobs (work orders by status, row ordering differs and is flagged as a difference). | Parity table. | Normalise ordering and number formats in the anchors. |
| D11 | S3 | The harness only runs in apply mode in practice. Rollback and re-run semantics (what happens to rows the app edited after a run) are undefined. | Harness design; no test for edits after load. | Define and test re-run rules before parallel running. |
| D12 | S3 | Run speed depends on running near the database (1.4 ms vs 102 ms round trip). From a laptop it is days. | Measured. | Document that rehearsals run in the sandbox; script the sandbox setup (it was assembled by hand each time). |

## 2. Production and operations

| ID | Sev | Deficiency | Evidence | Needed |
|---|---|---|---|---|
| P1 | S1 | Migrations 0018 (Bell), 0019, 0020 are applied to dev only. `main` and the production Neon branch do not have them. Merging PR #1 deploys code that expects them. | Migration state per branch. | Apply to production with a Neon snapshot first, then merge. |
| P2 | S1 | Vercel Git builds from `main` are blocked by an ignore-build guard I added, because `main` lacks the Nitro `vercel` preset fix. Production deploys will not happen until PR #1 merges and the guard is removed. | Vercel project settings. | Merge, remove guard, verify health. Rollback target `dpl_CDbcGq6SQjfxLVmewVMuHJSpco7L`. |
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
| F2 | S2 | Bell quoting: 16 tables and data are loaded and reconcile, but there are no screens, server functions or pricing logic yet. |
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
