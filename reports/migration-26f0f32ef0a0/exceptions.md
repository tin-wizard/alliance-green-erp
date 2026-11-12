# Legacy migration exception report

Generated 2026-11-12T07:48:40.462Z (rehearsal).

Dump `sha256:26f0f32ef0a0e13c5d24778df1885f019abe1f26a0da4fa5a3c5297373e8d9d9`, manifest 2026-11-12.2, commit rehearsal.

141 recorded exceptions in 20 classes, 0 row errors.

A class marked "policy skip" is a decision the migration makes on purpose; everything else needs an owner.

## blank_money

Blank money values. Owner: finance.

Stored NULL wherever the target allows it. Where the column is NOT NULL the row stores 0.00 and says so in its action; nothing is blank-filled silently.

Count: 13

| Entity | Source key | Rows | Action | Decision |
|---|---|---:|---|---|
| invoice_tax | `1` | 1 | subtotal stored from the invoice lines: the posted subtotal is blank and the column is NOT NULL | pending (subtotal_amount = "", line subtotal = 305.12) |
| invoice_tax | `3` | 1 | subtotal stored from the invoice lines: the posted subtotal is blank and the column is NOT NULL | pending (subtotal_amount = null, line subtotal = 85.24) |
| purchase_order_invoice | `2` | 1 | stored 0.00 because the target column is NOT NULL | pending (total_amount = "") |
| purchase_order_invoice | `3` | 1 | stored 0.00 because the target column is NOT NULL | pending (shipping_charges = null) |
| purchase_order_invoice | `4` | 1 | stored 0.00 because the target column is NOT NULL | pending (sub_total = null) |
| purchase_order_invoice_part | `2` | 1 | stored 0.00 because the target column is NOT NULL | pending (linetotal = "") |
| purchase_order_part | `10` | 1 | stored 0.00 because the target column is NOT NULL | pending (price = "") |
| purchase_order_part | `2` | 1 | stored 0.00 because the target column is NOT NULL | pending (price = "") |
| purchase_order_special_part | `1` | 1 | stored 0.00 because the target column is NOT NULL | pending (qty = null) |
| purchase_order_special_part | `2` | 1 | stored 0.00 because the target column is NOT NULL | pending (price = "") |
| purchase_order_special_part | `4` | 1 | stored 0.00 because the target column is NOT NULL | pending (price = null) |
| rga_part | `2` | 1 | return_qty stored 0: the column is NOT NULL and the source value is blank | pending (return_qty = null) |
| tjx_sub_invoice | `1` | 1 | stored 0: the column is NOT NULL and the source value is blank | pending (tax_amount = null) |

## blank_tax

Blank tax on invoices. Owner: finance.

Stored NULL and counted separately from zero tax. Decide whether to backfill from Sage.

Count: 3

| Entity | Source key | Rows | Action | Decision |
|---|---|---:|---|---|
| invoice_tax | `1` | 1 | tax stored 0 (NOT NULL column) and applied_tax_rate stored NULL; no default rate applied | pending (tax_amount = "", appliedtaxrate = "13.000") |
| invoice_tax | `3` | 1 | tax stored 0 (NOT NULL column) and applied_tax_rate stored NULL; no default rate applied | pending (tax_amount = "n/a", appliedtaxrate = "13.000") |
| invoice_tax | `4` | 1 | tax stored 0.00 as posted (a real zero, not a blank); applied_tax_rate kept as recorded | pending (tax_amount = "0.00") |

## disabled_user

Disabled users. Owner: admin.

Migrated disabled, with no credential and no invitation. History is retained.

Count: 3

| Entity | Source key | Rows | Action | Decision |
|---|---|---:|---|---|
| user | `3` | 1 | migrated disabled: no credential, no invite, history retained | pending (is_enabled = "0") |
| user | `4` | 1 | migrated disabled: no credential, no invite, history retained | pending (is_enabled = "0") |
| user | `5` | 1 | migrated disabled: no credential, no invite, history retained | pending (is_enabled = "0") |

## duplicate_sage_item

Two parts claim one Sage item. Owner: operations.

