# Sage 50 → Sage Accounting data conversion

**Status:** active workstream. **Date:** 2026-11-11. **Owner:** Data platform, with the finance owner
and Alliance Lighting as the Sage account holder.
**Decisions:** D19 (Sage Business Cloud Accounting), D21 (migrate Sage 50 **including historical
documents**), D22 (Neon stays in Ohio), D23 (Alliance owns the subscription and OAuth consent).
**Relates to:** `plan/modules/SAGE-CLOUD.md` §7 (quota arithmetic, what the API cannot accept),
`plan/modules/SAGE-RECONCILIATION.md` §8 (cutover mode), `plan/CUTOVER-AND-MIGRATION.md` §3.6 and
§4.4, `plan/modules/SAGE-ADAPTER-SCAFFOLD.md` (the loader reuses its outbox and quota machinery).

---

## 1. What this workstream is, and why it is separate

The rebuild migrates *operational* data into `app` (work orders, quotes, POs, customers, parts,
stock). This workstream migrates *accounting* data into a different system: Sage Accounting, reached
over an API with a hard quota. They share a source (the legacy MySQL dump) and a method (idempotent,
resumable, reconciled), and nothing else.

D21 chose the expensive option deliberately: historical documents move too. That converts a
two-day opening-balance exercise into a scheduled load measured in weeks, because the API posts one
record per call at 2,500 calls a day per company. This document states how to do it without
duplicating documents, without exhausting quota on retries, and with a signed reconciliation at the
end.

**The single most important sentence in this document:** the conversion is not finished when the
documents are loaded; it is finished when the **signed Sage 50 trial balance and aged receivables
agree to the cent** with what the cloud ledger now reports, and a named person has signed that.

---

## 2. What exists on the source side

### 2.1 The data store

Sage 50 Canadian edition (formerly Simply Accounting, now at the 2027.0 release line) serves its
company data through an **embedded MySQL server** on `localhost:13540-13544`, schema `simply`, latin1,
empty SQL mode. That is not a guess: the legacy portal has connected to it in production for years
(`green-system/MODULES.md` §11), which means the data is reachable by ordinary SQL and the schema is
already partly documented in our own notes.

It is also **unsupported by Sage**. The data files underneath are proprietary; the MySQL surface is
an implementation detail, and a future Sage release may change it without notice. The conversion plan
therefore treats SQL access as an extraction convenience, never as an agreed interface, and it
validates everything against Sage's own reports and a second extraction route.

### 2.2 What the ledger contains

| Object | Rows / size | Notes |
|---|---|---|
| Customers (`tcustomr`) + ship-to (`tcustshp`) | 3,760 customers, 4,844 sites | `lId` is the customer/site id the portal reuses |
| Vendors (`tvendor`) | ~888 subcontractors plus suppliers | Supplied by the recovery notes; suppliers unreadable in the archive, live dump required |
| Items (`tinvent`) | 2,605 parts | `sPartCode` is the immutable part number |
| Sales invoices | of the order of 40,000 documents | Work orders 42,258; `inv_parts` 71,087 lines, `inv_hours` 47,547, `inv_soparts` 43,045 |
| Sales tax | 27,802 rows, of which 3,350 parseable | ~24,452 blank-money rows are a known legacy defect |
| Money anchors | parts 18,522,092.42; labour 15,668,927.26; special parts 5,451,323.92; tax 10,239,845.01 | Use these as extraction checksums |
| Purchase side | POs, receipts, supplier invoices | In `purchaseorder`, `po_*`, `titlu`-equivalents; counts require the live dump |
| Receipts and payments | not yet enumerated | **Discovery item.** Without these, every converted invoice looks unpaid |
| Projects (`tproject`) | present | No destination in Sage Accounting (see §7) |
| Attachments | signature images and scanned documents on disk | Paths in the portal (`files_mod_signature`), not in Sage |

### 2.3 The four extraction routes, and what each is good for

