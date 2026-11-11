# Purchasing

Purchase orders, receiving, supplier invoices, pre-orders and RFQs.

## Boundary

- Owns `app.purchase_orders*` (orders, lines, receipts, invoices, approvals, history,
  pre-orders, RFQs, supplier quotes).
- Calls `apps/web/src/modules/inventory/server/stock.server.ts` to post a receipt. The
  inventory slice records the append-only ledger; Inventory owns counters and reporting.
  Purchasing never writes `parts.current_quantity`.
- Legacy `public.purchaseorder*` is read-only. The backfill reads it once and writes the
  exception report.

## Status model

The eleven legacy codes are preserved. `lib/status.ts` holds the only transition table and
the permission mapping. Receipt and invoice statuses are produced by their services, never by
the general transition action.

## Approval control

- `po.approve` approves or challenges; `po.issue` issues.
- Self-approval is legal for a user holding both `purchasing:write` and `po.approve`. The
  approval row and status history record the approver, timestamp, approved PO version and
  `self_approved`.
- Editing an approved, submitted or in-transit order clears approval and drops it to Saved
  (status 3). It must be approved again before issue. This is the primary control and is
  covered by the integration test.
- No username comparisons. Grants live in `packages/core/src/permissions.ts` and the seed.

## Receiving and invoicing

- A receipt is one event with lines. Stock posts once, in the receipt transaction, keyed by
  `idempotency_key`; retries return the existing receipt and post nothing.
- Over-receipt needs `po.approve` and a reason. Partial delivery keeps status 5; the final
  receipt derives status 4. Short-close and cancellation after receipt require `po.approve`
  and a reason; received stock is never reversed here.
- An invoice before delivery is `pending_receipt` and cannot close the PO. Receiving releases
  it to `matched`/`draft`. Closing requires status 4, all received quantity invoiced, and
  `invoice:issue`; a variance needs an accepted reason.

## Supplier credits

- A credit is a supplier-invoice-shaped document with negative quantities, stored in
  `purchase_order_invoices`/`purchase_order_invoice_lines`. It reduces the open AP balance and
  never the ordered quantity.
- The ordinary invoice path stays positive-only: `createPurchaseOrderInvoiceCore` still rejects
  `qty <= 0`. Credits are created only by `createSupplierCreditCore` in `server/credits.server.ts`,
  through the `createSupplierCredit` server function.
- Source is explicit: `{ purchaseOrderId }` or `{ rgaReference }`. An RGA-sourced credit derives
  its PO from the part lines it corrects (one PO per credit) and uses the RGA reference as the
  document reference when none is supplied.
- Line money reuses the invoice helpers (`invoiceLineAmounts`), so a credit for the same lines and
  rates is the exact negative of the invoice, to the cent. Each line states its own `taxRate`.
- A credit cannot take a PO line below zero invoiced quantity; that is the mirror of the invoice
  cap at the ordered quantity. Credits leave PO status, ordered prices and received quantities
  untouched.
- Purchasing has no AP ledger. `apAccountId` is carried on the credit's audit payload for the
  posting adapter; the audit action is `purchase_credit.created`.

## Money

`calculatePurchaseOrderTotals` in `packages/pricing` uses `purchaseTaxRate` (purchase table),
rounds each line to 2dp and accumulates per-line tax. It is not the sales tax table; historical
PO totals that differ are reported by the backfill, never restored at runtime.

## Commands

- `pnpm db:backfill:purchasing` — dry-run, writes `reports/purchasing-migration-exceptions.*`.
- `pnpm db:backfill:purchasing -- --apply` — writes the purchasing tables (pass the flag to the
  root script explicitly).
- `pnpm check:boundaries` — table and stock-ledger ownership gates, also part of `pnpm verify`.

## Tests

- `lib/status.test.ts` — every legal and illegal status pair, permission mapping, numbering.
- `server/purchasing.integration.test.ts` — rolled-back Neon transactions for self-approval and
  the edit reset, denied approval, receipts/idempotency/over-receipt/cancel, invoice gate,
  supplier credits (negative totals, invoice sign regression, the invoiced-quantity cap, AP
  balancing, permission), numbering, RFQ award and pre-order conversion idempotency.
- `e2e/purchasing.spec.ts` — signed-in draft → request → self-approve → issue → receive →
  invoice → invoiced, denied technician approval, supplier isolation.