The part is kept with a NULL sage_item_id; the row that already owns the item keeps it. Merging two stock records is a decision, not a migration step.

Count: 1

| Entity | Source key | Rows | Action | Decision |
|---|---|---:|---|---|
| part | `10` | 1 | part kept, sage_item_id stored NULL | pending (sage_id 1 already belongs to part 1) |

## duplicate_username

Duplicate usernames. Owner: admin. **Policy skip.**

Two legacy accounts share a username. One canonical account is kept and the other is quarantined before any credential exists.

Count: 1

| Entity | Source key | Rows | Action | Decision |
|---|---|---:|---|---|
| user | `2` | 1 | account not created: the first row with this username is kept | pending (username = "jsmith"; kept legacy id 1) |

## no_email

Accounts without an email. Owner: admin.

No invitation can be sent. Office verifies identity by phone and issues a one-time code.

Count: 2

| Entity | Source key | Rows | Action | Decision |
|---|---|---:|---|---|
| user | `7` | 1 | placeholder address stored; no invitation can be sent | pending (users.email is NOT NULL; office verifies identity by phone and issues a one-time code) |
| user | `9` | 1 | shared address replaced by a placeholder; onboarding is office-assisted | pending (email is already used by legacy id 8) |

## not_migrated

Tables deliberately not migrated. Owner: operations. **Policy skip.**

Audit/history tables with no target in the new schema. Counted once per table, with the reason.

Count: 26

| Entity | Source key | Rows | Action | Decision |
|---|---|---:|---|---|
| customer_email | `customer_emails` | 1 | kept in the read-only legacy mirror only; no app table exists | pending (legacy generic e-mail list with no customer key; the forward model keeps one contact e-mail on app.customers) |
| invoice_project | `inv_project:all` | 5 | not migrated: no target column in the app schema | pending (legacy Sage project link (sage_project_workorder); app.sage_links.external_id is an API id, not a project name, so the link stays in staging and finance reconciles posted invoices by work-order number) |
| part_inventory | `parts_inventory:all` | 4 | not migrated: no target table in the app schema | pending (per-shipment batch (cost, sell, markup, sold counter) with no target table; app.parts keeps the authoritative counters (E4) and the rows stay in staging) |
| part_purchased_inventory | `parts_purchased_inventory:all` | 3 | not migrated: no target table in the app schema | pending (purchase lines of a supplier invoice; the purchasing module owns receipts, and importing these beside parts_salepurchase_log would count every receipt twice) |
| part_purchasing_log | `parts_purchasing_log:all` | 3 | not migrated: no target table in the app schema | pending (earlier purchase write path superseded by parts_salepurchase_log, which is the ledger of record (DATA-DICTIONARY); importing both double counts purchases) |
| part_selling_log | `parts_selling_log:all` | 3 | not migrated: no target table in the app schema | pending (earlier sale write path superseded by parts_salepurchase_log, which is the ledger of record (DATA-DICTIONARY); importing both double counts sales) |
| po_notification | `po_notification:all` | 3 | not migrated: no target table for a subscription | pending (per-user notify-me subscription for a PO/quote; the new purchasing reminders are job settings, so the subscription has no table (client decides whether to re-subscribe people)) |
| prf | `prf` | 1 | kept in the read-only legacy mirror only; no app table exists | pending (purchase requisition form header (internal request before a PO); the rebuild has no requisition table, the PO module starts at the purchase order) |
| signoff_cron | `signoff_cron` | 1 | not migrated: transient PDF sign-off extraction queue; the signatures live in the re-uploaded work-order PDFs, so nothing is reconstructed | pending (whole-table decision; every row of this table is skipped and stays in staging) |
| site_address_change | `site_address_change_log` | 1 | kept in the read-only legacy mirror only; no app table exists | pending (cron-detected Sage-vs-portal address drift; audit history with no forward table, address changes after cutover go to app.audit_log) |
| wo_images_cropped | `wo_images_cropped` | 1 | not migrated: crop marker with no file name and no bytes; the images are re-uploaded as work-order documents from the folder path, so there is no storage key to point at | pending (whole-table decision; every row of this table is skipped and stays in staging) |