| Route | What it gives | Support status | Risks | Use in this plan |
|---|---|---|---|---|
| **Direct SQL read** of the embedded MySQL | Every table, including line-level detail and internal ids | Unsupported by Sage | Schema may change; latin1; no foreign keys; reading while users work; table locks | **Primary extraction** for lists, documents and lines; read-only; snapshot at freeze |
| **Sage 50 .NET SDK (Canada edition)** | Documented object model for customers, vendors, items, invoices, receipts; write-capable | Supported, requires an application id and a 32-bit Windows host | Windows-only; per-release re-authorisation; slow per-record reads; no bulk export | **Second opinion**: re-extract a sample of 200 documents and diff against SQL. If the SDK cannot be obtained, substitute the CSV route |
| **Built-in export (Excel/CSV)** | Lists and report output a human runs | Supported | Manual, lossy for line-level, formatting drift | **Financial baselines**: trial balance, aged A/R and A/P, tax by code. Signed by finance |
| **Third-party bridge** (e.g. the commercial REST wrappers for Sage 50 Canada) | HTTP access without writing a Windows agent | Commercial vendor | Vendor dependency, data leaves the host, cost | Not used; noted so it is not re-litigated |
| **Sage-assisted migration service** | Sage performs the import behind the scenes | Commercial, negotiated | Availability and cost unknown | **Ask for it.** If available, it replaces the API document load and turns this workstream into verification |

Extraction rules that follow:

1. **Read-only.** No `INSERT`, `UPDATE` or `DELETE` against `simply` from the conversion tooling. The
   legacy portal is the only writer until it is switched off.
2. **Snapshot, then work from the snapshot.** Extract once into the `migration.stg_*` tables of the
   harness, checksum the extract, and convert from there. Never re-read live Sage mid-load.
3. **Validate the extract with Sage's reports.** Row counts and money anchors first, then the trial
   balance and aged reports. A discrepancy stops the conversion; it does not get explained away.
4. **Second-route sample.** 200 documents re-extracted via SDK or CSV and diffed against the SQL
   extract. This is the cheapest possible insurance against an undocumented column change.

---

## 3. What Sage Accounting accepts, and what it refuses

| Source object | Destination | Notes |
|---|---|---|
| Chart of accounts (`taccount`) | `POST /ledger_accounts` | Map by account number and name; unmatched → suspense account, listed |
| Tax codes (`ttaxcode`) | `POST /tax_rates` | GST/HST/PST/QST by province; Canadian `tax_address_region_id` required on some endpoints |
| Customers, ship-to | `POST /contacts` (CUSTOMER) | Main address plus delivery address; extra ship-tos collapse into the delivery address or stay in our app |
| Vendors | `POST /contacts` (VENDOR) | Subcontractors and suppliers |
| Items (`tinvent`) | `POST /products` or `POST /stock_items` | Stock items only when the tenant has stock enabled (tenant probe) |
| Opening A/R, A/P | `POST /opening_balances` | Per contact, at the conversion date; confirm whether it creates an artefact that must be reconciled |
| Opening GL | `POST /journals` | Double entry, one journal per control position |
| Sales invoices, credit notes | `POST /sales_invoices`, `/sales_credit_notes` | One request per document; `invoice_lines[]` carries the detail |
| Purchase invoices, credit notes | `POST /purchase_invoices`, `/purchase_credit_notes` | Supplier and subcontractor bills |
| Receipts, payments | `POST /contact_payments` + `/contact_allocations` | Required, or A/R and A/P never settle |
| Stock opening and movements | `POST /stock_items`, `/stock_movements` | Opening position, not a historical replay (§6.4) |
| Attachments | `POST /attachments` | Optional; costs quota per file |
| **Purchase orders** | **none** | No purchase-order endpoint; POs stay in our app and become a bill when invoiced |
| **Projects / jobs** | **none** | Not in the Canadian edition (§7) |
| Prior-year journals | Only if the period is open | Locked periods reject postings; the load must precede locking |
| User-defined fields (warranty flags) | none | Stay in `app` |
| Salespeople (`temp`) | none | Stay in `app` |

Two mapping rules that decide quality:

