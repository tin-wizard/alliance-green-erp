# Master Data — delivered

**Status:** implemented and verified 2026-11-11. **Owner:** platform foundation.
**Scope:** customers, sites, subcontractors + compliance documents, suppliers, parts catalogue and
rate cards, local create/edit, compliance uploads and expiry reminders, and the Sage re-import.
Prices remain read-only. **Not in this slice:** any price mutation, row deletion, id renumbering, or
Sage push/posting.

---

## 1. What exists

| Area | Tables (`app`) | Screens |
|---|---|---|
| Customers | `customers` | `/master-data/customers`, `/$id`, `/new`, `/edit/$id` |
| Sites | `sites`, `site_warranties` | `/master-data/sites`, `/$id`, `/new`, `/edit/$id` |
| Subcontractors | `subcontractors`, `subcontractor_contacts`, `subcontractor_documents` | `/master-data/subcontractors`, `/$id`, `/new`, `/edit/$id` |
| Suppliers | `suppliers`, `supplier_contacts` | `/master-data/suppliers`, `/$id`, `/new`, `/edit/$id` |
| Parts / rates | `part_groups`, `parts`, `part_supplier_rate_lists`, `part_selling_rate_lists`, `part_sub_suppliers`, `part_supplier_rates`, `part_supplier_model_rates`, `part_selling_rates`, `part_price_history`, `shared_parts` | `/master-data/parts`, `/$id`, `/new`, `/edit/$id` |
| Sage reconciliation | `import_state`, `import_conflicts` | `/master-data/import` |

Import and local-identity support tables: `local_id_allocations`, `master_data_requests`,
`compliance_reminders`.

Imported ids stay natural integers copied from Sage/legacy. A locally created record receives a
**negative id** from `local_id_allocations`; that id is permanent. It is never renumbered when Sage
later links the row. `customers.id` and `sites.id` share the Sage `tcustomr.lId` space; they are not
parent/child mirrors.

Each entity carries an explicit Sage link: `customers.sage_customer_id`, `sites.sage_site_id`,
`subcontractors.sage_subcontractor_id`, `parts.sage_item_id`, all uniquely indexed. A negative id or
a null link is blocked from Sage posting with `SAGE_LINK_REQUIRED`; the UI labels the record
**“Local — not in Sage”** and explains that posting is blocked until the import links it.

Migrations `0002_boring_surge.sql` (read model) and `0004_uneven_pete_wisdom.sql` (writes,
documents, import state, reminders) are applied to Neon `production`. After `0004`, `app` has
**52 tables / 531 columns**; `public` keeps **171 tables / 1,509 columns** as the read-only legacy
mirror.

## 2. Permissions and audit

Four keys remain **new capabilities**, not replacements for legacy keys:

| Key | admin | technician | supplier |
|---|---|---|---|
| `subcontractor:read` | yes | yes | — |
| `subcontractor:write` | yes | — | — |
| `supplier:read` | yes | — | — |
| `supplier:write` | yes | — | — |

Customers and sites use `customer:read`/`customer:write`; parts use `inventory:read`/
`inventory:write`; compliance uploads use `compliance:read`/`compliance:write`. Seed state:
**44 permission definitions, 60 role grants**.

Every screen redirects unless the session holds the matching read grant; every server function has
`permissionMiddleware` for the same key. Every write is transactional, checks the permission again
inside the transaction, and writes an `audit_log` row carrying `action`, actor, `before`/`after`, and
the checked `permission`. Creates are idempotent through `master_data_requests`: retrying the same
key returns the first record instead of creating a second.

## 3. Duplicate thresholds (as enforced)

Name matching normalises case, accents, punctuation and legal suffixes (`ltd`, `limited`, `inc`,
`incorporated`, `corp`, `corporation`, `co`, `company`). Address matching normalises street/road/
avenue abbreviations. Phone matching compares the last 10 digits; email matching lowercases.

