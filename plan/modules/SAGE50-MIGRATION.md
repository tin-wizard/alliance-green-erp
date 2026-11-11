# Sage 50 → Sage Accounting data conversion

**Status:** active workstream, v3. **Date:** 2026-11-11. **Owner:** Data platform, with the finance
owner and Alliance Lighting as the Sage account holder.
**Scope (v3):** **documents only** — sales invoices and purchase invoices — plus a separate
allocation pass whose source is the live Sage 50 company file, not the portal. The portal never
wrote a receipt, payment, credit note or reversal: every payment column it inserts is a literal
zero (`green-system/SAGE50-PAYMENTS.md` §1). Paid state therefore cannot be converted from portal
data, only reconstructed from Sage 50's own receipts and allocations.
**Decisions:** D19 (Sage Business Cloud Accounting), D21 (migrate Sage 50 **including historical
documents**), D22 (Neon stays in Ohio), D23 (Alliance owns the subscription and OAuth consent).
**Relates to:** `green-system/SAGE50-PAYMENTS.md` (the evidence for the scope change),
`plan/modules/SAGE-CLOUD.md` §7 (quota arithmetic, what the API cannot accept),
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

**Scope is narrower than it first looked, in a way that helps.** The portal posted invoices and
nothing else: no receipts, no payments, no credit notes, no reversals — every payment column it
writes is a literal zero (`green-system/SAGE50-PAYMENTS.md` §1). So the conversion is two passes with
different sources: **documents** from the invoice tables, and **allocations** reconstructed from the
live Sage 50 company file, where the staff-entered receipts actually live. The document pass is
quota-bound; the allocation pass is export-bound in its source and API-bound in its write (§4.5).

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
| Receipts, payments, allocations | **not written by the portal** — staff entered them in the Sage 50 UI | Paid state lives only in the live company file; extracted separately (§4.5, §12). Every payment column the portal inserts is a literal zero |
| Credit notes and reversals | **not written by the portal**; any present were created in the UI | Converted as credit-note artefacts plus allocations, never as negative invoices (§3) |
| Projects (`tproject`) | present | No destination in Sage Accounting (see §7) |
| Attachments | signature images and scanned documents on disk | Paths in the portal (`files_mod_signature`), not in Sage |

### 2.3 The five extraction routes, and what each is good for

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
4. **Take a second extract for allocations.** The receipt and payment side is a separate extract
   from the same freeze (§4.5), because it comes from different tables — or from Sage's own receipt
   journal if the VERIFY queries (§12) show those tables are not usable by SQL.
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
| Sales invoices | `POST /sales_invoices` | One request per invoice; `invoice_lines[]` carries the detail. The portal never posted a credit note, so only the invoices it wrote are convertible from it |
| Purchase invoices | `POST /purchase_invoices` | Supplier and subcontractor bills, plus the "adjustment" corrections that are re-posted invoices rather than credit notes |
| **Receipts and vendor payments** | `POST /contact_payments` + `allocated_artefacts` | **Not in the legacy data at all.** Staff entered them in the Sage 50 UI. They must be extracted from the live company file and re-posted as a separate pass (§4.5) |
| **Credit notes, prepayments, reversals** | `POST /sales_credit_notes` / `purchase_credit_notes`, then `/contact_allocations` | The portal never wrote any of these. If the live Sage 50 file contains them, they are UI-created and must be extracted and converted explicitly — a negative invoice is not an invoice |
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
| **API load by us** | ~6 weeks exclusive, ~11 weeks shared (§4.1) | Default if Sage offers no assistance. Must be resumable and quota-budgeted |
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
| Sales invoices | ~40,000 | 1.05 | ~42,000 |
| Purchase invoices | ~8,000 | 1.05 | ~8,400 |
| Stock items and evidenced movements | ~12,600 | 1.0 | ~12,600 |
| Contacts, products, tax rates, ledger accounts | ~8,000 | 1.0 | ~8,000 |
| Verification reads and reconciliation passes | — | — | ~12,000 |
| **Subtotal** | | | **~83,000** |
| Retry and 429 allowance (+15%) | | | **~95,000** |

The scope change from `SAGE50-PAYMENTS.md` removes ~50,000 calls: the portal never posted a payment,
so there is nothing payment-shaped to convert from its data. The allocation pass is sized separately
in §4.5 because its source is different.

**Calendar, document pass only:**

| Scenario | Calls/day for the conversion | Days | Weeks |
|---|---:|---:|---:|
| Exclusive — conversion before go-live, nothing else posting | 2,500 | ~38 | **~5.5** |
| With 500 reserved for polling and reconciliation | 2,000 | ~48 | ~7 |
| Shared 50/50 with live invoice posting | 1,250 | ~76 | **~11** |
| Shared with month-end freezes (5 days a month at zero) | ~2,100 effective | ~46 | ~6.5 |