## orphan_line

Lines whose parent does not exist. Owner: module owner.

The line is kept with a NULL parent; no FK is forced and no parent is fabricated.

Count: 33

| Entity | Source key | Rows | Action | Decision |
|---|---|---:|---|---|
| invoice_part | `4` | 1 | line not inserted: woid does not resolve to an app.work_orders row | pending (woid = "88888881") |
| invoice_tax | `5` | 1 | snapshot not stored: woid does not resolve to an app.work_orders row | pending (woid = "88888881") |
| invoice_tax | `6` | 1 | snapshot not stored: woid does not resolve to an app.work_orders row | pending (woid = "0") |
| local_work_order_hour | `2` | 1 | stored NULL tech_user_id | pending (tech = "2" has no app.users row) |
| local_work_order_tech | `2` | 1 | row not inserted: tech_user_id is NOT NULL and the user does not exist | pending (tech = "2") |
| message | `1` | 1 | message not inserted: author_user_id is NOT NULL and the sender is not an app user | pending (sender = "Interior") |
| message | `2` | 1 | message not inserted: author_user_id is NOT NULL and the sender is not an app user | pending (sender = "North") |
| message | `3` | 1 | message not inserted: author_user_id is NOT NULL and the sender is not an app user | pending (sender = "Interior") |
| message | `4` | 1 | message not inserted: author_user_id is NOT NULL and the sender is not an app user | pending (sender = "North") |
| message | `5` | 1 | message not inserted: author_user_id is NOT NULL and the sender is not an app user | pending (sender = "CLS") |
| purchase_order_preorder_part | `3` | 1 | row not inserted: preorder_id is NOT NULL and the pre-order does not exist | pending (pre_poid = "3") |
| rejected_invoice | `1` | 1 | deferred: app.sales_invoices rows are created by the invoicing-rga group; rerun purchasing with --force afterwards | pending (woid = "1001", invoice_no = "INV-4100") |
| rejected_invoice | `2` | 1 | deferred: app.sales_invoices rows are created by the invoicing-rga group; rerun purchasing with --force afterwards | pending (woid = "1002", invoice_no = "INV-4101") |
| rga_notification | `1` | 1 | notification not inserted: rga_id is NOT NULL and the RGA does not exist | pending (rgaid = "1") |
| rga_part | `1` | 1 | line not inserted: rgaid does not resolve to an app.rgas row | pending (rgaid = "1") |
| rga_special_part | `1` | 1 | line not inserted: rgaid does not resolve to an app.rgas row | pending (rgaid = "1") |
| tjx_fixture_part | `1` | 1 | part not inserted: fixture_id is NOT NULL and app.tjx_fixtures has no row with that legacy id | pending (fixtureid = "1") |
| tjx_fixture_part | `2` | 1 | part not inserted: fixture_id is NOT NULL and app.tjx_fixtures has no row with that legacy id | pending (fixtureid = "2") |
| tjx_fixture_part | `3` | 1 | part not inserted: fixture_id is NOT NULL and app.tjx_fixtures has no row with that legacy id | pending (fixtureid = "3") |
| tjx_quote_fixture | `1` | 1 | row not inserted: quote, room and a positive fixture quantity are required (quote_room_id and quantity are NOT NULL) | pending (quoteid = "1", roomid = "1", totalfixtures = "12.50") |
| tjx_quote_fixture | `2` | 1 | row not inserted: quote, room and a positive fixture quantity are required (quote_room_id and quantity are NOT NULL) | pending (quoteid = "2", roomid = "2", totalfixtures = null) |
| tjx_quote_fixture | `3` | 1 | row not inserted: quote, room and a positive fixture quantity are required (quote_room_id and quantity are NOT NULL) | pending (quoteid = "3", roomid = "3", totalfixtures = "0.00") |
| tjx_quote_revision | `2` | 1 | revision not inserted: quote_id is NOT NULL and the quote does not exist | pending (quoteid = "2") |
| tjx_sub_invoice | `2` | 1 | invoice not inserted: quote, work order and subcontractor are all NOT NULL and one does not resolve | pending (quoteid = "2", workordernumber = "1002", work order subcontractor = 3) |
| user_permission | `2` | 1 | grant not inserted: no app.users row for user_id | pending (user_id = "2") |
| user_permission | `5` | 1 | grant not inserted: no app.users row for user_id | pending (user_id = null) |
| user_permission_price | `2` | 1 | grant not inserted: no app.users row for user_id | pending (user_id = "2") |
| work_order_invoice_number | `1` | 1 | deferred: app.sales_invoices rows are created by the invoicing-rga group; rerun work-orders with --force afterwards | pending (woid = "1001", invoiceno = "SAGE-5100") |
| work_order_invoice_number | `2` | 1 | deferred: app.sales_invoices rows are created by the invoicing-rga group; rerun work-orders with --force afterwards | pending (woid = "1002", invoiceno = "SAGE-5101") |
| work_order_part | `5` | 1 | row not inserted: work_order_id is NOT NULL and the parent does not exist | pending (woid = "88888881") |
| work_order_part | `6` | 1 | row not inserted: work_order_id is NOT NULL and the parent does not exist | pending (woid = "88888882") |
| work_order_part | `7` | 1 | row not inserted: work_order_id is NOT NULL and the parent does not exist | pending (woid = "88888883") |
| work_order_part | `8` | 1 | row not inserted: work_order_id is NOT NULL and the parent does not exist | pending (woid = "88888884") |

