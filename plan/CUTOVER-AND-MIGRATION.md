# Cutover and migration plan

**Status:** draft for review. **Date:** 2026-11-11. **Owner:** Data platform, with module owners.
**Scope:** moving the authoritative legacy MySQL data into the rebuild's `app` schema, proving
parity, and switching each module without a big-bang cutover.
**References:** `green-system/MIGRATION-NOTES.md`, `green-system/DATA-RECOVERY.md`,
`green-system/DATA-DICTIONARY.md`, `green-system/BUSINESS-RULES.md`,
`green-system/MODULES.md` §11/§13/§16, `plan/REBUILD-PLAN.md`, `platform/DATA-LAYER.md`,
`plan/modules/WORK-ORDERS.md`, `plan/modules/QUOTES.md`, `plan/modules/PURCHASING.md`.

---

## 0. The facts that constrain the plan

1. **Only half the legacy data is readable today.** The recovered archive has **98 authoritative
   MyISAM tables with rows** and **77 authoritative InnoDB tables with definitions but no
   readable rows**. The missing half includes all quote headers (`customer_quote`,
   `standalone_quote`), all purchasing (`purchaseorder`, `po_*`, `rga*`), all TJX, suppliers,
   the inventory ledger, permissions and WSIB documents. No cutover of those modules can be
   approved until a logical dump from the live server exists. This plan treats that dump as gate
   zero, not as a later task.
2. **There is no test oracle in the old system.** Parity is established by capturing deterministic
   query output and representative PDFs from a frozen legacy snapshot, then comparing the new
   system to those captures. A human signs each module's capture pack.
3. **The legacy database has no foreign keys, no transactions on MyISAM, latin1 text, money in
   `varchar`, and 117 dated backup tables.** The migration must normalise deliberately and must
   never guess an id.
4. **Sage is a separate system reached over a cloud API, and it is still not one transaction with
   this app.** This plan originally assumed the rebuild would write the same Sage 50 `simply`
   tables as the legacy. Under D18 (2026-11-11) the rebuild posts to a **Sage cloud API** instead,
   so the legacy Sage 50 company and the new cloud ledger are two different systems, not two
   writers on one database. The principle survives: one writer per document, one direction per
   field, and a signed reconciliation before anyone claims the books agree. The gate changes shape:
   there is no `sageuser` grant to revoke and no company file to freeze at the switch. The risks
   move to OAuth consent and refresh-token custody, API quota exhaustion, idempotency of an HTTP
   retry, and the history gap between the frozen Sage 50 company and the new cloud ledger. See
   `plan/modules/SAGE-CLOUD.md` and §4.4.
5. **Not every target table exists yet.** Master Data, Work Orders and Quotes have `app` tables;
   Purchasing is landing now; Invoicing, Inventory and TJX do not. The harness therefore runs from
   a **target mapping manifest**. A module whose manifest cannot resolve its target tables is
   `blocked`, never silently skipped.

---

## 1. Preconditions and go/no-go gates

No migration run is promoted, and no module is switched, until all of these are true.

| Gate | Evidence | Owner |
|---|---|---|
| G0 Live dump exists | `mysqldump` file, SHA-256, byte size, timestamp, MySQL version, schema name | DBA / client |
| G0a Dump covers all 175 tables | 175 table names in the dump; 77 InnoDB row counts non-zero where the live table has rows | Data platform |
| G0b Dump is internally consistent | MyISAM tables locked or portal stopped during dump; two consecutive dumps agree on row counts; second is kept | DBA / client |
| G1 Restore works | Dump restored into a scratch MySQL; `CHECK TABLE` and row counts match the dump manifest | Data platform |
| G2 Target manifest resolves | Every entity maps to existing `app` tables and columns; unresolved modules are listed as blocked | Module owners |
| G3 Rehearsal passes | Full migration + parity on the restored dump; run report with zero unexplained differences | Data platform + module owners |
| G4 Exceptions signed | Every row in `migration.exceptions` has a decision and named owner | Business owner |
| G5 Backups tested | Restore rehearsal of Neon branch, legacy MySQL, the Sage 50 company file kept as the history archive, object storage, and the new Sage cloud consent record plus opening-balance snapshot | Platform |
| G6 Rollback rehearsed | One module rolled back without touching another module; documented elapsed time | Data platform |
| G7 One-writer plan signed | Legacy scheduler and Sage transfer routes stopped for the module; MySQL grants frozen; exactly one Sage API credential set active and the legacy posting path confirmed stopped | Operations |

A module with a failed gate stays on legacy. A cutover date is not a reason to waive a gate.

---

## 2. Migration harness

### 2.1 Topology

Do not parse a MySQL dump with regular expressions. Restore it into a scratch MySQL instance, then
read it with a real MySQL client and write Postgres staging rows. This preserves latin1 bytes,
zero-date behaviour, enum labels and column types, and it gives a second place to run legacy SQL
for parity.

```
live MySQL 5.x (alliance_db)
   │  mysqldump --single-transaction --quick --routines --triggers
   │            --default-character-set=latin1 --hex-blob
   ▼
immutable dump file  ── SHA-256 ──►  migration.dump_objects
   │
   ├── restore ──► scratch MySQL 5.7/8.0  (the parity oracle)
   │                    │
   │                    └── mysql2, charset latin1, streaming query
   │                              │
   │                              ▼
   │                    Postgres `migration.stg_<table>` (all text, plus metadata)
   │                              │
   │                    normalise + transform (TypeScript, one transformer per entity)
   │                              │
   │                              ▼
   │                    `app` tables + `migration.row_map` + `migration.errors`
   │
   └── written to encrypted storage, read-only, never edited
```

The extractor uses a **read-only MySQL user** on the scratch restore. The production database is
never queried by the migration job.

### 2.2 Control schema