- **The ledger's own tables are the source for what Sage holds.** The portal's `inv_*` snapshots are
  our view of the invoice; Sage 50's tables are the ledger's view. Where they differ, the ledger wins
  for conversion and the difference is recorded as an exception — we do not import our opinion of a
  document into the ledger as fact.
- **Immutable identifiers travel.** Part numbers, invoice references and work-order numbers are
  carried in the destination's reference/legacy fields and never renumbered. Renumbering is how two
  systems stop being reconcilable.

---

## 4. The quota arithmetic, and the four ways to execute the load

The quota is the schedule. Sage Accounting allows **2,500 requests per day per company**, shared with
every other application on the tenant — including whatever the accountant uses. There is no bulk
endpoint, no partial-success response and no way to buy more calls inside the API. Everything below
follows from that number.

Four routes can execute the load, in preference order:

| Route | Duration | When to use it |
|---|---|---|
| **Sage-assisted migration** | Days to weeks, negotiated | Ask first, before any date is promised. If Sage will import the company data, our job becomes verification |
| **API load by us** | ~9 weeks exclusive, ~18 weeks shared (§4.1) | Default if Sage offers no assistance. Must be resumable and quota-budgeted |
| **Hybrid** — Sage imports transactions, we load master data and openings | Days plus days | If Sage will take one half of the data but not the other |
| **Third-party migration tool** | Days, licence cost | Last resort; it still needs the same signed reconciliation |

### 4.1 What one document costs

The first draft assumed a search before every create, because that is the safe retry pattern. It is
also twice the quota for no benefit: our `external_ref` is unique and a document that has never been
attempted cannot exist in Sage. So the rule is refined:

- **first attempt** (`attempts = 0`, status `queued`): create only, one call;
- **any retry** (`attempts > 0`, or status `sending`/`unknown` from a crash): search, then create if
  absent — two calls, which is exactly when the search earns its cost.

A crash between the POST and the link-write leaves the row in `sending`, so the resume path always
searches. Safety is preserved; the happy path halves.

| Population | Documents | Calls each | Calls |
|---|---:|---:|---:|
| Sales invoices and credit notes | ~40,000 | 1.05 | ~42,000 |
| Purchase invoices and credit notes | ~8,000 | 1.05 | ~8,400 |
| Payments and their allocations | ~25,000 | 2.0 | ~50,000 |
| Stock items and evidenced movements | ~12,600 | 1.0 | ~12,600 |
| Contacts, products, tax rates, ledger accounts | ~8,000 | 1.0 | ~8,000 |
| Verification reads and reconciliation passes | — | — | ~12,000 |
| **Subtotal** | | | **~133,000** |
| Retry and 429 allowance (+15%) | | | **~153,000** |

**Worst case, in calendar days:**

| Scenario | Calls/day for the conversion | Days | Weeks |
|---|---:|---:|---:|
| Exclusive — conversion before go-live, nothing else posting | 2,500 | ~61 | ~9 |
| With 500 reserved for polling and reconciliation | 2,000 | ~77 | ~11 |
| Shared 50/50 with live invoice posting | 1,250 | ~122 | **~18** |
| Shared with month-end freezes (5 days a month at zero) | ~2,300 average | ~67 | ~10 |

So the honest answer to "how long does the conversion take" is **nine weeks if it owns the quota,
eighteen if the business is also invoicing through the new system**. That is the range the cutover
date has to live inside, and it is why the assisted-migration question is worth asking before any of
this is committed.

### 4.2 The load as a resumable job

The load is not a script that runs to completion. It is a job that runs for weeks, stops for
month-end, survives a quota exhaustion and a re-authorisation, and resumes exactly where it stopped.

**State.** `migration.sage_load_runs` (one row per attempt: snapshot id, status
`planned|running|paused|complete|failed`, `paused_reason`, `claimed_docs`, `posted_docs`,
`failed_docs`, `last_ordinal`, timestamps) and one `app.sage_postings` row per source document
carrying `run_id` and a deterministic `sort_key` (`document date`, then source id). The posting row is
the unit of progress; the run row is the unit of control.