So the document conversion is **six weeks if it owns the quota, eleven if the business is also
invoicing through the new system**, and the allocation pass adds a few days on top (§4.5) rather than
a few weeks. That is the range the cutover date has to live inside.

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
   six weeks for documents plus a few days for allocations; the new system's first invoice posts
   afterwards. Cleanest reconciliation story, longest calendar. **Recommended if the client can
   wait.**
2. **Interleaved — go live, convert at the edges.** Live posting gets first claim on the quota, the
   conversion takes the remainder (about 1,250 a day, ~11 weeks), and the conversion is suspended
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

### 4.5 The allocation pass: export-bound source, API-bound write

The portal never posted a receipt, a payment or a credit note. Every payment-shaped column it
inserts is a literal zero, and `bReversed` is only ever read
(`green-system/SAGE50-PAYMENTS.md` §1). Staff entered receipts and payments directly in Sage 50's
UI. So paid state does not exist in the legacy database at all — it exists only in the live Sage 50
company file, and only as receipts plus the allocations that point them at invoices.

**Source: export-bound.** The pass starts from the live Sage 50 company file, not from
`alliance_db`. Extract, at the same freeze as the document extract:

- the receipt/payment transactions (transaction type, contact, date, amount, reference, bank or
  cheque id if present);
- the allocation detail that says which invoice each amount settles and how much;
- any customer or vendor credit note the UI created — the portal created none, so anything here is
  UI-originated and must be converted as a credit-note artefact, not as a negative invoice.

Which table those live in is exactly what the VERIFY queries in §12 settle. If the extract cannot
identify them by SQL, fall back to Sage 50's own receipt journal and aged-detail reports exported by
the bookkeeper — slower, but signed by the person who owns the numbers.

**Write: API-bound by default.** One `POST /contact_payments` per receipt, with its allocations
inline in `allocated_artefacts` (one entry per invoice it settles; a partial payment is several
entries, not several payments), and `POST /contact_allocations` only where a credit note has to net
against an invoice. Cost is about 1.1 calls per receipt, so with *R* receipts the pass is
`R × 1.1 / 2,500` days on exclusive quota: 25,000 receipts is ~11 days, 10,000 is ~4.5 days. The
receipt count is unknown until the export, which is why it is not in the §4.1 table.

**Why not opening balances instead.** An opening balance per contact is a lump sum. It makes the A/R
total correct while leaving every historical invoice `unpaid`, so the aging by invoice is wrong and
any later allocation has nothing to attach to. It is defensible only if the client explicitly wants
balance-level correctness and accepts that invoice-level paid state is unavailable in the new
ledger — recorded as an option with that consequence, never as a silent shortcut.

**Recommendation:** run the allocation pass in the same window, immediately after the documents,
under the same resumable machinery with `run.kind = 'allocations'`. It is **export-bound for
correctness and API-bound for the write**; the API cost is small next to the documents, and the
alternative misstates the number the business looks at every day — which customer owes what.

**Acceptance for this pass:** for every converted invoice, read back
`GET /sales_invoices/{id}?show_payments_allocations=true` and compare `outstanding_amount` and the
`payments_allocations[]` entries against the source extract, invoice by invoice. A payment that
exists without an allocation, or an allocation whose amount does not sum to the source, fails the
pass. Then the aged A/R and A/P totals in §8 must agree with the signed Sage 50 reports.

---

## 5. Conversion order

The conversion runs as **two passes with different sources**. Steps 1-10 are the **document pass**:
invoices from the source tables, written through the API, quota-bound. Step 11 is the **allocation
pass**: receipts and their allocations from the live Sage 50 company file, export-bound for the
source and API-bound for the write (§4.5). They share the run ledger and the resumable worker, so a
pause in either is a row, not a mystery.

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
| 9 | **Document pass — historical sales invoices** in date order | `s50:sales_invoice:<id>` | Count and total per month match the extract |
| 10 | **Document pass — historical purchase invoices** (bills and the re-posted "adjustment" invoices) | `s50:purchase_invoice:<id>` | Same |
| 11 | **Allocation pass — receipts, vendor payments and any UI-created credit notes**, from the live Sage 50 extract (§4.5), as its own run | `s50:payment:<id>`, `s50:credit_note:<id>` | Per-invoice outstanding and allocated amounts match the extract; aged totals match §8 |
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

### 6.5 Legacy tax quirks that will not be reproduced

These are defects in the legacy posting code, documented in `green-system/SAGE50-PAYMENTS.md` §4.
The conversion does not carry them into the new ledger, and the reconciliation must **tolerate the
resulting differences** rather than treat them as conversion failures. Each is a known, signed
divergence.

