# Sage integration on cloud APIs

**Status:** draft for decision. **Date:** 2026-11-11. **Owner:** Platform, with the finance owner.
**Supersedes:** the MySQL implementation in ADR 0005 (`simply` schema, ports 13540-13544).
**Driven by:** `plan/REBUILD-PLAN.md` D18 — the rebuild runs in the cloud and targets a Sage cloud
API. `plan/CUTOVER-AND-MIGRATION.md` §3.6 and §4.4 carry the cutover consequences.
**Repo target:** `packages/sage/` keeps the adapter boundary; only the implementation changes.

---

## 1. Which "Sage Cloud" this is — not yet answered

"Sage Cloud" is not one product. Three candidates are in play for this business, and they are not
variations of each other: different data models, different APIs, different migration paths, and
different answers to "can it hold our history". The plan cannot pick one on the human's behalf,
because the choice changes the accounting product the company runs, not just an integration.

### 1.1 The candidates

| | **Sage Business Cloud Accounting** (a.k.a. Sage Accounting, formerly Sage One) | **Sage 50cloud / Sage 50 Cloud** | **Sage Intacct** |
|---|---|---|---|
| What it is | Cloud-native SMB ledger, multi-country incl. Canada | The existing desktop Sage 50, either local or hosted by Sage on Azure | Mid-market cloud ERP/finance |
| API | REST v3.1, JSON, OAuth 2.0 | **No REST API.** Sage 50 US/Canada ship a .NET SDK that must run on a 32-bit Windows machine beside Sage 50; UK/Ireland use Sage Data Objects (COM). Sage's own UK FAQ states there is no RESTful API for Sage 50 | XML web services (long-standing) plus a newer REST API; OAuth 2.0, performance tiers |
| Auth | Authorisation-code flow only. **No client-credentials/daemon flow**; access token 5 minutes; refresh token rotates on every use and expires after 31 days idle | N/A — machine-local session, application ID, user approval of the app against the company | OAuth 2.0, entity-scoped |
| Limits | 2,500 requests/day **per company**, 100/min, 200 records/page, no bulk endpoint, no webhooks | N/A | Higher volume tiers; concurrency limits per tier |
| Feature fit for this business | Invoices, bills, credit notes, quick entries, contacts, journals, ledger accounts, tax rates, **stock items and stock movements**, opening balances, attachments. **No purchase-order endpoint in the reference sections reviewed** — POs stay in our app and become bills on invoicing. No project/job costing like Sage 50 projects | Everything the legacy uses today, because it *is* the legacy product. No cloud write path without a Windows agent | Strong dimensions (projects, departments, locations), multi-entity, approvals, high volume |
| Migration from the current Sage 50 CA company | Real product migration. Opening balances and contacts load by API; per-document history is a conversion project, not a sync | None needed — same product | Real product migration, larger scope and cost |
| Effort in this rebuild | Adapter reimplementation + OAuth + posting outbox + reconciliation | A Windows agent plus a sync service. This is the option D18 rules out | Adapter + dimension mapping + higher integration complexity |

**What is verified (2026-11-11):** the Sage Accounting API v3.1 reference lists contacts, sales and
purchase invoices/credit notes/quick entries, journals, ledger accounts, products, services, stock
items, stock movements, contact payments and allocations, tax rates, opening balances and
attachments; Canada appears explicitly (`tax_address_region_id`, "Canada only"); token lifetimes and
per-company quotas are documented as above; Sage 50 is documented as SDK-only per region.

**What is not verified and must not be assumed:** that the API's purchase-order surface exists in
any region (none appeared in the purchase reference); that Canadian stock items and stock movements
are enabled on the tenant the company would buy; that the tenant supports the invoice volume and
date range this business posts; and whether historical inventory movement can be loaded at all.

### 1.2 Questions the human must answer before implementation starts

These are blocking. Each one changes code, cost, or the cutover date.

1. **Which product is the accounting system of record after cutover** — Sage Business Cloud
   Accounting, a hosted Sage 50 (in which case D18's "cloud API" cannot mean an HTTP API and the
   plan needs a different integration shape), or Sage Intacct? If the company has already bought,
   licensed or trialled one, that decides it.
2. **Is Sage 50 being retired, or kept for history?** The recommendation is: Sage 50 becomes a
   read-only archive at the opening-balance date, and the cloud ledger holds the opening position
   plus everything posted afterwards. Confirm finance accepts that, because it is the single
   biggest scope lever in this document.
3. **Does finance need per-document history in the cloud product**, or is an opening balance plus
   an exportable Sage 50 archive enough? Per-document history converts this from an integration
   into a data conversion of 71,087 invoice lines and 45,087 work-order part rows against a product
   whose tax and inventory models differ.