Create a `migration` schema in Neon. These tables are part of the migration, not the application
model.

```sql
create schema if not exists migration;

create table migration.runs (
  run_id uuid primary key default gen_random_uuid(),
  dump_id text not null,
  module text not null,                 -- master-data | work-orders | quotes | ...
  phase text not null,                  -- load | normalise | transform | reconcile | verify
  status text not null default 'running', -- running | passed | failed | blocked
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  source_rows bigint default 0,
  transformed_rows bigint default 0,
  error_count integer default 0,
  manifest_version text not null,
  git_sha text not null,
  details jsonb
);

create table migration.dump_objects (
  dump_id text not null,
  table_name text not null,
  engine text not null,
  source_rows bigint,
  staged_rows bigint,
  checksum text,
  loaded_at timestamptz,
  primary key (dump_id, table_name)
);

-- The crosswalk. Every entity that crosses systems gets a row here.
create table migration.row_map (
  id bigserial primary key,
  entity text not null,                 -- customer | site | work_order | quote | po | ...
  source_table text not null,
  source_key text not null,             -- canonical source id or composite key
  target_table text not null,
  target_key text not null,
  dump_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity, source_table, source_key)
);
create index migration_row_map_target_idx on migration.row_map (target_table, target_key);

create table migration.checkpoints (
  run_id uuid not null references migration.runs(run_id) on delete cascade,
  entity text not null,
  last_source_key text,
  batch_no integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (run_id, entity)
);

create table migration.errors (
  id bigserial primary key,
  run_id uuid not null references migration.runs(run_id) on delete cascade,
  entity text not null,
  source_key text,
  error_code text not null,
  message text not null,
  payload_hash text,
  resolved_at timestamptz,
  resolution text
);

-- Known exceptions are data, not a wiki page. A run cannot pass while an open
-- exception belongs to the module being cut over.
create table migration.exceptions (
  id bigserial primary key,
  exception_class text not null,
  entity text not null,
  source_key text not null,
  row_count bigint not null default 1,
  migration_action text not null,
  decision text not null default 'pending', -- pending | accepted | fixed | excluded
  owner text,
  notes text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (exception_class, entity, source_key)
);
```

Every staging table is generated from `packages/db/contract/schema.json`:

```sql
create table migration.stg_workorder (
  _source_pk text primary key,
  _dump_id text not null,
  _row_hash text not null,
  _loaded_at timestamptz not null default now(),
  -- every source column as text, nullable, no business constraints
  id text, site text, customer text, status text, ...
);
```

All staging columns are `text` on purpose. A bad legacy value must land in staging and be reported,
not abort the load or be coerced silently.

### 2.3 Stages

| Stage | What happens | Failure behaviour |
|---|---|---|
| `load` | `COPY` from the scratch MySQL extractor into `stg_*`; record row count and per-row hash; `dump_objects` updated | table stays `failed`; no downstream stage runs |
| `normalise` | trim; convert latin1 exactly once at extract; apply null/empty policy; parse money; parse dates; validate enum labels | row goes to `migration.errors`, batch continues |
| `transform` | entity transformer upserts into `app` by natural key and writes `row_map` in the same transaction | batch rolls back; retry isolates the bad row |
| `reconcile` | parity cases for the entity; row counts, sums, orphans, status histograms | run is `failed`; module cannot promote |
| `verify` | manifest coverage, exceptions all decided, sequence/allocator checks, spot-check pack | run is `blocked` until resolved |

### 2.4 Idempotency and resume

The harness must be safe to run repeatedly against the same dump and against a fresh dump.

- **Immutable dump.** `dump_id` is the SHA-256 of the dump file. A different dump is a different
  run; results are never mixed.
- **Natural keys first.** Every transformer uses the business key: Sage id, legacy id, part number,
  PO number, quote number. It never relies on a Postgres serial value to decide identity.
- **Upsert, not blindly insert.** `insert ... on conflict (natural_key) do update`; source columns
  that are system-owned overwrite, locally owned columns are protected exactly as the Master Data
  Sage import already does (`import_state.last_snapshot`), and a local edit that differs from the
  snapshot becomes an `import_conflicts` row, not a silent overwrite.
- **Same transaction.** The `app` row and its `migration.row_map` row are written in one
  transaction. A crash leaves neither.
- **Batch checkpoint.** Batches of 1,000 rows by ascending source primary key. `checkpoints` records
  the last committed key. Re-running starts at the next key; re-running the same key is a no-op by
  natural key.
- **Retry isolation.** A batch failure rolls back the batch. The runner retries the batch row by row
  under savepoints; a single bad row is written to `migration.errors` and the rest continue. The
  module status becomes `needs_review`, never `passed`.
- **Advisory lock.** One transformation job per entity:
  `select pg_advisory_xact_lock(hashtext('migration:' || $1))`. Two operators cannot race the same
  entity.
- **No destructive repair.** The runner never deletes an existing `app` row to make a count match.
  Deletes are a separate, reviewed `exceptions` action with a backup.

### 2.5 Import order

The order is dependency order, not menu order.

1. **Lookups and configuration** — `wo_status`, `wo_priority`, `wo_servtype`, `wo_categories`,
   `po_status`, `po_priority`, `po_preorder_status`, `customer_quote_status`,
   `standalone_quote_status`, `tjx_quote_status`, payment terms, tax codes. `settings` is curated,
   not bulk-copied; no secrets.
2. **Parties** — `customer`, `sites`, `subcontractor`, `subcontractor_contact_info`, `suppliers`,
   `supplier_contacts` (if the live dump has them), `customer_emails`.
3. **Identity** — `users`, translated grants. No passwords.
4. **Parts and rates** — `parts`, `parts_group`, rate cards, `parts_price_history`,
   `shared_parts_list`.
