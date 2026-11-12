# Parity anchors

49 matched, 0 differed, 0 errored, of 62 anchors.

| Group | Anchor | Old (staging) | New (app) | Result |
|---|---|---:|---:|---|
| lookups | wo_status rows (mirror, not part of this run) | 5 | - | counted |
| lookups | wo_priority rows (mirror, not part of this run) | 3 | - | counted |
| lookups | wo_servtype rows (mirror, not part of this run) | 4 | - | counted |
| lookups | wo_categories rows (mirror, not part of this run) | 4 | - | counted |
| lookups | po_status rows (mirror, not part of this run) | 6 | - | counted |
| lookups | po_priority rows (mirror, not part of this run) | 3 | - | counted |
| lookups | po_preorder_status rows (mirror, not part of this run) | 3 | - | counted |
| lookups | customer_quote_status rows (mirror, not part of this run) | 4 | - | counted |
| lookups | standalone_quote_status rows (mirror, not part of this run) | 4 | - | counted |
| lookups | tjx_quote_status rows (mirror, not part of this run) | 4 | - | counted |
| lookups | rga_status rows (mirror, not part of this run) | 4 | - | counted |
| parties | customers | 6 | 6 | match |
| parties | sites | 8 | 8 | match |
| parties | sites without a billing customer | 2 | 2 | match |
| parties | subcontractors | 5 | 5 | match |
| parties | subcontractor interior rate sum | 15.00 | 15 | match |
| parties | suppliers | 4 | 4 | match |
| parties | subcontractor contacts | 5 | 5 | match |
| parties | customer e-mails kept in the mirror (loaded from the dump, not this run) | 4 | - | counted |
| parties | site address changes kept in the mirror (loaded from the dump, not this run) | 3 | - | counted |
| identity | users (one per username; duplicates are quarantined, not duplicated) | 11 | 11 | match |
| identity | disabled users | 3 | 3 | match |
| identity | duplicate usernames | 1 | 1 | match |
| identity | user permission grants (named + price management) | 5 | 5 | match |
| parts | parts | 10 | 10 | match |
| parts | parts sell-price sum | 509.45 | 509.45 | match |
| parts | parts cost sum | 249.30 | 249.3 | match |
| parts | part groups | 3 | 3 | match |
| parts | supplier rate cards | 3 | 3 | match |
| parts | selling rate cards | 4 | 4 | match |
| parts | shared part mappings | 3 | 3 | match |
| parts | price history rows | 4 | 4 | match |
| compliance | subcontractor documents (wsib, insurance, additional) | 6 | 6 | match |
| compliance | warranty rows (site + material) | 6 | 6 | match |
| work-orders | work orders by status | [{"status":"1","rows":3},{"status":"2","rows":3},{"status":"3","rows":2},{"status":"4","rows":1}] | [{"status":"1","rows":3},{"status":"2","rows":3},{"status":"3","rows":2},{"status":"4","rows":1}] | match |
| work-orders | work-order parts money | 178.25 | 178.25 | match |
| work-orders | work-order labour hours | 21.00 | 21 | match |
| quotes | quote headers (customer + standalone) | 8 | 8 | match |
| quotes | quote parts lines | 7 | 7 | match |
| quotes | quote labour hours | 9.00 | 9 | match |
| purchasing | purchase orders | 8 | 8 | match |
| purchasing | PO received quantity | 29.00 | 29 | match |
| purchasing | supplier invoice totals | 1347.50 | 1347.5 | match |
| inventory | sale movements: total quantity | 0 | 0 | match |
| inventory | purchase movements: total quantity | 0 | 0 | match |
| inventory | manual stock adjustments: row count | 4 | 4 | match |
| inventory | adjustment quantities: total | 10 | 10 | match |
| invoicing-rga | posted invoice totals (parseable rows only) | 113.00 | 113 | match |
| invoicing-rga | invoices: one per work order with a posted snapshot | 4 | 4 | match |
| invoicing-rga | invoice part lines: total amount | 327.7000 | 327.7 | match |
| invoicing-rga | RGAs: count grouped by a status bucket (completed = 4) | 1 | 1 | match |
| invoicing-rga | RGAs: count grouped by a status bucket (cancelled = 10) | 0 | 0 | match |
| invoicing-rga | RGA part lines: row count | 3 | 3 | match |
| tjx | quotes: row count | 2 | 2 | match |
| tjx | quotes: posted total amount | 0.00 | 0 | match |
| tjx | quotes: count grouped by a status bucket (approved = 4) | 0 | 0 | match |
| tjx | quote revisions kept as snapshots | 1 | 1 | match |
| tjx | subcontractor invoices: total amount | 0.00 | 0 | match |
| messaging-history | messages kept | 0 | 0 | match |
| messaging-history | message body characters preserved | 0 | 0 | match |
| messaging-history | confirmation messages imported | 6 | 6 | match |
| messaging-history | RGA reminder notifications kept | 2 | 2 | match |