| Entity | Block (no override) | Override required (admin + reason ≥ 10 chars) |
|---|---|---|
| Customer | same normalised name **and** same postal code, phone or email | name similarity ≥ **0.92** (Dice bigram) and same city; or a reused phone/email under a different name |
| Site | same billing parent **and** same normalised street or postal code | same name and city within the parent |
| Subcontractor / supplier | same normalised name **and** same phone or email | same name and city |
| Part | same part number | same description and part group |

A block returns `DUPLICATE_BLOCKED`; a soft match returns `DUPLICATE_OVERRIDE_REQUIRED`. Only an
`admin` may pass `duplicateOverride.reason`; the reason is recorded in the audit entry. Updates
exclude the record being edited from the candidate set, so saving a record never collides with
itself.

## 4. Customer and site decisions

A site cannot be submitted without an explicit billing choice. The form offers **Existing customer**
or **Orphan site — no billing customer**, and the Zod schema rejects a payload with no decision.
An orphan is stored with `customer_id = NULL` and stays selectable for work orders.

Sites are always LEFT-joined to `customers`; there is no inner join in the adapter, list, detail or
count query.

- `sites.customer_id IS NULL` → tag **“No billing customer”**.
- `sites.customer_id` set but no `customers` row → tag
  **“Billing customer not imported (Sage id N)”**. This is the 1,086-row orphan case.
- The Sites list has a **Missing billing parent** filter and includes these rows by default.
- Customer detail never lists a site it does not own; orphaned sites are reachable from the list and
  render a clear “still available for work orders” note.
- The API returns `customerName: null`; the adapter used by Work Orders converts that to `''` so the
  frozen contract never sees null.

## 5. No price-write path

`parts.cost`, `sell_price`, `install_cost_per_unit` and the supplier/selling rate cards are displayed
only. Part create/edit accepts identity and non-price attributes; the server scans the whole payload
recursively and rejects any price key (`cost`, `sellPrice`, `installPrice`, `recyclePrice`, and the
rest of `PRICE_FIELD_KEYS`) with `PRICE_FIELD_NOT_WRITABLE` before any row is touched. `updatePartFn`
never writes a money column.

The future price-management screen is the only price editor and owns the global `parts_price_lock`
mutex (`id=1`, `is_locked`, `locked_by`, `lock_time`). The lookups return the committed
`parts.sell_price` and ignore the lock completely: holding it never hides a part, changes a price,
or turns a NULL into a number (and never the reverse).

An imported part number is immutable. A local part number can change only while no work order or
quote references it.

## 6. Compliance documents and reminders

`subcontractor_documents` stores `content_type`, `size_bytes`, `checksum_sha256`, `uploaded_by` and
`superseded_at`. Uploads are limited to PDF, JPEG and PNG up to 10 MiB. The server decodes the base64
payload, sniffs the magic bytes (`%PDF-`, `FF D8 FF`, PNG signature), and rejects a file whose bytes do
not match the declared type. The SHA-256 checksum is computed server-side.

Replacing a certificate creates a new row and sets `superseded_at` on the old one. Nothing is
deleted, so history and audits remain readable. Reads go through the authenticated
`/api/master-data/documents/$id` route with `compliance:read`, `Cache-Control: no-store` and a safe
filename, or through a short-lived S3 signed URL when object storage is configured.

Expiry reminders use the windows **30, 14, 7, 1 and 0 days** before expiry, plus `-1` for already
expired. `compliance_reminders` has a unique `(document_id, window_days)` key, so re-running the job
dedupes instead of sending twice; the document `reminder_state` records what was queued. Expired
documents are flagged `is_expired`; Work Orders still refuses assignment without a valid document.
The job is `/api/cron/compliance-expiry`, gated by `COMPLIANCE_CRON_SECRET` and an `x-cron-secret`
header; operators can also run it from the import/administration surface.

## 7. Sage re-import

