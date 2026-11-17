# Production data load (first load, for the parallel run)

Written 2026-11-17. This is the runbook for putting the legacy data into the **production** Neon
branch for the first time. It is not the cutover: the old system stays the system of record until the
delta import exists (deficiency D2) and the owner signs the gates in `CUTOVER-AND-MIGRATION.md` §1.
This document covers one thing: how to load production safely, and what must be true before we do.

## 1. Where we are

| | Dev (rehearsal) | Production |
|---|---|---|
| Parts / customers / sites | 2,704 / 3,760 / 4,924 | 8 / 1 / 1 (test rows) |
| Work orders / quotes / POs / invoices | 44,235 / 528 / 2,471 / 40,845 | 0 |
| Import runs | 56 | 0 |
| App users | 377 (17 admins, 3 ever signed in) | 2 (both admins) |
| Bell quotes | 58 | 58 (copied from dev on Nov 16, not through the harness) |

Dev has had the full 1.6 GB dump staged (164 tables, 1,747,599 rows, 292 s in a sandbox) and
transformed (12 of 12 groups, 0 row errors, about 17 min). 35 of 62 parity anchors match and the
other 14 are traced to orphan rows, deleted parents or documented rules. Production holds test
fixtures only: customer, site and subcontractors 990001 to 990002, and eight parts with negative ids.
None of those ids can collide with real legacy ids.

## 2. Approach: rehearse on a clone of production, then run the same steps on production

Dev is a poor rehearsal of production: it carries 56 runs of history, an older load and test
residue. So:

1. **Clone.** Create a Neon branch `prod-rehearsal` from `production` (copy-on-write, instant).
   It has production's exact schema, rows and Neon Auth state.
2. **Rehearse on the clone.** Run the full pipeline on it (section 5). Verify (section 6).
   Point a local app at it and click through the screens.
3. **Snapshot production.** `create_snapshot` on `production`, named with the date. Restore a copy
   of that snapshot to a scratch branch and check it opens (gate G5). Delete the scratch branch.
4. **Run on production.** Same script, same dump, same order, production endpoint, explicit
   confirmation flag. Verify again.
5. **Delete the clone** and the rehearsal working copies.

The clone run is the gate-G3 evidence. Production is touched only after it passes.

## 3. Must be fixed or decided before step 4

These are blockers, in order. Each is a known open item, not a new one.

| # | Item | Why it blocks | Who |
|---|---|---|---|
| B1 | **WSIB classification.** The migrated documents are 136 `insurance`, 628 `other`, 0 `wsib`, so compliance shows all 896 active subcontractors missing WSIB and 828 blocked from assignment. | It decides who can be given work in the live app. Find out if the source really has no WSIB records or if the transform filed them under another kind. | Me, then owner |
| B2 | **Bell tables already on production.** Production has 58 Bell quotes copied directly, with no `row_map` entries. A harness run could duplicate or collide with them. | The clone rehearsal will show it. Either skip Bell in the production run or empty the Bell tables first and let the harness load them. | Me |
| B3 | **Pending notifications and email.** Imported messages and notifications must land as history, not as unsent mail. The email transport (Brevo) is not built, but when it is, anything `pending` in the outbox would be sent. | A mass email to staff and subcontractors on the first send. Check the outbox is empty after the clone run. | Me |
| B4 | **Exceptions (G4).** 436,516 pending, none decided. The big ones: `unknown_enum` 193,687 and `unparseable_json` 193,545 (work order revisions), `not_migrated` 55,645, `orphan_line` 25,549, `orphan_workorder_site` 14,194. | The owner must accept the handling per class. Most are policy, not row-by-row work. | Owner |
| B5 | **Production guard in the runner.** The rehearsal scripts refuse the production endpoint. The production run needs the reverse: it refuses unless the target is exactly the production endpoint and `--target=production` is passed. | Stops a wrong-database run in either direction (P5). | Me |
| B6 | **Scripted sandbox.** The sandbox is assembled by hand each time and stops at 4 hours, taking its report files with it (P8, D12). | A rehearsal must be repeatable, and reports must go to durable storage. | Me |
| B7 | **Test rows on production.** Eleven fixture rows. They do not collide, but staff would see them. You chose to leave them earlier. | Remove after the snapshot, if the owner agrees. | Owner |

Not blockers for a first load, but required before running both systems together:
- **D11, re-run rules.** Transactional rows (work orders aside, which upsert) are insert-or-skip once mapped, so a second import would not update existing quotes, POs or invoices. Needed for the delta import.
- **D2, the delta import** and Sage precedence.
- **D3, Sage connection.** Customers and vendors load from the legacy data and reconcile to Sage later. 1,164 sites have no billing customer; 6,698 work orders are at such sites and show "Unknown customer".
- **Files.** The SQL dump has no files. All 764 subcontractor documents have no storage key, and work order attachments point at paths on the old server. The files need their own transfer into object storage. Ask the owner where they live.
- **Users.** 377 legacy users load as app users with no Neon Auth account, so none can sign in until invited (plan §6). Only 3 have ever signed in on dev.

