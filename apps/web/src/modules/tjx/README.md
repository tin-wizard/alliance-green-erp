# TJX program

Fixture quotes for TJX banners. This module owns rooms, room templates, fixtures,
fixture parts and subcontractor rates; later milestones add quotes, work-order
conversion, subcontractor invoices, PDFs and exports.

## Boundaries

- No money math here. The two total triplets come from `@cls/pricing`.
- No direct work-order insert. Conversion calls `createWorkOrderCore`.
- No direct invoice lifecycle. A TJX subcontractor invoice hands its financial
  document to Invoicing's `createSubcontractorInvoiceCore`.
- No part price writes. `parts.sell_price`, `cost` and `installCostPerUnit`
  belong to Inventory; TJX rates live in `tjx_subcontractor_rates`.
- No duplicate work-order parts table. Work-order parts stay in Work Orders.

## Data notes

`tjx_rooms_template` is authoritative. Migration `0010` creates one empty
**Default Room Template**. The 37 recovered template rows carry only room ids and
sort order; the matching `tjx_room` names are InnoDB-lost in the archive. The
live-dump import fills the names and rows, and the migration never invents them.

## Permissions

`tjx:read` and `tjx:write` already exist with admin/technician defaults. Quote
approval reuses `quote:approve`; subcontractor invoice approval uses Invoicing's
`invoice:write`.