## orphan_site_customer

Sites without a billing customer. Owner: operations.

Site is kept and selectable with a NULL customer; list and detail mark "No billing customer".

Count: 2

| Entity | Source key | Rows | Action | Decision |
|---|---|---:|---|---|
| site | `7` | 1 | site kept with customer_id = NULL; list and detail show "No billing customer" | pending (custid = 9001 has no app.customers row) |
| site | `8` | 1 | site kept with customer_id = NULL; list and detail show "No billing customer" | pending (custid = 9002 has no app.customers row) |

## orphan_workorder_site

Work orders whose site does not exist. Owner: operations.

The raw site id is preserved on the work order; no site is invented.

Count: 2

| Entity | Source key | Rows | Action | Decision |
|---|---|---:|---|---|
| work_order | `1003` | 1 | mapped via workorder.site because workorder.customer does not resolve | pending (customer = "7777", site = "3") |
| work_order | `1004` | 1 | mapped via workorder.site because workorder.customer does not resolve | pending (customer = "", site = "6") |

## placeholder_work_order

Placeholder work orders. Owner: business owner. **Policy skip.**

WO ids 99999999, 44444444, 9999999, 9999998 and 0 are markers, not jobs. Not inserted; the allocator must never issue them.

Count: 5

| Entity | Source key | Rows | Action | Decision |
|---|---|---:|---|---|
| work_order | `0` | 1 | row not inserted into app.work_orders; owner ops decides its fate | pending (workorder.id = "0") |
| work_order | `44444444` | 1 | row not inserted into app.work_orders; owner ops decides its fate | pending (workorder.id = "44444444") |
| work_order | `9999998` | 1 | row not inserted into app.work_orders; owner ops decides its fate | pending (workorder.id = "9999998") |
| work_order | `9999999` | 1 | row not inserted into app.work_orders; owner ops decides its fate | pending (workorder.id = "9999999") |
| work_order | `99999999` | 1 | row not inserted into app.work_orders; owner ops decides its fate | pending (workorder.id = "99999999") |

## series_seed

Number series seeded. Owner: operations.

The next number was taken from the legacy counter, not from the highest number issued.

Count: 1

| Entity | Source key | Rows | Action | Decision |
|---|---|---:|---|---|
| wo_next_pid | `1` | 1 | allocator seeded above both the legacy counter and the highest migrated work order | pending (series 1: next_id = 10010 (legacy 10010, highest work order 1009)) |

## status_not_allowed_for_kind

Status not valid for this record kind. Owner: module owner.

The row kept a status that the new state machine does not allow for its kind; it is left for review rather than remapped.

Count: 1