## 4. Decisions needed from the owner

1. Accept the handling of the exception classes in B4 (or name the ones to change).
2. What PO ids -1 and -2 mean (406 supplier invoices, net -97,230.75; D9), and whether to load them.
3. Invoice dates: accept the rule (invoiced date, then invoiced time, then preview date, then the work order's completion date; 160 stay on the load date).
4. Negative PO quantities (71 lines, D8): load as inventory adjustments, or skip.
5. The 5,720 messages from deleted users (D9): load with an author-name only, or drop.
5a. The five placeholder work orders (ids 0, 9999998, 9999999, 44444444, 99999999, status 6 or 11, dated 2018 to 2019):
   keep them out (current behaviour) or load them.
6. Remove the production test rows (B7) or keep them.
7. Where the legacy files are (documents, attachments).
8. Whether staff can see the migrated data on production before Sage is connected.

## 5. The run (identical on the clone and on production)

Environment for each run: sandbox in the same region as Neon (round trip about 1.4 ms, against 102 ms from a
laptop), dump copied by presigned upload and deleted after, reports written to durable storage.

1. **Preflight.** Confirm the target endpoint and branch id, the migration level (0020), the dump SHA-256
   (`ada3ee06…42e5`), and row counts before. Capture the parity baseline.
2. **Stage.** Load the split dump into `migration.stg_*` (about 5 min). Expect 164 tables, 1,747,599
   rows, 0 missing, 5 skipped dated duplicates, 14 NUL-byte strips.
3. **Transform.** Run the 12 groups in order (lookups, parties, identity, parts, compliance,
   work-orders, quotes, purchasing, inventory, invoicing-rga, tjx, messaging-history; about 17 min). Stop on the first
   group that does not pass.
4. **Parity and report.** Run the anchors; build the run report; copy both to durable storage.
5. **Post-checks.** Outbox empty; no row without a parent that the exceptions do not explain; `app.users`
   have no Neon Auth ids except the two existing admins.

Total machine time is about 30 to 40 minutes. The slow part of this plan is the decisions, not the run.

## 6. Verification (go/no-go for production)

On the clone, then again on production:
- Counts match what the dump should produce, not dev's raw totals (dev also holds old test rows): parts
  2,704 (dev; the clone adds the 8 production test parts until they are removed), customers 3,760, sites
  4,924, **work orders 44,233** (dev shows 44,235 because it holds two test work orders, ids 3 and 5; the
  dump has 44,238 and five placeholder orders, ids 0, 9999998, 9999999, 44444444 and 99999999, are
  deliberately not inserted and logged as `placeholder_work_order`), quotes 528, POs 2,471, sales
  invoices 40,845, subcontractors 896. Any other difference from dev must be explained before production.
- Parity: the 35 matching anchors still match; the 14 differing anchors differ by the same amounts and no others.
- Field spot checks against the staged dump, as done for work orders and POs: status, site, supplier,
  dates, totals, notes (newline normalisation only).
- Screen walk-through, signed in, read-only: work orders (list and detail, with names), inventory, quotes
  (dates), purchasing, invoicing (dates), compliance, customers, sites, RGAs, TJX, reports, admin. Compare 10
  random records per screen against known Sage or legacy values.
- E2E suite against the **clone only**, never production.
- `/api/health` ok, no runtime errors in Vercel.

## 7. Rollback

- Production: restore the snapshot taken in step 3 of section 2 to a new branch, check it, then make it the
  production branch (or restore in place). Elapsed time is rehearsed on the scratch restore, so it is known.
- Nothing outside the database changes in the first load (no Sage posting, no emails, no files), so the
  database snapshot is the whole rollback.
- Vercel needs no rollback for a data load; the previous deployment stays available regardless.

## 8. Risks

| Risk | Mitigation |
|---|---|
| Wrong database targeted | B5 guard in both directions; endpoint and branch id printed and checked in preflight. |
| Bell data duplicated | B2; found on the clone before production. |
| Unsent mail created from history | B3 check before and after. |
| Staff act on unreviewed data | Owner decision 8; the old system stays the system of record; label the production app as a parallel copy until the gates are signed. |
| Data is a point in time | A fresh dump and a full rerun at cutover; the delta import covers the parallel period. |
| Sandbox limit or loss | B6 durable reports; the run takes under an hour, well inside 4. |

## 9. Order of work

1. B1 (WSIB), B2 (Bell), B3 (outbox), B5 (guard), B6 (sandbox script): code and investigation, about two days.
2. Owner decisions (section 4) in parallel.
3. Clone rehearsal and review of the evidence.
4. Snapshot, restore drill, production run, verification.
5. Then D11 and the delta import, which the parallel run needs.