5. **Compliance and documents** — `subcontractor_wsib_insurance_documents`,
   `subcontractor_additional_documents`, `site_warranty`, `material_warranty`, `signoff_cron`,
   storage keys for uploaded files.
6. **Work orders** — `workorder`, `wo_hours`, `localwo_hours`, `localwo_techs`, `wo_parts`,
   `wo_soparts`, `wo_tax`, `wo_report`, `wo_notes`, `wo_revisions`, `wo_invoiceno`,
   `wo_images_cropped`, signatures.
7. **Quotes** — `customer_quote`, `customer_quote_hours`, `customer_quote_parts`,
   `customer_quote_soparts`, `customer_qo_packing_*`, `standalone_quote`,
   `standalone_quote_hours`, `standalone_quote_parts`, `standalone_quote_soparts`,
   `quote_*`, `calcquote_*`, `rejected_quotes`, revisions.
8. **Purchasing** — `purchaseorder`, `po_parts`, `po_soparts`, `po_preorder*`, `po_quote*`,
   `po_supplier_quote*`, `po_invoice*`, `rejected_invoices`.
9. **Inventory** — counters and ledger: `parts_inventory`, `parts_inventory_adjustment`,
   `parts_purchased_inventory`, `parts_purchasing_log`, `parts_salepurchase_log`,
   `parts_selling_log`, `parts_price_lock`.
10. **Invoicing and RGA** — `inv_hours`, `inv_parts`, `inv_soparts`, `inv_tax`, `inv_project`,
    `rga*`, ServiceChannel invoice tables.
11. **TJX** — `tjx_quote`, rooms, fixtures, fixture parts, revisions, sub-invoices and rates.
12. **Messaging and history** — `messages`, `messages_links*`, `email_messages_to_sub`,
    `po_notification`, `rga_notification`, `sub_stock_*`, `cron_run_history`, `site_activity_logs`.
    History is read-only in the new app.

Purchasing receipts need a special rule. Legacy stores only `po_parts.qty_received`; the new model
stores receipt events and a stock ledger. Migration creates **one synthetic opening receipt per PO
line with `qty_received > 0`**, with `source = 'legacy'`, `stock_posted_at = null`, and the
already-counted quantity in a separate opening-balance ledger row. It must not post stock again.
If the target Purchasing module does not support an imported receipt, the module is blocked; the
migration must not fake a receipt by editing the cache.

### 2.6 Field rules

| Legacy | App rule |
|---|---|
| latin1 text | convert once to UTF-8 at extract; never double-convert; record `encoding_checked` |
| money in `varchar` | strip `$`, commas, spaces; empty and non-numeric become `NULL`; never zero-fill |
| `tinyint(1)` | keep as `smallint`; do not coerce ternary `NULL`/0/1 to boolean |
| `date` / `datetime` / `timestamp` | ISO; legacy wall-clock values stay wall-clock; no timezone shift |
| enums | validate against the new enum/lookup; unknown label = error, not nearest match |
| `workorder.customer` | this is usually a **site** id; map to `app.work_orders.site_id` |
| `workorder.site` | use only when `customer` does not resolve; record precedence in the row map |
| `sites.custid` | map to `app.sites.customer_id`; null stays null |
| `users.password`, `mailing_password`, `cls_mailing_password` | never import into `app.users` or the application schema |
| `parts.number` | the business key; preserve exactly, including case for display; lookup is normalised |
| `wo_next_pid.next_id` | set `app.work_order_number_series` to at least `max(source_next_id, max(workorder.id)+1)` |
| serial ids in `app` (`quotes.id`, PO numbers) | explicit insert during the frozen window, then `setval`; never let a sequence issue an id that a legacy row already owns |
| negative local ids | reserved for post-go-live local rows; migration never emits one; `local_id_allocations` reset to start at 0 |

### 2.7 Run report and promotion

Each run writes a machine-readable report:

```json
{
  "runId": "...",
  "dumpId": "sha256:...",
  "gitSha": "...",
  "manifestVersion": "2026-11-11.1",
  "modules": [
    { "module": "master-data", "status": "passed", "sourceRows": 12345, "transformedRows": 12345, "errors": 0, "exceptionsOpen": 0 }
  ],
  "parity": { "cases": 68, "passed": 68, "failed": 0 },
  "warnings": []
}
```

Promotion is a database flag, not a printed checklist:
`migration.modules(module, status, run_id, approved_by, approved_at)`. The cutover controller reads
that flag. A module with `status <> 'passed'` cannot be enabled in the new app.

---

## 3. Parity harness

### 3.1 The oracle: capture before anyone writes

There is no test oracle in the old system, so the frozen legacy snapshot becomes the oracle.

1. On cutover morning, stop the portal and the scheduler, or lock the affected tables.
2. Take the final logical dump. This is the **same dump** imported into staging.
3. Restore it to a scratch MySQL. This is the only database the parity runner reads.
4. Run every parity case against the scratch restore **twice**. Normalised output must be
   byte-identical. A non-deterministic query is fixed before it is accepted.
5. Store each capture as JSONL plus a manifest:
   `parity/captures/<dump_id>/<module>/<case>.jsonl`,
   `manifest.json` with SQL hash, row count, column list, checksum, capture time, operator.
6. Have the module owner sign the manifest. A signature is a decision that this is the expected
   legacy behaviour, including any known defects reproduced.

For documents, capture representative legacy PDFs and totals (quote, invoice, PO, TJX quote,
packing slip). Store the PDF hash and the extracted totals. The new PDF is not required to be
byte-identical; its **numbers, tax, addresses and line order** must match. Visual review is a
separate, sampled sign-off.

### 3.2 Normalisation

