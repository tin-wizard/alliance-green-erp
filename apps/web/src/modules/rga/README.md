# RGAs and warranties

Returns raised against a supplier and, where known, a purchase order and work
order; the supplier credit that settles them; and the site warranties that
decide who pays.

## Tables

| Table | Purpose |
| --- | --- |
| `app.rgas` | Header. Raw legacy status code, supplier, optional PO/WO/site/subcontractor, version. |
| `app.rga_parts` | Part return lines, including `po_part_id` when the row corrects a purchase-order line. |
| `app.rga_special_parts` | Special-part return lines. |
| `app.rga_status_history` | Every transition and edit, with actor and version. |
| `app.rga_credits` | One supplier credit per RGA. Purchasing owns the accounting document; this is the RGA's link to it. |
| `app.rga_credit_lines` | Positive display copy of the credited lines. |
| `app.rga_notifications` | Durable outbox for submission and reminder notifications. |
| `app.site_warranties` | Master Data table, extended with `work_order_id` and `created_by`; written here. |

## Status vocabulary

The database stores the legacy code, never a label. Display projection lives in
`lib/lifecycle.ts`.

| Code | Meaning | Moves to |
| --- | --- | --- |
| 2 | Active | 3 Saved, 10 Cancelled |
| 3 | Saved | 7 In Transit, 10 Cancelled |
| 7 | In Transit | 6 Received, 10 Cancelled |
| 6 | Received | 4 Completed, 10 Cancelled |
| 4 | Completed | terminal |
| 10 | Cancelled | terminal |
| 11 | Invoiced | terminal, reached only by recording the credit |

Codes 1, 5, 8 and 9 never exist in the legacy data and are refused. Approval is
`2 → 3`; every other move uses `transitionRgaCore`. Recording a credit is the
only path to 11.

## Correction path (boundary decision)

A return credit is accounting work. It is **not** implemented here, and the
legacy `poid = -2` / negative-purchase-invoice shape is deliberately not
reproduced.

`server/credit.server.ts` computes the credited quantity and amount from the RGA
return lines, then calls Purchasing's shared core:

```ts
createSupplierCreditCore(tx, {
  source: { purchaseOrderId: rga.poId },
  supplierId,
  creditDate,
  reference: `R-${rga.id}`,
  apAccountId: '21000000',
  lines: [{ partId, qty: '-2.00', rate, taxRate }],
}, session)
```

Purchasing owns:

- the negative `purchase_order_invoices` row and its lines;
- the cap that stops a credit reducing invoiced quantity below zero;
- the price-variance calculation and the AP-balancing account;
- the audit event `purchase_credit.created`.

RGA stores only the resulting credit identity and its display lines, then queues
the Sage posting. A credit needs a purchase order and a supplier on the RGA; a
special-part-only credit still works because the RGA names the PO explicitly
rather than making Purchasing derive it from part ids.

## Sage

`recordRgaCreditCore` writes one `sage_postings` row inside the same transaction:

- `doc_type = 'purchase_credit_note'`
- `external_ref = 'cls:rga_credit:<creditId>'`
- `payload` is `SageCreditNotePayload`: negative `subtotal`, `tax`, `total`, and
  negative line quantities, so the mapper's `net + tax = total` invariant holds.

The platform posting worker routes that doc type to
`SageInvoiceGateway.postPurchaseCreditNote`; the mapper (`mapPurchaseCreditNote`)
is adapter-internal. RGA never calls the gateway inline.

## Notifications

`cron_rga_notification.php` becomes the ADR 0012 job
`purchasing.rga-notifications` (07:15 weekdays, America/Toronto). The job only
writes durable `rga_notifications` rows; delivery is separate.

- One reminder per open RGA at most every seven days.
- `idempotency_key = 'rga:<id>:reminder:<YYYY-MM-DD>'`, so a retry or a second
  run on the same business date adds nothing.
- The handler is `server/job.server.ts`; the scheduler bootstrap calls
  `registerRgaNotificationsJob()` once. Until that import exists the catalogue
  records `skipped: handler_not_registered` rather than failing.

## Warranties

`site_warranties` now records `expires_on`, an optional work-order link and the
actor who recorded it. `listSiteWarranties` projects `expired`, `expiring`
(within 30 days) and `active`; the same projection drives the warranty screen
and the summary counters. A warranty's work order must belong to the same site.

## Divergences from CLS Green System

- A credit is its own `rga_credits` document, not a negative purchase invoice
  with `poid = -2`. The accounting document is Purchasing's supplier credit.
- Raw status codes are stored; no screen writes a label.
- Reminders are queued in a durable outbox rather than sent by a cron script.
- RGA PDFs are stored with a hash and schema version and can be regenerated
  byte-identically from the snapshot.
- Subcontractors see only their own company's RGAs; the server enforces the
  scope on every read and write.
