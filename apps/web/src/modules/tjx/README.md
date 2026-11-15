# TJX program

Fixture quotes for TJX banners. This module owns rooms, room templates, fixtures,
fixture parts, subcontractor rates, quotes and their lifecycle, work-order
conversion, quote documents, and the subcontractor TJX invoice with its three
evidence gates.

## Boundaries

- No money math here. The two quote triplets and the subcontractor purchase
  total come from `@cls/pricing`; every save and submit recalculates server-side.
  The without-markup line prices the raw accumulated quantity; its 3-decimal
  quantity is display only (N7).
- No direct work-order insert. Conversion calls `createWorkOrderCore`.
- No direct invoice lifecycle. A TJX subcontractor invoice hands its financial
  document to Invoicing's `createSubcontractorInvoiceCore`, and approval or
  rejection goes through `approveSubcontractorInvoiceCore` /
  `rejectSubcontractorInvoiceCore`. This module does not edit Invoicing tables or
  code.
- Resubmission passes `<invoice_number>-R<revision_no>` to Invoicing because
  `unique(subcontractor_id, invoice_number)` is load-bearing. The TJX row keeps
  the subcontractor's original number and links the newest standard invoice.
- No part price writes. `parts.sell_price`, `cost` and `installCostPerUnit`
  belong to Inventory; TJX rates live in `tjx_subcontractor_rates`. Reading or
  editing a rate card requires `report.download_rates`, granted to admin — the
  role the legacy username-gated rate sheets and admin-only rate editor served.
  Saving also requires `tjx:write`.
- No duplicate work-order parts table. Work-order parts stay in Work Orders.

## Subcontractor invoice

The portal page is `/portal/sub/tjx-invoices`. It lists approved TJX work orders
assigned to the signed-in subcontractor. A draft copies the quote fixtures;
installed quantities expand through the quote snapshot's markup and ratio, then
each part resolves to the rate table for that subcontractor. Missing rates are
reported by part and block final submit. Each of the three gates records a flag
only after a work-order document of the matching kind is linked; final submit
rechecks both. Approval queues one Sage posting and moves a Complete work order
to Pending Invoice.

Office review lives at `/tjx/invoices` and requires `tjx:read`; approve and
reject additionally require Invoicing's `invoice:write`.

## Exports and import

The quote list exports `Waiting for Approval Parts` (status 3) as XLSX with the
summary sheet plus one sheet per province. Only the enumerated TJX part family
contributes: `WIN-%` and `1240`, `10000`, `10002`, `10003`, `10098`. `exceljs`
is imported dynamically on the server and the workbook is never persisted.

`scripts/import/tjx.ts` reads the `public.tjx_*` mirror, defaults to a dry run,
and reports missing parents instead of inventing them. See
`docs/modules/tjx-import-dry-run.md` for the production result.

## Data notes

`tjx_rooms_template` is authoritative. Migration `0010` creates one empty
**Default Room Template**. The 37 recovered template rows carry only room ids and
sort order; the matching `tjx_room` names are InnoDB-lost in the archive. The
live-dump import fills the names and rows, and the migration never invents them.

## Permissions

`tjx:read` and `tjx:write` already exist with admin/technician defaults. Quote
approval reuses `quote:approve`; subcontractor invoice approval uses Invoicing's
`invoice:write`.