- Money: fixed scale, two decimals, decimal strings; compare exact, not floats.
- Dates: `YYYY-MM-DD`; timestamps: ISO in `America/Toronto`; null is distinct from `0` and `''`.
- Text: trim trailing spaces from `char(n)`; do not casefold names unless the business rule does.
- Ordering: every query has an explicit `ORDER BY` on a stable key.
- Row identity: every case returns a key column so a difference names the record, not just a total.
- Known exceptions are excluded **by an explicit predicate and a recorded count**, never by
  narrowing the query until it passes.

### 3.3 Module queries

The runner stores a pair per case: `legacy.sql` and `app.sql`, same output columns. The following
are the required cases. `:dump_id`, `:cutover_at` are parameters; do not hard-code dates.

#### Master data

```sql
-- counts and orphan shape
select 'customers' entity, count(*) rows from customer
union all select 'sites', count(*) from sites
union all select 'subcontractors', count(*) from subcontractor
union all select 'suppliers', count(*) from suppliers
union all select 'parts', count(*) from parts;

-- every site must map to a customer or be a recorded exception
select count(*) as orphan_sites
from sites s left join customer c on c.id = s.custid
where c.id is null;

-- every work order must resolve a site
select count(*) as unresolved_workorder_sites
from workorder w left join sites s on s.id = w.customer
where s.id is null;
```

App equivalent uses `app.customers`, `app.sites`, `app.subcontractors`, `app.suppliers`,
`app.parts` and `app.work_orders.site_id`. The expected orphan count is 1,086 until the client
decides to import missing parents; the expected unresolved work-order-site count is 18,106 until
the same decision. Those counts are asserted as exceptions, not hidden.

#### Work-order totals

```sql
-- legacy: one row per work order, no join multiplication
select w.id as work_order_id,
       coalesce((select sum(p.qty * p.price)  from wo_parts   p where p.woid = w.id), 0) as parts_total,
       coalesce((select sum(s.qty * s.price)  from wo_soparts s where s.woid = w.id), 0) as special_total,
       coalesce((select sum(h.hours * h.hourly_rate) from wo_hours h where h.woid = w.id), 0) as labour_total,
       coalesce((select t.tax_total from wo_tax t where t.woid = w.id), 0) as tax_total,
       w.status
from workorder w
order by w.id;
```

```sql
-- app
select w.id as work_order_id,
       coalesce((select sum(p.qty * p.price) from app.work_order_parts p where p.work_order_id = w.id), 0) as parts_total,
       coalesce((select sum(s.qty * s.price) from app.work_order_special_parts s where s.work_order_id = w.id), 0) as special_total,
       coalesce((select sum(h.hours * h.hourly_rate) from app.work_order_hours h where h.work_order_id = w.id), 0) as labour_total,
       coalesce((select t.tax_total from app.work_order_tax t where t.work_order_id = w.id), 0) as tax_total,
       w.status
from app.work_orders w
order by w.id;
```

Pass criteria: every work-order id in the legacy set is present, and every money column is equal
to the cent. The aggregate anchors from the recovered snapshot are `workorder` 42,258,
`wo_parts` 45,390, `wo_hours` 30,517, `wo_soparts` 27,756, `wo_tax` 26,530. They are sanity
anchors, not a substitute for the per-row comparison.

#### Invoice snapshot and tax

```sql
-- legacy invoice totals, parse only rows that stored a number
select t.woid,
       cast(nullif(regexp_replace(t.subtotal_amount, '[^0-9.-]', '', 'g'), '') as decimal(12,2)) as subtotal,
       cast(nullif(regexp_replace(t.tax_amount,      '[^0-9.-]', '', 'g'), '') as decimal(12,2)) as tax,
       cast(nullif(regexp_replace(t.total_amount,    '[^0-9.-]', '', 'g'), '') as decimal(12,2)) as total
from inv_tax t
where t.total_amount regexp '^-?[0-9]+\\.?[0-9]*$'
order by t.woid;
```

The app equivalent compares the invoice snapshot once the Invoicing module publishes its table. The
migration must also report the blank-money population separately:

```sql
select count(*) as blank_total_rows
from inv_tax
where total_amount is null or trim(total_amount) = '';
```

Expected: about 24,452 blank rows and 3,350 numeric rows. The blank rows are **not** zero-filled.
Their display total is either blank (legacy behaviour) or explicitly labelled "reconstructed from
lines"; accounting decides which. The stored `inv_*` line sums are the fallback evidence.

#### Quote totals

```sql
-- legacy customer quote header + line sums (live dump required)
select q.id as quote_id, q.workordernumber, q.site, q.status,
       coalesce(sum(p.qty * p.price), 0) as parts_total,
       coalesce((select sum(h.hours * h.rate) from customer_quote_hours h where h.cust_qoid = q.id), 0) as labour_total
from customer_quote q
left join customer_quote_parts p on p.cust_qoid = q.id
group by q.id, q.workordernumber, q.site, q.status
order by q.id;
```

App: `app.quotes` + `app.quote_parts` + `app.quote_hours`, with `kind = 'customer'`. Repeat for
`standalone_quote` / `kind = 'standalone'`. The recovered archive has the line tables but not the
headers, so this case is blocked until G0.

#### Purchase-order totals and received quantities

```sql
-- legacy: ordered and received by PO, price is varchar
select po.id as po_id,
       count(p.id) as line_count,
       coalesce(sum(p.qty), 0) as ordered_qty,
       coalesce(sum(p.qty_received), 0) as received_qty,
       coalesce(sum(p.qty * cast(nullif(regexp_replace(p.price, '[^0-9.-]', '', 'g'), '') as decimal(12,2))), 0) as ordered_value,
       po.status
from purchaseorder po
left join po_parts p on p.poid = po.id
group by po.id, po.status
order by po.id;
```

Repeat with `po_soparts` and special-part value. App: `app.purchase_orders`,
`app.purchase_order_parts`, `app.purchase_order_special_parts`, with `qty_received` equal to the
sum of `app.purchase_order_receipt_lines`. If the synthetic legacy receipt is used, its lines must
sum exactly to the legacy `qty_received`.