| Quirk | What the legacy did | What the conversion does | Reconciliation consequence |
|---|---|---|---|
| Hard-coded 13% on local lines | Part, labour and special-order lines compute `sum × 0.13` and write `lTaxAuth = 3` regardless of province (`functions.php:622,704,768,648`) | The line gets the tenant's real tax rate for the province/region | On a 5% or 15% document, the converted tax differs from the posted Sage 50 tax. Tolerance: the per-document difference is recorded as an accepted divergence with its amount, and the total is reported |
| `salesHeadLocal` dies on zero tax | Header tax is derived as `total − subtotal`; a genuinely tax-free invoice cannot be posted at all (`functions.php:809-810`) | A zero-tax invoice converts normally, with an exempt/zero-rate tax code | New documents of this kind will exist in the cloud ledger where none exist in Sage 50; they are additions, not differences |
| `ttaxdtl.dRate` always `13.0` | Sales tax detail wrote rate 13 and authority 1 even for 5%, 14%, 15% documents (`functions.php:946`) | Rate and authority come from the tenant's tax rate per line | Any reconciliation that groups by the source `dRate` column is meaningless; group by the document's province and the tenant's rate id instead |
| Purchase rate splitting | `purchHeadSub` bills BC parts at 5% + 7% PST while `subSalesLab` bills BC labour at a flat 5% (`functions.php:1006-1007,1227`) | One rate per line as configured in the tenant, per line type | Multi-authority documents can differ by a few cents; accepted and reported per document |
| One hard-coded cent correction | `if ($woidd == 73850 && $totaltax == '13262.85') $totaltax -= 0.01` (`ajaxCalcTotalSubProjectWo.php:303-309`) | Not reproduced | A one-cent difference on one historical document. The reconciliation must not "fix" it back |

The rule for all five: **the source amount is evidence, not a target.** Where the legacy's arithmetic
and the ledger's arithmetic disagree, the document converts with the ledger's arithmetic, the
difference is recorded with its cause, and the total of those differences is part of the sign-off.
Silently reproducing a 13% rate on a 5% invoice would put a wrong number in a tax return; silently
dropping the difference would hide it.

### 6.6 Bank accounts: a required human input

The legacy data contains **no bank account reference anywhere**: `lBnkAcctId = 0` and `lChqId = 0`
on every transaction line, and no payment rows at all
(`green-system/SAGE50-PAYMENTS.md` §1, §7). So a `bank_account_id` cannot be derived, mapped or
guessed. It must be chosen.

The recommendation is that **Alliance Lighting's bookkeeper maps each payment stream to a real bank
account that exists in the Sage Accounting tenant** — customer receipts to the deposit account the
money actually lands in, vendor payments to the account it leaves from, and card settlements to the
clearing account, if one exists. We do not invent accounts, and we do not use a generic "Migrated
payments" account unless the bookkeeper explicitly asks for one as a temporary holding place.

Required from the bookkeeper before the allocation pass:

1. the list of bank accounts in the tenant, with which one receives customer payments and which pays
   vendors;
2. whether more than one deposit account was used historically, and if so which periods or customer
   groups map to which;
3. the treatment for any receipt whose bank account cannot be determined — parked in a named clearing
   account or excluded with a list, their call;
4. who signs off that the mapping is complete (the same person who signs the aged reports).

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
| Receipt and payment **bank-account identity** | The source has none (`lBnkAcctId = 0`, `lChqId = 0`) | Chosen by the bookkeeper against the tenant's real accounts (§6.6) |
| Unapplied cash and prepayments | The portal wrote `bPrePaid=0`, `lPPId=0`, `dPrePAmt=0`; whatever exists was UI-entered | Converted as unallocated `contact_payments` if present in the live extract, otherwise nothing to carry |
| Reversals (`bReversed=1`) | The portal only ever read it; reversals happened in the Sage UI | Detected in the live extract as reversed/voided, converted as a void or a credit note, never as a silent omission |

Each row is a **functional gap the client should see before cutover**, not a technical footnote. The
conversion report lists them with the report or screen that replaces them.

---

## 8. The reconciliation test, and who signs

The conversion passes only when all five hold.

1. **Trial balance.** The signed Sage 50 trial balance at the conversion date versus the tenant's
   trial balance for the same date: every account agrees to the cent, or has a mapped exception that
   nets to zero in suspense.
2. **Aged A/R and A/P.** Signed Sage 50 aged reports versus the tenant's aged reports by contact and
   bucket: exact on totals, and every contact difference explained.
3. **Document population.** For each month in scope: document count and total from the extract versus
   the tenant, with every difference traceable to an exception id. A missing invoice is not a
   rounding difference.