**Ordering.** Claim in `sort_key` order within a document type, so invoices precede the credit notes
and payments that reference them. Document types run in the order of §5; inside a type, date order.

**Claim and lease.** `SELECT … WHERE run_id = $1 AND status IN ('queued','retryable') AND
next_attempt_at <= now() ORDER BY sort_key LIMIT $2 FOR UPDATE SKIP LOCKED`, then mark `sending` with
a worker id and a **two-minute lease**. A lease older than two minutes is reclaimed by the next
worker; the search-on-retry rule turns that into a lookup instead of a duplicate.

**Batch size.** Ten documents per invocation. At one to three calls each that is 10-30 calls, far
under the 100/minute ceiling, and it keeps an invocation inside the platform's time budget with room
for a slow tenant. The daily quota, not the minute limit, is the binding constraint.

**Checkpoint.** Every batch commits its own document rows, so a crash loses at most a lease, never a
document. `last_ordinal` on the run row is a cursor to avoid rescanning, not the source of truth —
the resumable state is the set of rows that are not `sent` or `skipped`.

**Pause and resume.** `POST /api/internal/jobs/sage.convert` with `{ action: 'pause' | 'resume' |
'status' }` and the job secret; the same handler the scheduler calls. Pausing flips the run row and
the claim query returns nothing within one invocation. Automatic pauses, each recorded with a reason:

| Trigger | Run state | Resumes |
|---|---|---|
| Daily quota exhausted (90% guard) | `paused`, reason `quota` | Next quota reset, automatically |
| `needs_reauth` (refresh token dead) | `paused`, reason `reauth` | Only after a human authorises, then manual resume |
| 3 consecutive 5xx from the tenant | `paused`, reason `tenant_error` | After 30 minutes, automatically; three consecutive pauses alert |
| 422 rate above 5% in a batch | `paused`, reason `mapping` | Only after a human fixes the mapping — bulk-loading rejections burns quota for nothing |
| Month-end window | `paused`, reason `close` | First business day after the close |

**Evidence.** A daily progress row: documents attempted, posted, skipped, failed, calls used by
class, projected completion date at the current rate, and the delta against the planned cutover. A
projection that slips more than three days raises an alert, because the failure mode here is not a
crash — it is a load that is quietly two weeks late.

### 4.3 What normal posting does to the window

The conflict only exists if the new system goes live before the conversion finishes. Three ways to
order that, and their real costs:

1. **Serial — convert, then go live.** The conversion owns 2,500 calls a day and finishes in about
   nine weeks; the new system's first invoice posts afterwards. Cleanest reconciliation story,
   longest calendar. **Recommended if the client can wait.**
2. **Interleaved — go live, convert at the edges.** Live posting gets first claim on the quota, the
   conversion takes the remainder (about 1,250 a day, ~18 weeks), and the conversion is suspended
   during month-end. Reconciliation becomes harder, not impossible: the baseline is the snapshot
   date, and everything the new system posts after it is *outside* the historical load and *inside*
   the daily reconciliation.
3. **Paused — go live, backfill later.** The new system posts for a period while the conversion is
   stopped, then the backfill runs against a historical window that keeps growing. Only sensible if
   the client accepts that history arrives late.

**The rule that makes interleaving safe:** the conversion baseline is the snapshot date, fixed once.
Historical documents dated on or before it are loaded from the extract; documents the new system
creates after it are never loaded from the extract, and the load's `sort_key` upper bound is the
snapshot date. Without that bound, the same invoice exists twice — once posted live, once imported —
and the trial balance comparison is worthless.

**Sharing rule if interleaved.** Classes and their daily caps: `posting` 1,000 (it is the business's
live work and wins), `migration` 1,000-1,500, `payment_poll` 150, `reconcile` 100, `probe` 50, with a
100-call reserve nobody may touch. The caps are configuration, and the worker reads them rather than
assuming a number. If live posting needs more than 1,000 in a day (a month-end burst), the conversion
pauses — the conversion can wait a day; an invoice cannot.