Invoice side:

```sql
select i.poid,
       count(*) as invoice_lines,
       coalesce(sum(cast(nullif(regexp_replace(ip.linetotal, '[^0-9.-]', '', 'g'), '') as decimal(12,2))), 0) as invoiced_value
from po_invoice i
join po_invoice_parts ip on ip.invoice_id = i.id
group by i.poid
order by i.poid;
```

App equivalent uses `app.purchase_order_invoices` + lines once the module publishes them.

#### Stock counters

```sql
-- legacy: counter vs implied ledger arithmetic; drift is expected
select p.number,
       p.current_quantity,
       p.purchased_quantity,
       p.sold_quantity,
       p.purchased_quantity - p.sold_quantity as implied,
       p.current_quantity - (p.purchased_quantity - p.sold_quantity) as drift
from parts p
order by p.number;
```

App equivalent compares the migrated `current_quantity` to the same legacy counter and separately
to the new movement ledger. **Do not "correct" the legacy drift during migration.** Capture the
count and the per-part deltas before cutover; the new system must reproduce the same opening
balance, then the ledger must explain every movement after cutover. A difference after cutover is a
new defect, not a legacy exception.

Also capture adjustment and inventory table counts:
`parts_inventory`, `parts_inventory_adjustment`, `parts_purchased_inventory`,
`parts_purchasing_log`, `parts_salepurchase_log`, `parts_selling_log`.

#### TJX

```sql
select q.id as quote_id, q.status,
       count(distinct f.id) as fixture_rows,
       coalesce(sum(cast(nullif(f.totalfixtures, '') as decimal(12,2))), 0) as fixture_qty
from tjx_quote q
left join tjx_quote_fixtures f on f.quoteid = q.id
group by q.id, q.status
order by q.id;

select f.id, f.fixturename, count(fp.id) as part_lines,
       coalesce(sum(cast(nullif(fp.part_ratio_perfixture, '') as decimal(12,4))), 0) as ratio_total
from tjx_fixture f
left join tjx_fixture_parts fp on fp.fixtureid = f.id
group by f.id, f.fixturename
order by f.id;
```

App equivalent uses the TJX target tables. The recovered archive has definitions only; the live
dump is required. The fixture **data** is not the same as the pricing fixture **packs** in §3.4.

#### Status histograms and anchors

Capture the counts that already exist in `MIGRATION-NOTES.md`:

```sql
select status, count(*) from workorder group by status order by status;
select status, count(*) from purchaseorder group by status order by status;
select count(*) from workorder where sgsales_done = 1;
select count(*) from wo_invoiceno;
```

These are coarse, but they catch a migration that loses a status bucket while keeping a plausible
total.

### 3.4 Fixture packs already built

The fixture packs are frozen inputs with expected outputs. They are replayed against the legacy
calculator before cutover and against the new pricing functions after every change.

| Pack | Cases | Boundary |
|---|---:|---|
| `packages/pricing/fixtures/quote.json` | 10 | customer/standalone quote totals, tax, incurred margin, rounding, sentinel special parts |
| `packages/pricing/fixtures/sales-invoice.json` | 28 | sales invoice calculator, tax, manual tax, rounding |
| `packages/pricing/fixtures/local-wo.json` | 6 | local work-order pricing |
| `packages/pricing/fixtures/project-wo.json` | 6 | project work-order pricing |
| `packages/pricing/fixtures/subcontractor-invoice.json` | 10 | subcontractor purchase invoice pricing |
| `packages/pricing/fixtures/purchase-order.json` | 8 | purchase-order tax and totals |
| `apps/web/src/modules/work-orders/lib/fixtures/wo-numbering.json` | 6 | numbering collisions, including the documented legacy C4 bug |
| `packages/pdf/test/fixtures.ts` | — | PDF document data and font checks |

At cutover, capture the **legacy calculator output** for every case (or a signed statement that the
expected outputs were captured when the fixture was built). For `wo-numbering`, the new allocator
intentionally fixes C4; the difference must be listed as an accepted divergence, not silently
ignored. The `quote`/`invoice` cases compare to the cent; a one-cent difference fails.

### 3.5 Parity verdict

A module passes only when:

- every required case has a capture, a new run, and an exact or explicitly excepted diff;
- all 175 authoritative tables have a row-count result (or an explicit missing-dump gate);
- no unexplained orphan or duplicate key exists;
- every exception has `decision in ('accepted','fixed','excluded')` and an owner;
- the module owner signs the run report and the finance owner signs money modules.

### 3.6 Sage reconciliation under the cloud API

The old parity idea — "the rebuild writes the same `simply` tables, so compare rows" — is void
under D18. The replacement compares **money at the boundary**, not tables, because the legacy Sage
50 company and the cloud ledger never share a document id again.

Three artefacts, captured and signed together:

1. **Legacy ledger snapshot at the opening-balance date.** Taken from Sage 50's own reports, not
   from the MySQL tables: aged receivables and payables by customer and vendor, trial balance,
   tax collected by code and period. Reports are the accounting truth; `tcustr` is only the
   storage that produced them. A signed PDF/CSV pair per report, dated, with the person who pulled
   it.
2. **Opening-balance load.** Contacts, their balances and the GL opening positions are loaded
   through the cloud API and the request log is kept: request id, external reference, API id,
   amount. `migrated` / `source_guid` / external-reference fields exist for exactly this and must
   be set, so a reload is recognisable rather than duplicated.
3. **Reconciliation queries, run daily after the switch.** Per customer: opening balance plus
   invoices posted since, minus payments, equals the ledger balance. Per period: invoice count and
   total by date, tax by rate, and the count of posting attempts per status. Per document: our
   external reference maps to exactly one API id, never two.