| Entity | Source key | Rows | Action | Decision |
|---|---|---:|---|---|
| customer_quote | `2` | 1 | stored status 1 (in progress) | pending (status 2 (saved) is a standalone-only state) |

## subcontractor_without_vendor

Subcontractor accounts without a vendor row. Owner: operations.

The account is kept but not invited until a real vendor row exists. Never create a fake vendor.

Count: 1

| Entity | Source key | Rows | Action | Decision |
|---|---|---:|---|---|
| user | `6` | 1 | account kept with subcontractor_id = NULL and not invited until a vendor row exists | pending (subid = 99 has no app.subcontractors row) |

## unbalanced_totals

Totals that do not match their lines. Owner: finance.

Both totals are recorded; the new total is recomputed from lines. Neither number is silently chosen.

Count: 7

| Entity | Source key | Rows | Action | Decision |
|---|---|---:|---|---|
| customer_quote | `1` | 1 | legacy tax_amount kept as manual_tax_amount; recomputed tax recorded | pending (subtotal = 44.49, computed tax = 578.37, legacy tax_amount = 113.00, difference = 465.37) |
| customer_quote | `2` | 1 | legacy tax_amount kept as manual_tax_amount; recomputed tax recorded | pending (subtotal = 132.48, computed tax = 1722.24, legacy tax_amount = 1234.50, difference = 487.74) |
| invoice_tax | `2` | 1 | posted subtotal kept; difference recorded against the recomputed line total | pending (posted subtotal = 100.00, lines = 310.50, posted tax = 13.00, posted total = 113.00) |
| purchase_order_invoice | `1` | 1 | legacy sub_total kept; recomputed line total recorded | pending (sum(linetotal) = 90.00, sub_total = 100.00, difference = -10.00) |
| purchase_order_invoice | `3` | 1 | legacy sub_total kept; recomputed line total recorded | pending (sum(linetotal) = 0.00, sub_total = 1234.50, difference = -1234.50) |
| standalone_quote | `1` | 1 | legacy tax_amount kept as manual_tax_amount; recomputed tax recorded | pending (subtotal = 44.49, computed tax = 578.37, legacy tax_amount = 0.00, difference = 578.37) |
| standalone_quote | `2` | 1 | legacy tax_amount kept as manual_tax_amount; recomputed tax recorded | pending (subtotal = 172.76, computed tax = 2245.88, legacy tax_amount = 410.00, difference = 1835.88) |

## unknown_enum

Unknown status values. Owner: module owner.

Stored NULL rather than mapped to the nearest label; the raw value is in the exception.

Count: 13

| Entity | Source key | Rows | Action | Decision |
|---|---|---:|---|---|
| invoice_tax | `1` | 1 | applied_tax_rate stored NULL: the value is not a 0..1 rate | pending (appliedtaxrate = "13.000") |
| invoice_tax | `2` | 1 | applied_tax_rate stored NULL: the value is not a 0..1 rate | pending (appliedtaxrate = "13.000") |
| invoice_tax | `3` | 1 | applied_tax_rate stored NULL: the value is not a 0..1 rate | pending (appliedtaxrate = "13.000") |
| invoice_tax | `4` | 1 | applied_tax_rate stored NULL: the value is not a 0..1 rate | pending (appliedtaxrate = "13.000") |
| part_salepurchase_log | `1` | 1 | row not inserted: transaction_type does not name a ledger type | pending (transaction_type = "") |
| rga | `1` | 1 | RGA not inserted: status is NOT NULL and outside 2/3/4/6/7/10/11 | pending (status = "1") |
| rga | `2` | 1 | stored NULL, not the nearest label | pending (replacement_type = "replacement") |
| rga | `3` | 1 | stored rga_type 'rga' because the column is NOT NULL; replacement_type left NULL | pending (rga_type = "vendor_return") |
| rga | `4` | 1 | stored NULL, not the nearest label | pending (replacement_type = "replacement") |
| subcontractor_wsib_document | `3` | 1 | stored NULL, not the nearest label | pending (document_type = "wcb") |
| tjx_quote | `1` | 1 | applied_tax_rate stored NULL: the value is not a 0..1 rate | pending (appliedtaxrate = "13.000") |
| tjx_quote | `2` | 1 | quote not inserted: status is NOT NULL and outside 1/3/4/5 | pending (status = "2") |
| tjx_quote_revision | `1` | 1 | stored NULL, not the nearest label | pending (revision_type = "manual") |

