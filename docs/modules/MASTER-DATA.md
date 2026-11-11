# Master Data — delivered

**Status:** implemented and verified 2026-11-11. **Owner:** platform foundation.
**Scope:** customers, sites, subcontractors + compliance documents, suppliers, parts catalogue and
rate cards. Read-only for prices. **Not in this slice:** any price mutation, document upload,
inventory counters, purchasing approval.

---

## 1. What exists

| Area | Tables (`app`) | Screens |
|---|---|---|
| Customers | `customers` | `/master-data/customers`, `/$id` |
| Sites | `sites`, `site_warranties` | `/master-data/sites`, `/$id` |
| Subcontractors | `subcontractors`, `subcontractor_contacts`, `subcontractor_documents` | `/master-data/subcontractors`, `/$id` |
| Suppliers | `suppliers` | `/master-data/suppliers`, `/$id` |
| Parts / rates | `part_groups`, `parts`, `part_supplier_rate_lists`, `part_selling_rate_lists`, `part_sub_suppliers`, `part_supplier_rates`, `part_supplier_model_rates`, `part_selling_rates`, `part_price_history`, `shared_parts` | `/master-data/parts`, `/$id` |

Ids are natural integers copied from Sage/legacy. Nothing in this module generates or renumbers an
id. `customers.id` and `sites.id` share the Sage `tcustomr.lId` space; they are not parent/child
mirrors.

Migration `packages/db/drizzle/0002_boring_surge.sql`: 1 enum, 17 tables, 6 foreign keys.
Applied to Neon `production`. After it, `app` has **37 tables / 373 columns**; `public` keeps
**171 tables / 1,509 columns** as the read-only legacy mirror.

## 2. Permissions

Four keys are **new capabilities**, not replacements for legacy keys:

| Key | admin | technician | supplier |
|---|---|---|---|
| `subcontractor:read` | yes | yes | — |
| `subcontractor:write` | yes | — | — |
| `supplier:read` | yes | — | — |
| `supplier:write` | yes | — | — |

Customers and sites use the existing `customer:read`/`customer:write`; parts use
`inventory:read`. Seed state: **44 permission definitions, 60 role grants**.

Every screen redirects unless the session holds the matching read grant; every server function has
`permissionMiddleware` for the same key. No Master Data function writes a price or a part.

## 3. No price-write path

`parts.cost`, `sell_price`, `install_cost_per_unit` and the supplier/selling rate cards are displayed
only. `upsertPartFn` does not exist in this module; the future price-management screen is the only
editor and owns the global `parts_price_lock` mutex (`id=1`, `is_locked`, `locked_by`, `lock_time`).
The lookups return the committed `parts.sell_price` and ignore the lock completely: holding it never
hides a part, changes a price, or turns a NULL into a number (and never the reverse).

## 4. Work Orders adapter parity

`apps/web/src/modules/work-orders/lib/lookups.ts` keeps its frozen signatures but now reads `app`
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

The Work Orders integration suite (8 tests) passes after the swap. Its fixture now writes the same
990001/990002 reference rows to both `public` and `app` because list/detail display still reads the
legacy mirror for now.

## 5. How a site with no customer appears

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

## 6. Server functions and routes

Read functions in `apps/web/src/modules/master-data/server/master-data.functions.ts`:

`listCustomersFn`, `getCustomerFn`, `listSitesFn`, `getSiteFn`, `listSubcontractorsFn`,
`getSubcontractorFn`, `listSuppliersFn`, `getSupplierFn`, `listPartsFn`, `getPartFn`.

Paging is 1-based, capped at 50 per page. List search is a trimmed substring; sites add
`parent=all|present|missing`, subcontractors add `wsib=all|valid|missing` (SQL `exists` against
non-expired WSIB/insurance documents, evaluated in `America/Toronto`). Writes are deliberately
absent.

## 7. Verification

- `pnpm verify`: typecheck, lint, tests and production build green.
- `pnpm test`: **207 passed, 4 skipped** across 18 files, including 4 parity cases and 3 Master Data
  query integration cases (lists, detail, rate cards, orphan filter, zero-document compliance).
- Signed-in E2E: **12 passed**, including a new Master Data navigation test and both Work Orders
  paths, against the migrated Neon database.
- Migration applied to Neon `production`; `app` 37 tables / 373 columns; seed reports
  44 permissions / 60 grants and provisions `developer@tin.info`.

## 8. Deliberately not delivered

- Customer/site/subcontractor/supplier/part create or edit. Master Data is read-only until the
  write flows and their audit rules are designed.
- Compliance document upload/delete and reminders; documents are displayed with expiry state.
- Price management and the lock UI/heartbeat/TTL (Inventory/Purchasing slice).
- Bulk Sage re-import. The import job remains the source of ids and rows.