**Month-end is not optional.** The last three business days of the month and the first two of the next
are conversion-free: posting, reporting and the accountant's own session need the quota, and a bulk
load competing with a close is how a 429 cascade starts. That costs about five days a month and is
already in the worst-case table.

### 4.4 What we will not do

- **Pretend both can run at full speed.** The quota is per company, not per integration. Running the
  conversion at 2,500 while the business invoices is not a scheduling choice; it is a 429 storm.
- **Retry a 422.** A rejected document is a mapping bug. Retrying it spends quota and changes nothing.
- **Skip the search on a retry.** The one call that prevents a duplicate invoice is never the one to
  economise on.
- **Run the load through the month-end close.** See above.
- **Leave progress in a log file.** If the answer to "how far along is it" is not a query, the load
  cannot be managed, only hoped for.

---

## 5. Conversion order

Each step is idempotent, keyed by a natural identifier, and verified before the next begins. The
`run` id ties every artefact to one attempt.

| # | Step | Key | Verification |
|---|---|---|---|
| 0 | **Tenant preparation** (Alliance + platform): fiscal years created and open, chart of accounts, tax rates, currencies, stock settings, ledger accounts | `business_id` | Tenant probe report recorded |
| 1 | **Extract and snapshot** the Sage 50 company read-only; checksum by table | dump id | Row counts and the four money anchors match |
| 2 | **Second-route sample**: 200 documents via SDK/CSV, diffed | dump id | Zero unexplained differences |
| 3 | **Ledger accounts** → `/ledger_accounts` | account number | Every source account mapped or explicitly suspended |
| 4 | **Tax rates** → `/tax_rates` | source tax code + province | Rate and province match; exempt/zero codes tested on one document |
| 5 | **Contacts**: customers, vendors, ship-tos | normalized name + postal/phone | 3,760 customers and ~888 vendor contacts accounted for; duplicates listed |
| 6 | **Items**: parts → products/stock items | item code (part number) | 2,605 items; cost and price fields agree with the extract |
| 7 | **Financial baseline**: signed trial balance, aged A/R and A/P, tax by code and period | snapshot id | Signed by finance and the accountant |
| 8 | **Opening balances and opening GL** at the conversion date | contact id / account | Loaded totals equal the signed baseline, to the cent |
| 9 | **Historical sales documents** in date order (invoices, credit notes) | `s50:sales_invoice:<id>` | Count and total per month match the extract |
| 10 | **Historical purchase documents** (supplier and subcontractor bills, credits) | `s50:purchase_invoice:<id>` | Same |
| 11 | **Payments and allocations** | `s50:payment:<id>` | Aged A/R and A/P after allocation equal the baseline |
| 12 | **Inventory opening** per item at cut-off, plus evidenced movements | item code | Quantity and value agree with the stock report; drift documented |
| 13 | **Attachments** (signatures, scans) where the client wants them in the ledger | document id + hash | Count and spot-check; quota cost recorded |
| 14 | **Final reconciliation and sign-off** (§8), then **lock periods** and retire Sage 50 to read-only | run id | Signed report; no unposted or unexplained documents |

Steps 3-6 are master data and can run while documents are still being extracted. Steps 9-11 are the
long tail and must be resumable in the middle of a month.

**Duplicate prevention is the same mechanism as production posting:** `external_ref` is unique in
`app.sage_postings`, and the worker searches before it creates **on a retry** (§4.1). A resumed load
therefore cannot double-post, and a partially loaded month is a query
(`status in ('queued','retryable','unknown')` filtered by `run_id`), not an investigation.

---

## 6. Chart of accounts, tax codes, and the parts that need a human

### 6.1 Chart of accounts

The legacy chart is Sage 50's chart. Map by account number first, name second, never by guessing:

| Case | Action |
|---|---|
| Same number and name exist in the tenant | Link, no creation |
| Same role, different number | Map explicitly, record the mapping |
| New account needed (e.g. a work-order revenue split) | Create in the tenant, record why |
| No obvious home | Post to a single `Migration suspense` account, list every amount, and require a named person to clear it before sign-off |

