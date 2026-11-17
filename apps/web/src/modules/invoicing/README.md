# Invoicing

Customer sales invoices and subcontractor purchase invoices. Work Orders produces
the invoice-ready snapshot; this module is the only writer of invoice records and
the only place that issues, rejects, posts and records payments.

## Invariants

- Money comes from `@cls/pricing` through `lib/money.ts`. The server stores the
  operator-posted totals and never recalculates them on save (A5). Preview is a
  separate `invoice.calculate` call (D13).
- Labour is mandatory on save and issue. Negative quantities and prices are
  legal because credits use them (A7/A8). The `---` part placeholder is rejected
  in the calculator, the Zod entry schemas, draft save and the Sage payload (C6).
- Saving replaces the whole line set; there is no line-level edit (B1).
- Issue is the only path that creates the PDF, queues the Sage outbox row and
  increments the version. Reject records the reason and snapshot in
  `rejected_invoices`; resubmit returns the invoice to draft for a new snapshot.
- A locked invoice (`invoice_stock_postings`, a sent/unknown Sage posting, or a
  legacy `sage_sales_done` / `stock_updated` / `only_portal_stock_updated` flag)
  cannot be edited, issued, rejected or resubmitted (B3).
- Posting is queued, never synchronous. `/api/cron/sage-postings` drains the
  outbox with `SAGE_CRON_SECRET`; the fake gateway is idempotent by
  `cls:<docType>:<id>` so a retry links the existing document.
- Payments are append-only with an idempotency key; status is derived from the
  total paid. Subcontractor invoices are scoped by `app.users.subcontractor_id`
  and return not-found for another company's document.

## Divergences from legacy invoice semantics

1. **Numbering.** Legacy assigned invoice numbers from a mutable sequence and
   could collide (defect 900501). This rebuild uses one invoice per work order
   (`sales_invoices.work_order_id` unique) and reserves `INV-<workOrderId>` as
   the internal number. Sage receives the same number; an external document
   number can replace it when the Sage adapter is chosen.
2. **Stock.** Inventory decrements stock when a part is captured on the work
   order, not when the invoice is issued. Issue therefore writes no new stock
   movement. `invoice_stock_postings` records any stock posting that does occur
   and is part of the immutability guard, equivalent to the legacy flag without
   pretending a posting happened.
3. **Calculator gate.** The legacy username gate (carmen, ASzpytka) is replaced
   by `invoice.calculate`, held by admins (D13). Totals are withheld server-side
   from a session without it.
4. **Sage.** The production adapter is not selected. The shipped gateway is a
   deterministic fake behind `SageInvoiceGateway`; failures leave the posting
   `failed` and the invoice issued, never rolled back.
5. **Due dates and terms.** Legacy had no invoice-level terms; the stored
   `due_date` is nullable and the PDF omits it until an operator sets it.
6. **Subcontractor invoices.** The legacy ServiceChannel (`sc_inv_*`) and
   `tjx_sub_invoice` shapes are not mirrored. Subcontractor invoices are one
   line table with kind `labour|part|special`, free of portal-specific columns,
   because the portal stores those variants outside this module.
7. **Sage project id.** Legacy defaulted the Sage project to the work-order id
   (B6). The payload carries `workOrderNumber`; the fake ignores it and a real
   adapter must map it explicitly rather than inherit a hidden default.

## Tests

- `lib/money.test.ts` — all 28 captured sales-invoice fixture cases through the
  same preview path the UI calls.
- `server/invoicing.integration.test.ts` — snapshot create, wholesale edit,
  issue, rejection/resubmission, payments and idempotency, stock-posting lock,
  Sage outbox idempotency, byte-identical PDF regeneration, subcontractor
  submit/approve/pay and cross-company denial.
- `e2e/invoicing.spec.ts` — signed-in lifecycle, work-order rejection visibility,
  subcontractor submit/approve and cross-subcontractor denial.
