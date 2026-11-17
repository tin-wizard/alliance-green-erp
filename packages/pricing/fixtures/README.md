# Pricing fixture packs

`sales-invoice.json`, `project-wo.json`, `local-wo.json` and
`subcontractor-invoice.json` are captured against the legacy PHP endpoints; each
case records its source. Captured sales inputs include the dummy `0 / 0.00`
labour row the harness posted, because the endpoints reject an empty labour
array.

`quote.json`, `purchase-order.json` and `tjx-quote.json` are hand-authored design
specs, not legacy captures. They encode the intended parity rules; the legacy
sources for each case are cited in its `source`, `provenance` or `note` field.