The suspense account must net to zero before the conversion is accepted. That is the honest version
of "we mapped everything": anything unmapped is visible, finite and owned.

### 6.2 Tax codes

The legacy writes `ttaxdtl.dRate = 13.0` and `lTaxCode = 16` regardless of province, while the real
amount sits in `titlutot.dTaxAmt`. The ledger computes tax from the rate on each line, so:

- map every source tax code to a tenant tax rate by province;
- validate the three cases that break naive mappings: exempt customers, zero-rated lines, and
  documents whose stored tax does not equal `rate × net` (the legacy defect);
- for the mismatched documents, choose one of two behaviours and record it per document: accept the
  ledger's computed tax and book the difference to suspense, or override the line tax rate to
  reproduce the stored amount. Neither is free; the report must show the total difference.

### 6.3 Contacts and the duplicate problem

The legacy has 3,760 customers, 4,844 sites (shipping addresses) and 1,086 sites whose `custid` points
at no customer. Sage Accounting has contacts with a main address and a delivery address. Therefore:

- one contact per customer; the main address from `tcustomr`, the delivery address from the most-used
  `tcustshp` row;
- additional ship-tos stay in our app (they are operational, not ledger, data);
- the 1,086 orphan sites are not converted as contacts; they remain exceptions with the same owner as
  in `plan/CUTOVER-AND-MIGRATION.md` §5;
- duplicate detection uses the same normalized rules as the master-data module (name plus postal,
  phone or email), so the ledger does not inherit the legacy's duplicate customers.

### 6.4 Inventory

Stock counters in the legacy have drifted. The conversion therefore loads an **opening position per
item dated at cut-off** with cost and quantity, plus the drift report, and only those historical
movements the business can evidence. Replaying years of movements would import the drift as fact and
consume quota the document load needs. If the tenant has stock items disabled, quantities stay in our
app and the ledger receives only quantities that affect cost of sales — decided at tenant probe.

---

## 7. What has no home in the ledger

| Legacy feature | Why it cannot convert | Where it lives instead |
|---|---|---|
| Purchase orders and receipts | No purchase-order endpoint in the accounting API | Our Purchasing module; a PO becomes a bill when invoiced |
| Projects / job costing (`tproject`, project WOs) | No project dimension in Sage Accounting's Canadian edition (confirm in writing with Sage) | Our work orders and reports; `SAGE-CLOUD.md` §1.6 |
| Prior-year journal variants (`tJEntLY*`) | Locked periods; no parallel prior-year journal | Accountant-side adjustment in the current open period, agreed with finance |
| User-defined fields (warranty) | No custom fields | `app` master data |
| Salespeople | No equivalent | `app` |
| Extra ship-to addresses | One delivery address per contact | `app` |
| Quotation documents | Quotes are ours | `app` and PDFs |
| Attachments beyond quota | API call per file | Object storage, linked from our documents |

Each row is a **functional gap the client should see before cutover**, not a technical footnote. The
conversion report lists them with the report or screen that replaces them.

---

## 8. The reconciliation test, and who signs

The conversion passes only when all four hold.

1. **Trial balance.** The signed Sage 50 trial balance at the conversion date versus the tenant's
   trial balance for the same date: every account agrees to the cent, or has a mapped exception that
   nets to zero in suspense.
2. **Aged A/R and A/P.** Signed Sage 50 aged reports versus the tenant's aged reports by contact and
   bucket: exact on totals, and every contact difference explained.
3. **Document population.** For each month in scope: document count and total from the extract versus
   the tenant, with every difference traceable to an exception id. A missing invoice is not a
   rounding difference.
4. **Payment allocation.** Unallocated cash is zero or explicitly owned; no invoice appears unpaid
   when the source shows it settled.

Signers:

| Artefact | Signed by |
|---|---|
| Sage 50 trial balance and aged reports at the conversion date | Finance owner **and** the external accountant/bookkeeper |
| Mapping tables (accounts, tax codes, contacts merge list) | Finance owner |
| Conversion run report: counts, totals, exceptions, suspense balance | Data platform and finance owner |
| Go/no-go for locking periods and retiring Sage 50 | Client sponsor |