4. **Payment allocation.** For every invoice the source shows settled: the tenant shows a
   `payments_allocations[]` entry, the outstanding amount is zero, and the sum of allocations equals
   the source amount. Unallocated cash is zero or explicitly owned by a named person.
5. **Tax divergences.** Every document whose converted tax differs from the source (the §6.5 quirks)
   appears in the divergence report with its cause and amount, and the report total is signed.

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
| Receipts and allocations not extracted | Every invoice looks unpaid, so the ageing is wrong even when the trial balance agrees | The live-extract pass in §4.5; the VERIFY checklist in §12 runs before it is scheduled |
| Allocation amounts disagree with invoices | A partial payment recorded as full, or double-allocated | Per-invoice comparison in §8.4; the pass fails rather than posting a plausible number |
| Bank account invented to keep moving | Payments land in an account the bookkeeper never reconciles | §6.6: the mapping is a required input, not a default |
| Credit note converted as a negative invoice | It never nets, so both sides stay open | UI-created credits are converted as credit-note artefacts plus allocations (§3) |
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

- all five checks in §8 pass, signed by the named signers;
- zero `queued`/`unknown` postings for either run;
- suspense nets to zero, or to a signed-off amount with a named clearing owner;
- every exception has a decision and an owner, and the tax-divergence report is signed;
- the allocation pass was accepted invoice by invoice, not only in total;
- the load was resumed at least once without a duplicate;
- the daily reconciliation (`SAGE-RECONCILIATION.md`) passes in `cutover` mode on the loaded tenant.

**Then, and only then:** lock the converted periods (or the fiscal years they occupy), mark the Sage
50 company read-only, and keep it as the archive of record for anything the ledger cannot represent —
projects, POs, UDFs and the pre-cut-off operational detail.

**Open items that block scheduling, not design:**

1. the posting cut-off date;
2. whether Sage offers an assisted migration or a temporary quota increase (ask before planning the
   API route);
3. the three live-file VERIFY queries (§12) and the resulting receipt/allocation export;
4. the bank-account mapping, from Alliance Lighting's bookkeeper (§6.6);
5. written confirmation from Sage that the Canadian edition has no project dimension;
6. the tenant's chart of accounts, tax rates and stock settings.

---

## 12. Pre-cutover VERIFY checklist (live Sage 50, read-only)

Three queries, run once against the live company file with the portal's Sage writes stopped, settle
everything the archive and the code cannot. `green-system/SAGE50-PAYMENTS.md` §3 and §8 list them;
they are repeated here because they gate the allocation pass and therefore the cutover date.

**1. Transaction-type histogram — does a receipt live in the same table as an invoice?**

```sql
SELECT nTranType, COUNT(*), MIN(dtDate), MAX(dtDate)
FROM   tcustrdt
GROUP  BY nTranType;
```

*Why it matters:* the portal only ever wrote `nTranType = 0`. If other values exist, receipts are
stored in the same subledger detail table under a different type, and the allocation extract can be
built from SQL. If the count is one row of zeros, receipts live elsewhere and the fallback is the
Sage 50 receipt journal exported by the bookkeeper.

**2. Journal histogram — how many journal kinds does the ledger actually contain?**

```sql
SELECT nJournal, COUNT(*), MIN(dtASDate), MAX(dtASDate)
FROM   titrec
GROUP  BY nJournal;
```

*Why it matters:* the portal writes only 8 (sales) and 7 (purchase). Any other `nJournal` value is
a document the UI created — a receipt, a payment, a credit note or a reversal. Those are precisely
the artefacts the allocation pass must carry, and their count sizes the pass (§4.5). It also tells us
whether the "every payment column is zero" finding holds for *all* rows or only for portal-created
ones.

**3. Full counter map — which document tables exist at all?**

```sql
SELECT lId, lNextId FROM tNxtPIds ORDER BY lId;
```

*Why it matters:* `tNxtPIds` names every table that receives documents. Any `lId` the legacy code
never touches (`30, 43, 44, 53, 54, 100, 103, 126, 150` are the known ones) is a table populated only
by hand — the receipts, payments and credit notes. It is the map of what the portal never wrote and
the conversion must reconstruct.

**Also blocking, from the same sitting:** compare `tcustrdt.dAmtOwg` for invoices staff know are
unpaid against ones they know are paid (`SAGE50-PAYMENTS.md` §3). The portal writes `0.0` on every
invoice (`functions.php:911`), so either the column means "owing at transaction time" and the ageing
ignores it, or the portal has been creating settled invoices for years. The answer changes how the
source ageing is read, and it must be recorded before the baseline is signed.

**Outcome recorded as:** a one-page result note with the three histograms, the `dAmtOwg` sample, the
receipt/document counts that follow, and the updated allocation-pass estimate. It is signed by the
person who ran it and filed with the conversion run report.