## unparseable_json

Unparseable JSON snapshots. Owner: data platform.

The raw text is preserved (or the snapshot skipped) and listed; nothing is guessed.

Count: 4

| Entity | Source key | Rows | Action | Decision |
|---|---|---:|---|---|
| rejected_quote | `1` | 1 | stored NULL content | pending (quote_content is not JSON; 57 characters stay in staging) |
| rejected_quote | `2` | 1 | stored NULL content | pending (quote_content is not JSON; 65 characters stay in staging) |
| work_order_revision | `1` | 1 | stored NULL snapshot | pending (data_wo_notes is not JSON; 57 characters stay in staging) |
| work_order_revision | `2` | 1 | stored NULL snapshot | pending (data_wo_notes is not JSON; 57 characters stay in staging) |

## unparseable_money

Unparseable money. Owner: finance.

The raw value is listed with its source key and stored NULL. No rounding, no guessing.

Count: 5

| Entity | Source key | Rows | Action | Decision |
|---|---|---:|---|---|
| customer_quote | `4` | 1 | stored NULL | pending (tax_amount = "n/a") |
| invoice_tax | `3` | 1 | stored NULL | pending (tax_amount = "n/a") |
| purchase_order_invoice | `4` | 1 | stored NULL | pending (total_amount = "n/a") |
| purchase_order_invoice_part | `3` | 1 | stored NULL | pending (linetotal = "n/a") |
| purchase_order_part | `4` | 1 | stored NULL | pending (price = "n/a") |

## unresolved_part_line

Unresolved part lines. Owner: operations.

Part numbers such as '---' are preserved as exceptions; no fake part is created.

Count: 5

| Entity | Source key | Rows | Action | Decision |
|---|---|---:|---|---|
| part_salepurchase_log | `2` | 1 | row not inserted: part_no and qty are NOT NULL | pending (partno = "", qty = "2") |
| purchase_order_invoice_part | `2` | 1 | line kept without part_line_id | pending (poid = "2", partno = "CLS-1002") |
| purchase_order_invoice_part | `3` | 1 | line kept without part_line_id | pending (poid = "3", partno = "---") |
| purchase_order_invoice_part | `4` | 1 | line kept without part_line_id | pending (poid = "4", partno = "CLS-1004") |
| work_order_part | `3` | 1 | line kept with its non-part number; not linked to a part | pending (woid = "1003", partno = "---") |

## zero_date

Zero dates. Owner: data platform.

MySQL '0000-00-00' becomes NULL; it is not rewritten as 1970.

Count: 13

| Entity | Source key | Rows | Action | Decision |
|---|---|---:|---|---|
| customer_quote | `4` | 1 | stored NULL | pending (date_created is a zero date) |
| customer_quote | `5` | 1 | stored NULL | pending (date_approved is a zero date) |
| invoice_hour | `4` | 1 | stored NULL | pending (date is a zero date) |
| purchase_order | `5` | 1 | stored NULL | pending (expdeliverydate is a zero date) |
| purchase_order_invoice | `3` | 1 | stored NULL | pending (invoice_date is a zero date) |
| rga | `4` | 1 | request_date stored as the import date: the column is NOT NULL and the source has no usable date | pending (request_date = null) |
| site | `5` | 1 | stored NULL | pending (warranty_exp is a zero date) |
| work_order | `1002` | 1 | stored NULL | pending (completiondate is a zero date) |
| work_order | `1004` | 1 | stored NULL | pending (expcompletion is a zero date) |
| work_order | `1006` | 1 | stored NULL | pending (invdate is a zero date) |
| work_order | `1009` | 1 | stored NULL | pending (expcompletion is a zero date) |
| work_order_hour | `5` | 1 | stored NULL | pending (date is a zero date) |
| work_order_note | `4` | 1 | stored NULL | pending (date_created is a zero date) |