The verdict is a trial balance and an aged-receivables total that agree exactly at the boundary,
followed by document-level agreement on everything posted after it. A one-cent drift fails the
run: it is the signature of a rounding or tax-model difference that will grow every month it is
left alone.

The ambiguity that has to be resolved by the human, not by the harness, is *what the cloud ledger
is expected to contain*. If it is a clean opening position plus future documents, the conversion
is small and the history stays in Sage 50 as an archive. If finance expects per-document history
in the cloud product, the exercise becomes a data conversion of 71,087 invoice lines and 45,390
work-order part rows into a product that may not accept historical inventory movement — and that
is a different project. `plan/modules/SAGE-CLOUD.md` §7 states the choice.

---

## 4. Cutover sequence

### 4.1 Cutover units, not isolated modules

A module cannot be cut over in isolation if a still-legacy module writes the same entities. Master
Data is the clearest example: if new customers are created only in Postgres, the still-legacy Work
Orders screen cannot see them. Cutting Master Data alone would split the business key space.

The plan therefore uses **cutover units** with a one-way **legacy outbox** for coexistence:

```
new app write (cut module)
   → app transaction (business row + audit + legacy_outbox row)
   → legacy outbox worker applies the same change to MySQL
   → still-legacy modules continue to see a consistent legacy database
```

Legacy write access for the cut module's tables is revoked, so only one writer per table exists.
The outbox is app→legacy only; there is no bidirectional dual write. This is what makes a
single-module rollback possible.

| Wave | Cutover unit | What must be in `app` and parity | Legacy still owns |
|---|---|---|---|
| 0 | Shadow read-only | Master data, parts, work orders, quotes imported; new screens read-only; no outbox | everything |
| 1 | Foundation: customers, sites, subcontractors, compliance docs, suppliers, parts/rates, users | master data + pricing; identity mapping; outbox for master data/parts | work orders, quotes, purchasing, inventory, invoices, TJX |
| 2 | Work Orders + Quotes | both modules complete; numbering; PDFs; outbox for WO/quote tables | purchasing, inventory, invoicing, TJX |
| 3 | Purchasing | POs, RFQs, preorders, receipts, supplier invoices; outbox for PO tables | inventory, invoicing, TJX |
| 4 | Inventory and price management | counters, ledger, adjustments, price lock; outbox for inventory | invoicing, TJX |
| 5 | Invoicing and RGAs | invoice snapshots, tax, PO/sub invoices, Sage posting staging; **the Sage cutover is a gate inside this wave: opening balances, API consent, one reconciled test document** | TJX |
| 6 | TJX | fixtures, rooms, quotes, sub-invoices | messaging/compliance/admin |
| 7 | Messaging, compliance, reports, admin | history and new notifications/jobs; no financial writes | none |

Wave 1 can be deployed days before Wave 2, but the legacy outbox must be live and monitored. If
the outbox lag exceeds the agreed threshold (for example 60 seconds or 100 rows), Wave 2 does not
start.

### 4.2 Per-wave runbook

**T-14 days**

- Freeze the target `app` schema for the unit. New migrations require a compatibility review.
- Complete the target mapping manifest and run a full rehearsal on the current live dump.
- Run parity, open every exception, assign owners.
- Train the operators on the new screens; print the rollback card.

**T-7 days**

- Rehearse with a fresh dump. Record duration, row counts, parity failures and outbox lag.
- Confirm the legacy routes and scheduler entries that must be disabled.
- Confirm MySQL/Sage user grants and the person who can change them.

**T-1 day**

- Back up legacy MySQL (logical dump + verify restore), Neon branch, object storage, and the Sage
  company file.
- Put the cutover bridge page in place. Notify field staff of the window.
- Freeze any schema change on both systems.

**T-0, module switch**

1. Stop the legacy scheduler entries for this unit. Stop in-flight writes at the HTTP layer.
2. Revoke `INSERT/UPDATE/DELETE` on the unit's MySQL tables from the legacy portal user, or put the
   legacy routes into read-only mode. Reads stay available.
3. Drain in-flight requests; wait for the legacy table locks to clear.
4. Take the final dump (or an incremental delta if the harness supports it) and record its hash.
5. Run `load → normalise → transform → reconcile → verify` for the unit.
6. Compare row counts, money anchors, status histograms and the fixture packs. All must pass.
7. Enable the new module writes and the **legacy outbox**. Confirm the outbox applies a known test
   row to MySQL.
8. Keep the legacy screens read-only and visible for the rollback window.
9. Watch errors, outbox lag, duplicate detection, and the first real transactions.

**T+1 to T+7**

- Daily parity delta: new app rows vs legacy mirror, outbox lag, failed jobs.
- Reconcile new records that the legacy outbox could not represent. Stop the wave if the delta is
  not explainable.
- After the agreed quiet period, stop writing the outbox for that unit and retire the legacy
  routes.

### 4.3 Rollback one module

Rollback is a feature flag plus a data decision, not a database restore of the whole system.

**Before new writes (within the cutover window):**

1. Disable new writes for the unit.
2. Stop the outbox worker for that unit and wait for the last applied row.
3. Re-grant legacy writes and re-enable the legacy routes/scheduler.
4. The legacy database is already current because the outbox applied the new rows. No restore is
   needed.

**After new writes but before a Sage posting:**

1. Disable new writes; drain the outbox.
2. Compare `app` and legacy for the unit using the same parity queries; the outbox should make
   them equal.
3. Reverse any app-only rows that the outbox could not map (new negative ids) by exporting them to
   legacy with new MySQL ids and writing the mapping back to `migration.row_map`.
4. Re-grant legacy writes and switch the feature flag.
5. Leave the app data in place, read-only, for the next attempt.

**After a Sage posting:**