The run report is stored with the run id and exported as CSV alongside the signed PDFs, next to the
migration harness's parity report. They answer different questions and are kept together: *the data
moved* and *the money still agrees*.

---

## 9. Data-quality exceptions this conversion inherits

These are measured, and each needs a decision before its documents load.

| Class | Measured | Conversion behaviour | Decision owner |
|---|---|---|---|
| `inv_tax` rows with blank money | ~24,452 of 27,802 | Not converted as tax; the invoice's stored total is preserved with a `tax_missing` exception | Finance |
| Documents whose stored tax ≠ rate × net | unknown until sampled | Per-document behaviour per §6.2, reported with total difference | Finance |
| Customer/site orphans | 18,106 WOs; 1,086 sites | Not converted as contacts; exceptions with the same ids as the app migration | Operations |
| Placeholder work orders (99999999, 44444444, 9999999, 9999998, 0) | 5 known ids | Excluded from conversion with a listed reason; must not become ledger documents | Finance |
| Duplicate customers | follows the master-data duplicate report | Merged before load, with a mapping audit trail | Operations |
| Stock counter drift | per item | Opening position plus drift report (§6.4) | Operations |
| Voided or deleted source documents | unknown until extracted | Never converted as live documents; if they exist in Sage, they are converted as they are (the ledger is the record), and flagged | Finance |

No exception is silently dropped. The rule from the app migration carries over: a row with no
decision is a failed conversion, not a warning.

---

## 10. Failure modes and mitigations

| Failure | Effect if unmitigated | Mitigation |
|---|---|---|
| Quota exhausted mid-month | Load stalls, looks like a failure | Quota class + resumable ledger row per document; stall is a pause, not a loss |
| Duplicate document from a retry | Two invoices for one job in the books | `external_ref` unique + search-before-create; same worker as production |
| Locked period rejects a history load | Whole month fails | Create periods open; lock only after sign-off; test in sandbox first |
| Tax model differs from Sage 50 | Totals drift by cents, then dollars | Sample 200 documents, compare to the cent, decide §6.2 behaviour before bulk load |
| Receipts not enumerated | Every invoice looks unpaid, A/R balloons | Discovery item; the extract must enumerate payment/receipt tables before step 11 is scheduled |
| Schema changes in a Sage 50 release | Extract breaks silently | Second-route sample and checksums catch it; never upgrade Sage 50 during the conversion |
| latin1 and odd encodings | Names and descriptions corrupted | Explicit charset on extraction, byte-level round-trip test on a sample of 100 records |
| Attachments quota | Load slows unexpectedly | Attachments last, optional, costed per file |
| Load runs while the portal is live | Snapshot changes underneath | Freeze the portal's Sage writes during extraction; the snapshot id pins the source |

---

## 11. Acceptance, rehearsal, and what comes next

**Rehearsal, twice:** the whole conversion into a sandbox tenant, timed end to end, with a stop and
resume in the middle of a month to prove idempotency. The second rehearsal must produce identical
counts and totals to the first, and a full reconciliation pass.

**Acceptance criteria:**

- all four checks in §8 pass, signed by the named signers;
- zero `queued`/`unknown` postings for the run;
- suspense nets to zero, or to a signed-off amount with a named clearing owner;
- every exception has a decision and an owner;
- the load was resumed at least once without a duplicate;
- the daily reconciliation (`SAGE-RECONCILIATION.md`) passes in `cutover` mode on the loaded tenant.

**Then, and only then:** lock the converted periods (or the fiscal years they occupy), mark the Sage
50 company read-only, and keep it as the archive of record for anything the ledger cannot represent —
projects, POs, UDFs and the pre-cut-off operational detail.

**Open items that block scheduling, not design:**

1. the posting cut-off date;
2. whether Sage offers an assisted migration or a temporary quota increase (ask before planning the
   API route);
3. the receipt/payment tables in the source schema (discovery step 1);
4. written confirmation from Sage that the Canadian edition has no project dimension;
5. the tenant's chart of accounts, tax rates and stock settings.
