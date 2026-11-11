# Work Orders

The first business module and the reference implementation for CLS v2. It owns
the work-order record from creation through dispatch, field capture, completion
and an **invoice-ready snapshot**. It does not invoice and does not post to Sage;
Invoicing owns both and reuses the same money function.

Legacy parity source: `plan/modules/WORK-ORDERS.md`, `green-system/BUSINESS-RULES.md`,
`green-system/DOMAIN-MODEL.md` and the fixtures under `fixtures/`.

## Screens

| Route | Purpose |
| --- | --- |
| `/work-orders` | Dense list with saved views, filters, search, bulk triage/priority/status, CSV export, cursor pagination |
| `/work-orders/new` | Create: site (customer is a site's parent), service type, priority, category, dates, subcontractor, flags, PO, notes |
| `/work-orders/$id` | Detail, edit, status transitions, capture, documents, revisions, activity, invoice-ready preview |
| `/work-orders/$id/revisions` | Full JSON revision viewer |
| `/maintenance/work-orders/*` | The same module pinned to series 2 (maintenance numbering) |
| `/portal/sub/work-orders/*` | Subcontractor portal, scoped to the signed-in subcontractor |
| `/portal/tech/*` | Technician portal, scoped to assignments |

Saved views match the legacy pages: Open, Overdue, Awaiting approval, Scheduled,
Completed, Invoiced, Cancelled, Undispatched, Missing WSIB. `Open` is the default
and the invoiced archive is never loaded unless its view (or `all`) is chosen.

## Rules that are not obvious

- `work_orders.id` **is** the business work-order number, not a surrogate key.
  Series 1 is main, series 2 is maintenance.
- Statuses are stored as legacy code 1–12 and projected to 9 display statuses.
  Flags (dispatched, received, transit) are shown beside the status, not instead
  of it. `lib/status.ts` owns both the projection and the transition table.
- Every transition is checked server-side against the table in `lib/status.ts`;
  an illegal change returns `Illegal status change: X → Y. Allowed next: …`.
  Every write also inserts an `app.audit_log` row in the same transaction.
- Completion requires labour (a zero-hour line is legal; a missing labour array
  is not). Dispatch requires an assigned subcontractor with a valid WSIB or
  insurance document unless the actor holds `workorder:override_wsib_hold`.
- Optimistic concurrency uses `work_orders.version`; a stale write is a `409`,
  never a silent last-write-wins.
- Revisions are full snapshots (`app.work_order_revisions`), linked only by
  `is_last_revision` with a unique partial index as the chain end. Each capture
  step writes a new chain end.
- Notes live in two places by design: `work_orders.notes` is the current header
  note (one field, editable with the record), and `work_order_notes` is the
  append-only history shown under Activity. The detail payload names them
  `notes` and `noteHistory`.

## Money

`packages/pricing` is the shared money package. It is pure, fixture-tested, and
imported by this module only through `server/tax.server.ts` and
`server/snapshot.server.ts` (plus directly by tests).

- `calculateSalesInvoice` / `calculateProjectWorkOrderTotals` — sales-side
  calculator. Per-line rounding, then accumulated tax rounded per line, matching
  PHP `number_format`. Manual tax is only accepted when the posted subtotal
  matches. A blank province is Ontario. `appliedTaxRate` (from
  `work_order_tax.applied_tax_rate`) overrides the table.
- `calculateSubcontractorPurchaseTotals` — **separate rule set** for what CLS
  pays a subcontractor (province/date rules, labour only when
  `hourlyRate > 0`, single rounding of the subtotal). Never mixed with sales.
- `calculateLocalInvoiceTotals` — local work orders, forced Ontario.

Fixture coverage: `packages/pricing/fixtures/` and tests named by fixture case
id (`sales-invoice`, `project-wo`, `local-wo`, `subcontractor-invoice`).

**WO 73850 cent correction.** The legacy calculator hard-codes a one-cent
correction for this single order. It is reproduced exactly and only behind
`applyLegacyCentCorrection`, guarded by `LEGACY_CENT_CORRECTION` (id 73850,
accumulated tax `13262.85`, corrected `13262.84`). It is applied before any
manual override, and the snapshot reports `legacyCentCorrectionApplied`. This is
recorded debt, not general behaviour; remove it when Invoicing confirms the
legacy record no longer needs it.

## Numbering (C4)

`lib/numbering.ts` implements the intended `wo_next_pid` behaviour: read the
series counter, skip numbers already used in the app (and, when strict, in
Sage), and never return `null`.

- Default is **legacy-permissive** (`WORKORDER_NUMBERING_STRICT` unset). The
  legacy second check against `tcustr.sSource` / `tProject.sName` is broken; in
  permissive mode a Sage collision cannot be verified, so the allocator warns and
  proceeds. It still refuses an app-side collision rather than silently reusing
  a number.
- Strict mode (`WORKORDER_NUMBERING_STRICT=true`) skips app collisions and
  refuses to allocate when Sage cannot be verified.
- The documented defect (`get_next_woid()` returns `null`) is treated as a
  refusal, not an empty number: with strict numbering and a free counter the
  intended result is `900501`.
- `server/numbering.server.ts` locks the series row with `SELECT … FOR UPDATE`
  and writes the counter back only after a successful insert.

Sage collision lookup is an optional capability on `@cls/sage`
(`server/sage-collisions.server.ts`). The adapter has no business-query
capability yet, so it honestly reports "unverifiable" rather than inventing a
match. The seam and its test hook are ready for the Sage module.

## Authorization

Permission keys (append-only in `packages/core/src/permissions.ts`):

| Key | Default roles |
| --- | --- |
| `workorder:read` | admin, technician, subcontractor |
| `workorder:write` | admin, technician |
| `workorder:create` | admin |
| `workorder:dispatch` | admin |
| `workorder:approve` | admin |
| `workorder:capture` | admin, technician, subcontractor |
| `workorder:override_wsib_hold` | admin |

Scopes are resolved server-side from role and grants: subcontractor users see
only work orders assigned to their company, technicians only those they are
assigned to, suppliers none. A scoped miss is a `404`, not a `403`, so the
existence of another company's record is not disclosed. The portal routes prove
the same rules the API enforces; hiding a button is never the control.

**Invoice-ready totals** additionally require `invoice.calculate` (admin-only in
the current role set). Without it the snapshot still returns the inputs and line
amounts but withholds totals with `totalsWithheldReason: 'invoice.calculate'`.
The shared calculator is exposed for preview only; Invoicing remains the
authority that persists and posts an invoice.

## Known gaps

- No Sage number verification until the Sage module offers a business query.
- No invoice persistence, numbering or Sage posting here (by scope).
- The legacy mirror is empty in the current Neon branch, so pickers show no real
  customers, sites, subcontractors or parts. Integration tests seed their own
  rows inside rolled-back transactions; the Playwright path seeds and cleans up
  its own rows.
- Playwright skips unless `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`,
  `NEON_AUTH_BASE_URL`, `APP_URL` and `E2E_DATABASE_URL` (or `DATABASE_URL`) are
  set. `e2e/support/throwaway.ts` follows `MODULE-CONTRACT.md` §8.2.
- The list is keyset-paginated and count queries are per view; very large
  archives may need a materialised count later.

## What the next module copies

1. `types.ts` for client-safe shapes; `lib/` for pure rules with colocated tests.
2. `server/*.server.ts` for implementation, `*.functions.ts` for thin
   `createServerFn` + `.validator()` + middleware wrappers; dynamic server-only
   imports inside handlers.
3. `server/access.server.ts` for scope resolution and `NotFound` on scope miss.
4. A transaction that writes the business change, the audit row and the revision
   together; version-checked conditional updates returning `409`.
5. Saved views in the URL (`validateSearch` + `parseListSearch`) and keyset
   cursors, not offsets.
6. Append-only permission keys, seeded defaults, and denial tests at the server
   boundary (plus one browser denial path).
7. A module README that names legacy parity, deliberate divergence and debt.

## Verify

```bash
pnpm typecheck
pnpm lint
pnpm test          # includes the DB integration suite when DATABASE_URL is set
pnpm build
pnpm test:e2e      # signed-in path when the E2E env is present
```