Do not roll back automatically. Freeze the module, reconcile the Sage documents, and decide
whether to reverse them with credit notes/journals or to keep the new writer. Restoring the Sage
company file is a last resort and requires the Sage owner. A module that has posted to Sage is
**forward-fix only** until the Sage reconciliation is signed.

The rollback does not touch other waves. The legacy outbox and per-unit grants are what isolate
them.

### 4.4 Sage cutover: one writer, one direction, one reconciliation

Under D18 the legacy writes Sage 50's `simply` tables and the rebuild writes a **Sage cloud API**.
They are separate ledgers, so "two writers on one database" is no longer the hazard. What replaces
it:

- **One posting path per document, chosen by date.** Invoices and bills up to the opening-balance
  date are posted by the legacy into Sage 50 and never re-posted by the new system. Documents after
  that date are posted by the rebuild into the cloud ledger and never by the legacy. A document
  crossing the boundary is the failure case, so the opening-balance date is fixed, published, and
  enforced by a `posting_period` row that both systems respect during the overlap.
- **One credential set, one token custodian.** There is no grant to revoke at the switch; there is
  an OAuth 2.0 consent to obtain, a rotating refresh token to store, and a keep-alive refresh so
  the integration does not silently expire. Exactly one environment holds the active token pair
  for the company, and a second holder is the new version of the two-writer bug.
- **The legacy posting path is still stopped at the gate.** Not because of a shared table, but
  because a legacy posting after the opening-balance snapshot breaks the reconciliation baseline.
  Stop the portal's Sage transfer routes and scheduler, wait for in-flight postings, and take the
  final snapshot of open items and balances.
- **Reconciliation, not parity, is the acceptance test.** After the first posting, the new system
  compares its document to what the API returned and to the expected ledger effect, by external
  reference. The legacy cannot be compared to the API at all; the comparison is *legacy ledger
  totals at the snapshot date* versus *opening balances loaded into the cloud ledger*, plus
  document-level agreement on everything posted since.
- **Rollback stops short of the accounting.** Disable the new posting worker, reconcile what it
  posted, reverse it with credit notes or journals if it is wrong. There is no company file to
  restore and no grants to swap. A document that has posted is forward-fix only until the finance
  owner signs the reconciliation.

The new system must not use the legacy `under_maintenance.php` behaviour: a Sage outage degrades
Sage features and shows status, but does not take the ERP down. Postings queue in the outbox and
drain when the API returns.

---

## 5. Data-quality exceptions

These are measured findings, not hypotheticals. The migration records every one in
`migration.exceptions` with a decision and an owner.

| Class | Measured | What migration does | Human decision / owner |
|---|---:|---|---|
| Work-order rows whose `workorder.customer` has no `customer.id` | 18,106 | Maps the value as `app.work_orders.site_id`; if no `sites` row exists, preserves the raw id and records `orphan_workorder_site`; never invents a site | Import missing sites from Sage `tcustshp`, or accept unresolved. Operations + data platform |
| `sites.custid` with no `customer` | 1,086 | `app.sites.customer_id = NULL`; site remains selectable; list/detail mark "No billing customer" | Import parents from Sage or accept orphans. Operations |
| Duplicate usernames | 2 | Quarantine both rows; no unique index/credential created until resolved; preserve legacy ids | Pick canonical row; merge or rename the other. Admin |
| Disabled users | 278 of 368 | Migrate as disabled `app.users`; no Neon Auth user, no invite, no email; history retained | Confirm any reactivations individually. Admin |
| Subcontractor accounts | 339 | Segment active/disabled/missing-email/shared-email before invitations; map `subid` to a real vendor | Approve the active list and shared-email handling. Admin + operations |
| Blank `inv_tax` money | about 24,452 rows | Store `NULL`; never zero-fill; keep line-level evidence; parity compares the 3,350 parseable rows | Decide whether to backfill from Sage or leave blank. Accounting |
| `po_status_v2` | dead table, zero code references | Do not migrate; archive definition only | Confirm archive/removal. Data platform |
| Placeholder WOs `99999999`, `44444444`, `9999999`, `9999998`, `0` | 5 | Quarantine in `migration.exceptions`; do not insert into `app.work_orders` unless the human chooses; never let the allocator issue them | Delete/archive or import with a flag. Business owner |
| `wo_parts.partno = '---'` | 110 of 113 unresolved part lines | Quarantine; do not create a fake part; preserve the line as an exception | Map to a special part or discard with sign-off. Operations |
| Orphan work-order/parts lines | 4 `wo_parts`, 1 `inv_parts`, 1 `workorder.site` | Quarantine raw rows; no FK violation is forced | Attach to the right parent or archive. Module owner |
| `parts.current_quantity` vs counter arithmetic | baseline drift | Preserve legacy counters exactly; write an opening balance and a drift report | Accept the baseline; never "fix" during migration. Finance + inventory |
| Money stored as text | `inv_tax`, `po_invoice*`, `po_parts.price`, `rga_parts.price` | Parse to `numeric`; empty/non-numeric to `NULL`; report each unparseable row | Accounting confirms blank/invalid handling |
| latin1 text | all tables | Convert once at extract; verify accents on the known affected rows | Data platform |
| Missing InnoDB rows | 77 authoritative tables | Block the affected module until the live dump is loaded and counted | Client provides dump. Data platform |

Two rules apply to every exception:

1. A count on a dashboard is not a decision. The row is listed with its source key.
2. An exception cannot be "accepted" by the migration team alone if it changes a financial total,
   a customer identity or a legal compliance state. Finance/operations/admin owns it.

---

## 6. User migration

### 6.1 Identity target

`app.users` is the profile/role/enablement row. Neon Auth owns credentials. The legacy MD5 hash is
never accepted by the new login and is never copied into `app.users`.

### 6.2 Decision: forced reset with a time-boxed legacy-claim bridge