4. **Who owns the Sage subscription and the API application?** OAuth requires a human at a browser
   to authorise, and a refresh token that must stay alive. That person, and the shared mailbox the
   token lives behind, must be named.
5. **Which legal entity and country does the tenant use**, and does its chart of accounts, tax
   codes and inventory setup already exist, or must we create them?
6. **What is the posting cut-off date**, and who signs the opening-balance snapshot?
7. **Data residency:** must accounting data stay in Canada? It changes both the Sage product
   available and the hosting region (ADR 0014).
8. **Does the business still need Sage 50 projects** (project work orders in the legacy post to a
   Sage project)? Sage Accounting has no equivalent; if projects are load-bearing, that is a
   functional gap the app has to absorb or the product choice has to change.

Until 1, 2 and 3 are answered, everything below is a design that holds for a cloud accounting API
with invoices, contacts, journals, tax rates and opening balances — which all three candidates
except hosted Sage 50 have, in some form.

---

## 2. What the legacy actually writes, and where each write goes

The legacy surface is documented in `green-system/MODULES.md` §11.3-11.4 and implemented in
`functions.php` (`salesHeadLocal`, `localSalesPart`, `purchSub…`) and
`sageimport_local_submit.php`. It is a hand-built imitation of Sage 50's internal tables. Every row
below is a write the rebuild must replace, drop, or absorb.

| Legacy write | What it contained | Cloud API equivalent | Verdict |
|---|---|---|---|
| `tcustr` | sales-invoice header, `nTranType = 0`, `sSource = woid` | `POST /sales_invoices` with `contact_id`, `date`, `reference`, `invoice_lines[]` | **Mapped.** `sSource` becomes our external reference and the idempotency key |
| `tcustrdt` | one detail line, `dAmount` = line total | `invoice_lines[]` (`quantity`, `unit_price`, `tax_rate_id`, `discount_amount`, `description`) | **Mapped, semantics change:** the API computes amounts from lines, so our operator-authoritative total must be reproduced by line values, not sent as a total |
| `titrec` | invoice tracking: journal number, shipped-by, totals | none — the API assigns the transaction and journal identity | **Dropped.** We store the returned id and our own posting record |
| `titlutot` | invoice tax totals, `dTaxAmt` | derived: `tax_analysis` / `detailed_tax_analysis` in the response | **Dropped as a write; kept as our stored snapshot** for the invoice PDF |
| `titlu` | invoice header: addresses, PO number, project id, freight | `sales_invoice.reference`, `notes`, contact and delivery address | **Mapped with loss.** The PO number and our WO/project code travel in `reference`/`notes`; there is no project field |
| `titluli` | invoice lines: parts, labour, special parts | `invoice_lines[]`, `product_id` or `service_id` per line | **Mapped** |
| `titrline` | inventory tracking lines per invoice | none when the product is a stock item (the API moves stock itself); otherwise `POST /stock_movements` | **Dropped or mapped per tenant setup** — confirm stock tracking is enabled |
| `tinvext` | inventory extension and per-line costing | `stock_items.cost_price`, `stock_movements.cost_price` | **Dropped as a separate write** |
| `tinvbyln` | last invoice price written back to the item | none — last price is our data | **Dropped.** `packages/pricing` already owns price history |
| `tJourent` | journal header (`nModule = 2`, `nType = 1`) | `POST /journals` (double-entry lines) | **Mapped** for adjustments, opening positions and non-invoice GL |
| `ttaxdtl` | tax detail with hard-coded `dRate = 13.0`, `lTaxCode = 16` | `tax_rate_id` per line; tax computed by the tenant's rates | **Dropped.** The hard-coded rate is the documented tax defect; the API cannot reproduce it, and must not |
| `tventr`, `tventrdt` | purchase (supplier/subcontractor) invoice header and lines | `POST /purchase_invoices` with vendor `contact_id` and `invoice_lines[]` | **Mapped.** Purchase orders are not in the API surface; POs stay in our app and become a bill when invoiced |
| `tJEntLY*`, `tJEntLYA`, `tJEntLYP` | prior-fiscal-year journal variants | none. A cloud ledger has locked periods, not a parallel prior-year journal | **Dropped.** Late prior-year entries become an accountant-side adjustment — a process change to confirm |
| `tNxtPIds` | next-primary-key counters (43, 44, 53, 54, 100, 103, 126, 150) | none. API ids are opaque strings | **Dropped.** Idempotency moves to our external reference plus a lookup before retry |
| `tcustomr.dAmtYtd` | customer year-to-date amount, read and rewritten | none. The ledger computes balances, and `/contacts` exposes the outstanding position | **Dropped.** `packages/sage` reads balances instead of maintaining them |
| `tvendor` id 663 `SagePort` | sentinel row used for port discovery | none | **Dropped.** No listener, no probe |
| Reads: `tcustomr`, `tcustshp`, `tcusudf` | customers, ship-to addresses, warranty UDFs | `/contacts` and contact addresses; warranty becomes our field | **Mapped**, with warranty moving into `app` |
| Reads: `tinvent`, `tinvbyln` | items, quantity on hand, last price | `/products`, `/stock_items` (`quantity_in_stock`, `cost_price`, `sales_prices`) | **Mapped** |
| Reads: `ttaxcode`, `taccount`, `tproject`, `temp` | tax codes, GL accounts, projects, salespeople | `/tax_rates`, `/ledger_accounts`; projects and salespeople have no equivalent | **Mapped** for tax and GL; **dropped** for projects/salespeople, which the app owns |

