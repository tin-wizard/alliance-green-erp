# Inventory

Stock counters, the movement ledger, stock adjustments, the single price-write path,
subcontractor stock visibility and stock reports.

## Boundary

- Owns `app.inventory_movements`, `app.part_stock_adjustments`, `app.part_price_locks`,
  `app.sub_stock_messages`, `app.sub_stock_notifications`, `app.part_price_history` and the
  stock/price columns on `app.parts`.
- Purchasing calls `postPurchaseReceipt` inside its receipt transaction. Work Orders calls
  `postWorkOrderPartSale` inside `capturePartsCore`. Neither writes counters directly.
- Master Data owns part identity and shows prices read-only. It rejects every price field
  (`lib/write-validation.ts`); only this module may write `cost`, `sell_price`,
  `install_price`, `recycle_price` or a rate-card price.
- Legacy `public.*` tables are read-only.

## Counters (BUSINESS-RULES E1/E4)

`parts.current_quantity` is authoritative and is never derived from the ledger.

- Sale: `sold_quantity += qty`, `current_quantity -= qty`.
- Purchase receipt: `purchased_quantity += qty`, `current_quantity += qty`.
- Adjustment: `current_quantity += signed qty`.
- Current stock may go negative, exactly as the legacy counter did.
- Reports show the counter beside the ledger total. A difference is a legacy fact to surface,
  never a correction. `softDeleteMovement` and `excludeMovementFromStock` leave counters alone.

## Ledger

`inventory_movements` is the single ledger. It keeps the legacy vocabulary and columns:
`transaction_type` (`Sale`/`Purchase`/`Adjustment`), `woid_poid`, `invoice_number`,
`invoice_id`, `adjustment_type`, `on_field_counted_qty`, `adj_subcontractor`, `adj_site`,
`is_log_deleted`, `is_included_in_stock_management`. A work-order sale duplicates the work-order
id into all three legacy id columns; forward `document_type`/`document_id` answers the same
question without relying on the duplication.

Every insert has an idempotency key (`purchase-receipt:<receipt>:<line>`,
`workorder-sale:<wo>:<line>`, `adjustment:<id>`), so retries post nothing twice.

## Adjustments

`adjustPartStockCore` records `part_stock_adjustments` with a signed quantity, type, reason,
work-order/site/subcontractor attribution and the actor, then posts the matching ledger row.
The adjustment table's `idempotency_key` makes a replay return the original row.

## Price lock and price writes (E5/E6)

One row (`app.part_price_locks.id = 1`) is a mutex over the global editor.

- Acquisition takes a row lock, then a 15-minute TTL. The UI renews it with a heartbeat every
  60 seconds and shows the remaining time.
- A second user is blocked while the TTL is live.
- An expired lock stays visible with its holder and expiry. It is never cleared by a timer.
  Takeover needs `takeOver: true` and a reason, and writes an audit event.
- `savePartPricesCore` requires the caller to still hold a live lock, diffs part prices and
  rate-card prices, and writes `part_price_history` in the same transaction as the change.

## Subcontractor stock (E7)

`listSubStockPortal` is scoped server-side to the signed-in subcontractor. It returns only
parts with `subignore = false`, stock messages and the low-stock subscription. Marking a
message read checks ownership. The subscription is unique per subcontractor notification code.

## Reports

- `listStockParts` — parts stock with counter, ledger total and difference.
- `movementReport` — purchased detail, sold detail and complete detail.
- `stockCounterDisagreements` — every part whose counter and ledger disagree.
- `partPriceHistory` and `getPartPriceEditor` — price history and rate-card values.

## Divergences from the legacy implementation

1. **Atomic counters and ledger.** The legacy updated counters and appended the ledger without
   an explicit transaction. Both happen in one transaction here so a failed move leaves neither.
2. **Idempotent posting.** Receipt, sale and adjustment posting use unique keys. The legacy could
   double-post on a retried request.
3. **The price lock is explicit.** The legacy cron released it after one hour with no signal.
   The TTL is 15 minutes, visible, heartbeat-renewed, and an expired lock is surfaced with a
   reasoned, audited takeover instead of silently becoming free.
4. **One ledger table.** `parts_salepurchase_log`, `parts_inventory` and
   `parts_inventory_adjustment` are represented by `inventory_movements` plus
   `part_stock_adjustments`. Legacy columns are retained so historical queries still read.
5. **Negative local ids.** Parts auto-created by a movement (E3) take the negative local id
   space, so they cannot collide with a Sage id.
6. **No recurring quarterly stock PDF cron.** `cron_sub_stock.php` generated and emailed a
   quarterly PDF. This module stores the notification/message and subscription and exposes the
   portal; scheduled PDF generation is not part of this slice.

## Tests

- `lib/stock.test.ts` — counter arithmetic, negative stock, precision, counter/ledger difference.
- `lib/price-lock.test.ts` — free/held/expired/takeover decisions.
- `server/inventory.integration.test.ts` — adjustments and replay, receipts, sales, E4 reporting,
   the price lock (denial, expiry, takeover, refresh, release), rate-card history, sub-stock
   visibility and ownership, plus a committed two-writer lock race.
- `e2e/inventory.spec.ts` — signed-in adjust → price change under the lock → sub-stock visibility
  with an ignored part hidden.