The import reads the read-only legacy mirror (`legacyCustomer`, `legacySites`,
`legacySubcontractor`, `legacySuppliers`, `legacyParts`) and runs as **dry-run first, then apply**.
The screen reports create / link / update / unchanged / conflict / missing counts before applying.

Ownership is explicit:

- **Sage-owned** — ids, part number, `active_in_sage`: always taken from the source.
- **Sage-seeded, locally editable** — name, address, contact fields: updated only when the local
  value still equals the previous import snapshot. If an operator changed it, the source value is
  recorded in `import_conflicts` and the local value wins.
- **Local-only** — notes, warranty, compliance, PO flags, `subignore`: never touched by the import.
- **Financial fields** — never touched by the import.

A local negative draft with a unique business-key match is **linked** by filling its `sage_*_id`
without renumbering. New Sage rows are inserted with their positive Sage id. A linked row absent from
the source is reported as missing and kept (with `sage_missing_since`); the import never deletes and
never renumbers. `import_state` stores the last snapshot and hash per entity/link.

## 8. Work Orders adapter parity

`apps/web/src/modules/work-orders/lib/lookups.ts` keeps its frozen signatures but reads `app`
tables. Behaviour verified by `apps/web/src/modules/master-data/lib/lookups.parity.test.ts`:

1. `searchSites` orders by `lower(name), id`, matches mid-word substrings, and returns the first
   page for an empty search.
2. A site whose customer is absent is still returned, with `customerName === ''` (not null, not
   dropped, no throw).
3. `getSubcontractorWsibState` with zero documents returns
   `{ valid: false, expirationDate: null, documentType: null }`; expired/future cases follow the same
   rule.
4. `partsLookup` returns identical results with the lock row absent or held; a NULL price stays
   `null`.

The Work Orders and Quotes integration suites both pass unchanged after the write slice.

## 9. Server functions and routes

Read functions in `apps/web/src/modules/master-data/server/master-data.functions.ts`:

`listCustomersFn`, `getCustomerFn`, `listSitesFn`, `getSiteFn`, `listSubcontractorsFn`,
`getSubcontractorFn`, `listSuppliersFn`, `getSupplierFn`, `listPartsFn`, `getPartFn`.

Write functions: `createCustomerFn`, `updateCustomerFn`, `createSiteFn`, `updateSiteFn`,
`createSubcontractorFn`, `updateSubcontractorFn`, `createSupplierFn`, `updateSupplierFn`,
`createPartFn`, `updatePartFn`, plus `checkDuplicatesFn`, `uploadSubcontractorDocumentFn`,
`getDocumentUrlFn`, `runComplianceRemindersFn` and `runSageImportFn`.

Paging is 1-based, capped at 50 per page. List search is a trimmed substring; sites add
`parent=all|present|missing`, subcontractors add `wsib=all|valid|missing` (SQL `exists` against
non-expired WSIB/insurance documents, evaluated in `America/Toronto`).

## 10. Verification

- `pnpm verify`: typecheck, lint, all tests and the production build pass.
- `pnpm test`: **297 passed, 4 skipped** across 25 files, including 7 write integration cases,
  6 duplicate-threshold cases, 4 parity cases and the Work Orders/Quotes suites.
- Signed-in E2E: **14 passed**, including the new write path
  (create customer → create site under it → upload a PDF compliance document → edit a part) and
  both Work Orders paths, against the migrated Neon database. The write test cleans up its
  prefixed rows.
- Migration `0004` applied to Neon `production`; `app` 52 tables / 531 columns; seed reports
  44 permissions / 60 grants and provisions `developer@tin.info`.

## 11. Deliberately not delivered

- Any price write, price-management screen, lock UI/heartbeat/TTL (Inventory/Purchasing slice).
- Delete, merge or renumber of Master Data rows.
- Sage push/posting. Negative and unlinked records are explicitly blocked; this slice only reads
  Sage through the import.
- Bulk import scheduling; the import is operator-triggered dry-run/apply.