Two consequences worth stating plainly:

- **Operator-authoritative totals survive as our data, not as the API's.** We keep the stored
  invoice snapshot and PDF exactly as the legacy does (BUSINESS-RULES MUST #1). What we no longer
  control is the ledger's own arithmetic: if a line set cannot reproduce our total to the cent, we
  add an explicit rounding line and record why, rather than letting the ledger disagree silently.
- **The tax defect disappears by construction.** The legacy writes 13% into `ttaxdtl` regardless of
  province and carries the real amount in `titlutot`. A cloud ledger computes tax from the rate on
  each line, so the mapping must select the correct rate per province and validate the returned
  exemption/tax zero cases. This is a behaviour change for the better, and it must be listed as an
  accepted divergence in the migration exception report.

---

## 3. Architecture of the replacement

The boundary from ADR 0005 stays. `packages/sage` exposes the same `SageAdapter` methods, and the
modules still know nothing about Sage transport.

```
module (invoicing, purchasing, master data)
   │  create document + enqueue a posting request (same DB transaction)
   ▼
app.sage_postings            (outbox: external_ref, doc type, payload, status, attempts)
   │  worker: claim → render request → call API → record result
   ▼
@cls/sage  ── OAuth token service (encrypted refresh token, serialized refresh)
   │
   ▼
Sage cloud API (HTTPS)
   │  responses and read-back (payments, balances, deletions)
   ▼
app.sage_links               (external_ref ↔ API id, one row per document, unique)
```

1. **The outbox is the only path to Sage.** No server function calls the API inline. A document and
   its posting request commit together, so a crash cannot lose the intent, and a slow or failing
   Sage never blocks the operator's save.
2. **`external_ref` is the contract.** Format: `cls:<docType>:<ourId>:<attempt-independent>`.
   Unique index in our database, unique by construction in the payload, and the thing every retry
   and reconciliation keys on. It is stored in the reference/notes field the API allows.
3. **`app.sage_links` is one row per document, never two.** A unique constraint on
   `(doc_type, our_id)` is what prevents the double-post that the legacy prevented with
   `tcustr.sSource`. `app.sage_postings` records attempts; `sage_links` records the outcome.
4. **Direction is fixed per field.** Ledger-owned (read-only for us): balances, payment state,
   transaction ids, tax totals, journal ids. App-owned (we may push): contacts and their addresses,
   products/stock items, invoice and bill documents, journals, opening balances. Nothing is
   written by both directions; a field that changes in Sage that we also hold is a conflict, and it
   is recorded, not merged silently.
5. **Reads are incremental.** There are no webhooks, so every poll uses `updated_or_created_since`
   with the last successful watermark, plus `deleted_since` for cancellations. A watermark is
   committed only after the batch is applied — the same ownership rule the migration harness uses.

---

## 4. Authentication and credential custody

The API has no client-credentials flow, so there is always a human in the loop at least once, and
the integration must stay alive afterwards.

- **One OAuth application per environment** (dev, staging, production), registered with the exact
  HTTPS redirect URI of that environment. A shared application across environments is a token
  mixer.
- **Authorise once, in production, by a named person** holding the Sage subscription. Store
  `state` and verify it on the callback; reject any callback with a missing or mismatched state.
- **Access tokens live ~5 minutes.** Refresh proactively at four minutes, and never cache longer.
- **Refresh tokens rotate on every use** and die after 31 days idle. Refresh operations are
  serialised with a Postgres advisory lock, and the new token is written **before** the response is
  used. A crash between "Sage rotated" and "we stored it" permanently disconnects the tenant and
  requires another human authorisation — so the write is one transaction, and a failure there
  raises an alarm rather than retrying with the old token.
- **A daily keep-alive refresh** prevents the 31-day expiry, and failure of the keep-alive is a
  health degradation, visible on the dashboard, before it becomes an outage.
- **Custody:** the refresh token is encrypted at rest with a key held in the platform secret store
  (not in the database), or held entirely in the platform store with the database keeping only a
  pointer and a fingerprint. A token never appears in logs, error messages, API responses, or the
  client bundle.
- **`X-Business` header** is resolved once from `GET /businesses`, stored with the connection, and
  sent on every call. A tenant with two businesses must select explicitly; defaulting to the "lead"
  business is how postings land in the wrong set of books.
- **Disconnect and rotate** are first-class operations: revoke at Sage, delete the stored token,
  mark the connection `disabled`, and leave the posting outbox intact so nothing is lost.

---

## 5. Retries, idempotency and quota

The API is HTTP with no documented idempotency-key header (confirm against the OpenAPI spec before
building). Retrying a POST blindly is how duplicates enter an accounting system, so the policy is
search-then-create.

1. **Before creating**, search for the external reference. If a document with it exists, link it
   and stop; that is the recovery path after a timeout.
2. **On create**, store the request payload hash and the response id in the same transaction that
   marks the posting `sent`.
3. **On timeout or 5xx**, do not retry immediately: mark `unknown`, run the search on the next
   attempt, and only create if the search is definitively empty. A document that stays `unknown`
   after two searches goes to a human queue.
4. **On 429**, honour `Retry-After`, then exponential backoff with jitter (1 m, 5 m, 15 m, 1 h, 4 h).
5. **On 422**, stop. A validation failure is a data problem, and retrying it burns quota.
6. **On 401**, refresh once and retry once. Two 401s in a row mean the token is dead: mark the
   connection `unverified`, alert, and stop posting until a human authorises again.
7. **Budget before sending.** Daily counters per endpoint class are checked before every call; when
   the posting budget is nearly exhausted, the worker stops and alerts rather than failing
   randomly halfway through a batch.

### Quota plan (Sage Accounting v3.1: 2,500/day, 100/min, per company)

| Class | Calls/day at a normal volume | Notes |
|---|---:|---|
| Invoice posting (search + create) | ~80 | 40 invoices/day worst case |
| Bill posting | ~20 | subcontractor and supplier invoices |
| Journals and adjustments | ~10 | |
| Contact and product sync | ~20 | incremental only |
| Payment and balance polling | ~120 | every 15 min in business hours, paged |
| Reconciliation reports | ~20 | |
| **Routine total** | **~270** | ~11% of the daily quota |

A full resync (3,760 contacts, 2,605 products, 42,258 invoices) is 300-600 calls and must be
scheduled with its own budget, never run ad hoc during a posting window. The quota is shared with
every other application on the same company, including whatever the accountant uses, so the guard
is a hard stop with an alert, not a warning.

---

## 6. When Sage is unreachable

The legacy's behaviour is the thing not to reproduce: `db_conn.php` includes
`under_maintenance.php` and the whole portal dies. Under a cloud API, Sage is a dependency of
posting, not of operating.

| Situation | Behaviour |
|---|---|
| API slow or 5xx | Document saves normally; posting row stays `queued`; UI shows "Posting pending"; retry with backoff |
| Token expired | Refresh; if refresh fails, documents keep queueing and the connection shows `unverified` |
| Quota exhausted | Posting stops at the budget guard, queue preserves order, alert fires, no data loss |
| Tenant misconfigured (missing tax rate, ledger account) | Posting fails `422`, lands in the exception queue with the field named, operator fixes the mapping and retries |
| Sage subscription lapses | Everything operational keeps working; posting is visibly blocked; finance is told, not discovering it at month end |

Posting order per document is preserved by the outbox, because bills and credit notes that depend
on an invoice must not overtake it. Cross-document order is per record, not global.

---

## 7. What happens to the history that only exists in Sage 50

This is the question the API cannot answer for us. Three options, in ascending cost:

1. **Archive plus opening balances (recommended).** At the cut-off date, take Sage 50's own reports
   (aged receivables, aged payables, trial balance, tax by code and period), sign them, load opening
   balances through `/opening_balances` and opening GL positions through `/journals`, and keep the
   Sage 50 company file as a read-only archive forever. Everything after the cut-off is posted by
   the rebuild. Cost: days, not months. Consequence: the cloud product's history starts at the
   cut-off date, and anyone needing an old invoice opens the archive or our own `app` tables, which
   already hold every invoice we migrated.
2. **Opening balances plus reissued documents on demand.** Same as 1, but specific open documents
   (unpaid invoices, outstanding credits) are re-created in the cloud ledger so collections work
   there. This is usually what finance actually wants: the balances must be collectable, not merely
   correct. Adds a reconciliation per reissued document.
3. **Full historical conversion.** Every invoice and bill since inception becomes a cloud document.
   Against a product with different tax handling, no project costing and possibly no historical
   inventory movement, this is a conversion project with its own acceptance criteria. It should be
   chosen deliberately, with a budget, not as an implied part of "migrate the data".

The rebuild's own `app` tables hold the operational history either way — work orders, quotes, POs,
invoice snapshots, stock ledger — because that history is the business's, not the ledger's. The Sage
question is only about the accounting ledger.

Two technical details for whichever option is chosen:

- **Inventory opening is not a historical replay.** Stock counters in the legacy have drifted (see
  `plan/CUTOVER-AND-MIGRATION.md` §5). The cloud product receives an opening stock position per
  item, dated at cut-off, with the drift report attached. Reconstructing years of movements would
  import the drift as fact.
- **`migrated` / `source_guid` / external references must be set** on every loaded record, so a
  re-run updates rather than duplicates. This is the same rule as the migration harness: the
  second run is a no-op.

---

## 8. Reconciliation with the ledger

Reconciliation is now a permanent job, not a cutover ceremony. It answers three questions daily:

1. **Does every document we consider posted exist exactly once in Sage?** Left join
   `app.sage_postings` to `app.sage_links`, count documents with no link, more than one link, or a
   link whose read-back amount differs from our snapshot. Non-zero is an alert, not a report.
2. **Does the ledger's balance agree with our own ledger view?** Per customer: opening balance plus
   invoices minus payments equals `/contacts` outstanding. Per period: invoice totals and tax by
   rate. Differences are investigated to the cent before month end, because a difference found late
   is a difference with interest.
3. **Did anything change in Sage that we did not cause?** Poll `updated_or_created_since` and
   `deleted_since`; a payment allocated by the accountant, a credit note, or a deletion appears as a
   read-side event and updates our view. A deletion of a document we posted is escalated, never
   mirrored blindly.

The reconciliation output is stored as a run report with counts and totals, and it is what the
finance owner signs — the same artefact shape as the migration parity run.

---

## 9. What this design deliberately does not do

- **No purchase-order sync.** The purchase reference exposes bills, credit notes and quick entries,
  not purchase orders. POs live in our app; a bill is created in Sage when a PO is invoiced. If the
  chosen product does expose POs, we revisit, but the app remains the system of record for
  purchasing either way.
- **No quote sync.** Quotes are ours, with our numbering and our PDF; the ledger never sees a quote.
- **No project costing in the ledger.** Sage 50 projects do not exist in Sage Accounting. Work-order
  and project profitability stays in our reports.
- **No webhooks, no bulk, no client credentials.** We poll, we post one document at a time, and a
  human authorises the tenant.
- **No secrets in the repository or in the client bundle.** Consumer key, consumer secret, refresh
  token and encrypting key live in the platform secret store.
- **No second writer.** Exactly one environment holds the active token pair for the company. A
  developer testing against a production tenant is the modern version of two writers on one
  database.

---

## 10. Implementation sequence, once §1.2 is answered

| Phase | Work | Done when |
|---|---|---|
| S0 | Answer §1.2; pick the product and the tenant; record the decision as a new ADR that supersedes ADR 0005's implementation | A named tenant exists and a test invoice can be posted by hand |
| S1 | OAuth connection: authorise, store encrypted token, refresh under a lock, keep-alive, health states, disconnect | A scheduled keep-alive survives a week; health reports `verified` |
| S2 | Entity sync: contacts, products/stock items, tax rates, ledger accounts; `sage_links` for each | Re-running the sync twice changes nothing |
| S3 | Sales invoice posting with `external_ref`, search-before-create, idempotent retry, link table | Posted invoice reconciles to the cent; a forced timeout does not duplicate |
| S4 | Purchase invoice posting, credit notes, journals, opening balances | A cutover rehearsal loads opening balances into a scratch tenant twice with one result |
| S5 | Reconciliation job and dashboard, quota guard, exception queue | Daily run report signed by finance |
| S6 | Cutover: freeze legacy posting, snapshot, load, first reconciled document | `plan/CUTOVER-AND-MIGRATION.md` §4.4 complete |

Until S0, no code is written against a guessed product. The adapter interface, the outbox shape and
the reconciliation rules above are product-neutral and can be built behind a fake adapter in tests,
which is exactly how the existing Sage tests already work.
