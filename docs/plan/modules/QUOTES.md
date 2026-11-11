# Quotes module — plan

**Status:** implementation in progress. **Owner:** Quotes workstream.
**References:** `green-system/MODULES.md` §3, `green-system/BUSINESS-RULES.md` H1–H4,
`green-system/DATA-DICTIONARY.md`, `plan/adr/0011-pdf-generation.md`,
`modules/MASTER-DATA.md`, `plan/modules/WORK-ORDERS.md`.
**Repo target:** `apps/web/src/modules/quotes/`, `packages/db/src/schema/app/quote.ts`,
`packages/pdf/`.

## 1. Scope and boundary

In scope: **customer quotes** and **standalone quotes**, their labour/parts/special-part lines,
incurred cost columns for margin, lifecycle 1→3→4/5 (2 Saved standalone-only), revisions,
rejections and resubmission, soft delete and `created_from_local` for standalone, quote → work
order conversion, customer quote PDF, packing slips.

Out of scope: subcontractor quotes, TJX quotes, invoicing, Sage posting, customer portal. Those
modules consume this one later.

## 2. Forward model

`packages/db/src/schema/app/quote.ts`:

- `quotes` — one header for both kinds (`kind = customer | standalone`), quote `id` is the
  customer-facing number. Fields mirror `customer_quote`/`standalone_quote` but use app keys:
  `site_id` (master data), `work_order_number`, ship-to snapshot, status, tax code/rate, manual tax,
  due date + `is_due_date_tbd`, `date_approved`, `created_by`, `version`.
  Revision chain: `is_revision`, `revision_quote_id` (immediate predecessor), `root_quote_id`,
  `revision_id` (legacy float), `is_last_revision` with a partial unique index on
  `coalesce(root_quote_id, id)` where the flag is true.
  Standalone: `is_deleted`, `created_from_local`.
- `quote_hours` — date, hours, `num_techs`, rate, incurred hours/rate, note.
- `quote_parts` / `quote_special_parts` — sell price plus `cost_price`; legacy separate
  `*_incurred` tables become parallel columns on the same line.
- `quote_rejections` — reason, content snapshot, rejected-by detail and timestamp.
- `quote_packing_slips` + `quote_packing_parts` + `quote_packing_special_parts`.
- `generated_documents` — platform PDF record per ADR 0011 (snapshot, schema version, hash, key,
  page count).

Legacy `public.customer_quote*`, `standalone_quote*`, `rejected_quotes`, `customer_qo_packing_*`
are read-only mirrors and are not written by this module.

## 3. Pricing

`packages/pricing` gains `calculateQuoteTotals`, not a fork. Shared decimal/rounding helpers.
Confirmed quote differences from the invoice calculator:

1. labour is `hours × num_techs × rate`;
2. incurred lines are a parallel cost basis and **never** enter the customer subtotal or tax (the
   legacy quote PDF sums sell lines only; the staging JS's inclusion of incurred lines is not
   reproduced);
3. `manual_tax_amount` is honoured as typed, without requiring the posted subtotal to match (the
   PDF prints `tax_amount` when non-empty).

Per-line rounding and accumulated per-line tax remain identical. Fixtures:
`packages/pricing/fixtures/quote.json`, tested by `src/quote.test.ts` with case ids in test names.

## 4. Numbering (H4)

Customer quotes reserve a number from the **Work Orders** series at creation through
`allocateWorkOrderNumber` + `commitWorkOrderNumber`; there is no quote counter. The reserved number
is `quotes.work_order_number` and is the customer-facing quote number. Conversion creates the work
order with that exact number through `createWorkOrderCore(..., { workOrderNumber })`.
Standalone quotes keep their quote `id`; conversion takes a number from the same allocator then.

## 5. Lifecycle and revisions (H1/H2)

Transition table in `lib/status.ts`:

```
1 In Progress → 2 Saved (standalone), 3 Waiting for approval, 5 Cancelled
2 Saved       → 1, 3, 5
3 Waiting     → 4 Approved, 5 Cancelled
4 Approved    → (none; issue a revision)
5 Cancelled   → (none; resubmit through a revision)
```

Approval requires `quote:approve` and stamps `date_approved` in America/Toronto. Every transition
is version-checked and audited; illegal changes return both statuses and the legal next set.
Revisions are new rows: copy header/lines, `is_revision`, predecessor id, root id, `revision_id`
+0.1, clear the previous chain end. Rejection records `quote_rejections` and sets 5; resubmission is
a revision starting in 3.

## 6. Conversion

`server/convert.server.ts` requires approved + current + unconverted, `quote:approve` and
`workorder:create`, builds a Work Orders create input (first service type/priority, site, report),
calls the Work Orders core, then stamps `converted_work_order_id`. It never inserts into
`app.work_orders` or writes the legacy `workorder` table directly.

## 7. PDF and packing slips (ADR 0011)

`@cls/pdf` owns layout: `DocumentShell`, `BrandHeader`, `AddressBlock`, `LineTable`, `Totals`,
`Notes`; Letter portrait 612×792; vendored Instrument Sans 400/500/600 + Libre Caslon Text 400
(OFL) registered once with hard failure if missing. Quotes supplies a Zod-validated
`schemaVersion: 1` DTO only. PDFs are stored in the private `accounting` bucket under
`generated/<kind>/<yyyy>/<mm>/<uuid>.pdf` and recorded in `app.generated_documents` with hash,
byte size, page count and the data snapshot. Regeneration uses the stored snapshot.

## 8. Authorization

`quote:read` for list/detail/PDF, `quote:write` for create/edit/revise/delete, `quote:approve` for
approve/reject/resubmit. Quotes are office-only today: even roles carrying `quote:read`
(subcontractor) are denied until a customer quote portal exists; the server check is authoritative.
Conversion adds `workorder:create`.

## 9. Verification plan

- Unit: lifecycle table and messages, revision/conversion eligibility, pricing fixtures.
- Integration (rolled-back Neon transaction): reserve → submit → approve → convert uses the same
  WO number; revision chain; rejection/resubmission; standalone Saved/soft delete; illegal
  transition; subcontractor/technician/supplier denials; packing slip + generated document.
- E2E (signed-in): create customer quote → submit → approve → convert; assert the WO number.
- `pnpm verify` green; no direct inserts into quote tables or `app.work_orders` outside their
  owning modules.

## 10. Milestones

1. Plan published (this document).
2. Schema + pricing + customer quote create/edit with live totals.
3. Lifecycle, revisions, rejection/resubmission.
4. Standalone quotes.
5. Quote → WO conversion.
6. PDF + packing slips via `@cls/pdf`.
7. Tests, E2E, verify, commit.

**Shared-folder note:** `droid space` is not available in the installed CLI (0.233.0), so this plan
lives in the repo until the shared folder can be written.