**Default for staff/admin accounts and every account with a verified, individually controlled
email: forced reset.**

1. Pre-create `app.users` with `legacy_id`, `username`, `email`, role, `is_enabled`, and the
   subcontractor link. No password.
2. Create the Neon Auth user (admin API) and send a one-time set-password invitation through the
   notification service.
3. Invitation token: random 256-bit value, stored only as a hash, single use, 72-hour expiry,
   bound to the user and email. The link sets the password at the provider; the app never sees it.
4. On first sign-in, link `neon_user_id`; audit `auth.user.migrated`.
5. Require email verification before the account can act. The invitation itself proves control of
   the address.

**Exception for active subcontractor field staff: legacy-verify-then-rehash, for a limited
window.**

- The new login has a "Migrate my legacy account" path for active subcontractor accounts.
- The user enters the legacy username and password. The server compares the MD5 **against the
  frozen legacy snapshot only**, over a private connection, rate-limited per account and IP
  (5 attempts / 15 minutes, then lock and require office help).
- On success, the server immediately creates/updates the Neon Auth credential with the user's new
  password (provider hashing), stores no MD5 in Neon, audits the event, and burns the bridge for
  that account.
- The bridge is disabled globally after 60 days or when the active list is complete, whichever is
  first. It never works for disabled accounts.
- If the frozen legacy snapshot cannot be kept private, the fallback is forced reset for that
  cohort; do not move the MD5 hashes into Neon.

Why not force reset everyone: 339 subcontractor accounts include field staff with shared or
stale mailboxes; a blanket reset would lock out dispatch. Why not carry MD5: it is unsalted,
broken, and would make the new system complicit in the old credential risk. The bridge is a
one-time migration path, not a second password store.

### 6.3 The 339 subcontractor accounts

Do not bulk-invite 339 rows. Build the account inventory first:

| Segment | Action |
|---|---|
| Active subcontractor user with a unique, valid email | Invite; map `subid` to `app.subcontractors.sage_subcontractor_id` |
| Active user with a shared/generic company email | Office-assisted onboarding; one named account per person where possible; never a shared password |
| Active user with no email / bounced email | Office verifies identity by phone and issues a one-time code; no self-serve |
| Disabled user | Migrate disabled; no credential, no invite; reactivate through the normal admin flow |
| User whose `subid` has no vendor row | Exception queue; do not create a fake vendor; resolve with Sage vendor import |
| Duplicate username | Resolve before invite; one canonical account, the other archived/renamed with audit |

A subcontractor user sees only its own work orders; the `subcontractor_id` link is the scope. A
missing or wrong link is a security defect, so it is checked before the first invite, not after.

### 6.4 Why not carry the mail passwords

`users.mailing_password` and `cls_mailing_password` are legacy SMTP credentials. They are not
identity. They are not migrated. The new notification service uses one configured sender identity
and environment secrets. This removes secret sprawl and the per-user SMTP failure mode.

### 6.5 Cutover-day user flow

- The new login page resolves an email or legacy username to `app.users.email`.
- Disabled users are refused with a generic message and audited.
- A user who has not completed migration gets the invitation/reset path, not an MD5 prompt, unless
  they are in the active-subcontractor bridge cohort.
- The legacy portal stays reachable read-only during the rollback window; it continues to accept
  its old MD5 credentials until it is retired. The two systems do not share sessions.

---

## 7. Evidence pack and sign-off

For each wave, archive:

1. Dump file SHA-256, size, timestamp, MySQL version, row-count manifest.
2. `migration.runs` and `migration.errors` export; `migration.exceptions` with decisions.
3. Parity capture manifests and the diff report.
4. Fixture-pack results (68 money cases + 6 numbering cases + PDF).
5. Backup restore evidence for Neon, MySQL, Sage and object storage.
6. Rollback rehearsal notes and elapsed time.
7. Signed go/no-go: module owner, finance owner (money waves), operations owner, data platform.

---

## 8. Riskiest assumptions

These are the five assumptions most likely to invalidate the plan. They are stated here so they
can be tested before a cutover date is promised.

1. **The 77 InnoDB tables still have rows on the live server and the client can produce a
   consistent dump.** If the live server has already lost them, quoting, purchasing, TJX,
   inventory, suppliers, permissions and compliance documents cannot be migrated from history;
   the plan becomes a data reconstruction project, not a cutover.
2. **The legacy outbox can represent every new-app write in the legacy schema while old modules
   remain live.** Master data and work-order writes are mostly mappable; invoices, receipts, price
   changes and calculated totals are not. If a write cannot be mapped, the dependent wave must be
   bundled, not forced.
3. **The Sage target is a cloud ledger that was never reconciled to the Sage 50 books, and the
   cutover accepts an opening-balance date.** The freeze risk is gone (no company file, no
   counters, no shared tables), and it is replaced by three others: the cloud product must support
   the documents this business posts (Canadian tax, customer invoices, supplier bills),
   its API quota must cover a month of posting plus polling, and finance must accept Sage 50 as a
   closed history archive rather than a system that keeps agreeing to the cent. If the chosen
   product differs from Sage 50 in a way that matters — no project costing, no purchase orders, or
   a different tax model — the affected wave must bundle that gap rather than invent a workaround
   at cutover. See `plan/modules/SAGE-CLOUD.md`.
4. **The target modules will publish stable natural keys and ID policies before their cutover.**
   Quotes currently use a serial `id` for a customer-facing number; PO uses the PO number;
   work orders preserve the legacy number. If those rules change after migration, the row map and
   sequence plan must be rebuilt.
5. **The legacy numbers are accepted as-is, including known defects.** The 18,106 site/customer
   mismatches, 24,452 blank tax totals, placeholder WOs and stock-counter drift are treated as
   data, not bugs to fix. If finance or operations expects the migration to "clean" them, parity
   will fail by design and the cutover will stall.
