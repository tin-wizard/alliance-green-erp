# Sage integration on cloud APIs

**Status:** active; the product is decided (D19). **Date:** 2026-11-11. **Owner:** Platform, with
the finance owner.
**Supersedes:** the MySQL implementation in ADR 0005 (`simply` schema, ports 13540-13544).
**Driven by:** `plan/REBUILD-PLAN.md` D18 (cloud) and D19 (Sage Business Cloud Accounting).
`plan/CUTOVER-AND-MIGRATION.md` §3.6 and §4.4 carry the cutover consequences;
`plan/modules/SAGE-RECONCILIATION.md` carries the daily reconciliation design;
`plan/modules/SAGE-ADAPTER-SCAFFOLD.md` carries the implementation-ready scaffold.
**Repo target:** `packages/sage/` keeps the adapter boundary; only the implementation changes.

---

## 1. The product is decided: Sage Business Cloud Accounting

**D19 (2026-11-11): the integration target is Sage Business Cloud Accounting** ("Sage Accounting",
formerly Sage One). This supersedes the three-candidate ambiguity in the first draft of this
document. The API shape below — REST v3.1, OAuth authorisation-code, 2,500 requests/day per company
— is therefore the shape to build against, not a placeholder.

What that decision fixes:

- The transport is HTTPS/JSON against `https://api.accounting.sage.com/v3.1`, with an
  `Authorization: Bearer` token and an `X-Business` header naming the business.
- Authorisation is interactive at least once; there is no client-credentials flow, so the
  integration has a human-dependent bootstrap and a token that must be kept alive.
- Identity is opaque strings assigned by Sage. Nothing in our code may parse, predict or renumber
  an id.
- There are no webhooks and no bulk endpoints: reads are polled with
  `updated_or_created_since` / `deleted_since`, writes are one record per request.
- Purchase orders are ours. The purchase surface is bills, credit notes and quick entries, so a PO
  becomes a bill when it is invoiced, and the app remains the system of record for purchasing.
- Project costing does not exist. Work-order and project profitability stays in our reports.

What it does not fix, and what this document therefore still treats as open, is listed in §1.2.

### 1.1 Why not hosted Sage 50 or Sage Intacct

Hosted Sage 50 (Sage 50cloud) is the same desktop product on a Sage-managed Windows host. It still
has no REST API: the US and Canadian editions ship a .NET SDK that must run on a 32-bit Windows
machine beside the company file, and UK/Ireland use Sage Data Objects. Choosing it would mean a
Windows agent and a sync service, which D18 removes.

Sage Intacct is a genuine cloud ERP and would suit a larger, multi-entity business. Its dimensions,
approval workflows and project accounting are more than this business needs, and its implementation
scope and pricing do not match a 30-person distributor. It remains the fallback if the conversion
finds a hard blocker in Sage Accounting, but it is not the plan.

Both are recorded so the choice is not reopened by accident. The detailed candidate comparison from
the first draft is withdrawn; it served its purpose and is not maintained.

### 1.2 Decisions recorded (2026-11-11)

| Ref | Decision | Consequence for this document |
|---|---|---|
| D19 | Product is **Sage Business Cloud Accounting** | REST v3.1 shape throughout; no SDK, no Windows agent |
| D21 | **Sage 50 data is migrated into Sage Accounting, including full historical documents** | The conversion is a workstream of its own: `plan/modules/SAGE50-MIGRATION.md` |
| D22 | **Data residency: stay on Neon `aws-us-east-2` (Ohio)**; US hosting accepted | ADR 0015; compute may still be Montréal (`yul1`); no database migration, `packages/auth` stays on Neon Auth, object storage stays Neon |
| D23 | Sage subscription, developer app and OAuth authorisation are **owned by Alliance Lighting** | Credentials and the consenting person come from the client; the platform secret store holds the values |
| — | **Project costing lives in this ERP**, not in the ledger | §1.6; Sage receives the financial summary and no project dimension |

Two things follow immediately. The rebuild does not need a residency migration, so the scaffold and
the cutover plan stay on Neon. And the Sage conversion is no longer an "opening balances only"
exercise: it carries real historical documents, which makes quota, period locks and document
fidelity first-order problems — see `plan/modules/SAGE50-MIGRATION.md` §4.

### 1.3 Still open

1. **The posting cut-off date**, and who signs the opening-balance and trial-balance snapshots. It
   shapes the conversion schedule, not the adapter.
2. **Tenant confirmation**: the chart of accounts, tax rates and stock settings the Alliance
   Lighting tenant will use. The conversion depends on them, and the tenant must exist before the
   load can be rehearsed.

### 1.4 Technical facts to verify against the tenant

Confirmed from the public reference on 2026-11-11 (endpoints, token lifetimes, quotas, Canada tax
regions). Still to verify on the actual tenant before posting is enabled:

- that Canadian stock items and stock movements are enabled, which decides whether invoice posting
  moves stock or whether we post `/stock_movements` explicitly;
- the tenant's tax rates and `tax_address_region` ids, and how the returned `tax_breakdown` treats
  exempt and zero-rated lines;
- the daily quota reset boundary (assumed UTC) and whether response headers expose remaining quota;
- whether the tenant accepts the invoice volume and date range this business posts;
- whether historical inventory movement can be loaded at all, or only an opening position.

Each is an acceptance check in the scaffold's tenant-probe phase, not an assumption in code.

### 1.5 Credentials: names, placement and the wiring checklist

**Ownership (D23).** The Sage subscription, the developer application and the one-time OAuth
authorisation belong to **Alliance Lighting**. The client holds the Sage account; we hold the
integration's secrets. That distinction matters at rotation and at re-authorisation: only someone
with Alliance's Sage login can consent, so the procedure below names the client step explicitly.

The developer credentials arrive from the human. They are never requested by chat, never written to a
file in the repository, and never sent to a browser.

| Variable | What it is | Where it lives | Rotation |
|---|---|---|---|
| `SAGE_ENABLED` | Master switch (`false` disables all Sage work, health reports `disabled`) | Vercel env, all environments | n/a |
| `SAGE_ENVIRONMENT` | `sandbox` or `production`; selects base URLs and which tenant | Vercel env per environment | n/a |
| `SAGE_CLIENT_ID` | Developer app client id | Vercel env, **sensitive** | On app re-registration |
| `SAGE_CLIENT_SECRET` | Developer app client secret | Vercel env, **sensitive** | On suspected exposure or app rotation |
| `SAGE_REDIRECT_URI` | Exact callback, `https://<production-domain>/api/sage/oauth/callback` | Vercel env, non-secret | When the domain changes |
| `SAGE_API_BASE_URL` | `https://api.accounting.sage.com/v3.1` | Vercel env, non-secret | If the API version changes |
| `SAGE_AUTH_BASE_URL`, `SAGE_TOKEN_URL` | Authorise and token endpoints | Vercel env, non-secret | If the API version changes |
| `SAGE_BUSINESS_ID` | `X-Business` value; set after the first `/businesses` read | Vercel env, non-secret | If the company is re-onboarded |
| `SAGE_TOKEN_ENC_KEY` | 32-byte key that encrypts the stored refresh token | Vercel env, **sensitive** | Rotatable: decrypt-then-re-encrypt, never by overwriting |
| `SAGE_DAILY_QUOTA`, `SAGE_MINUTE_QUOTA` | Budget overrides, default 2500 / 100 | Vercel env, non-secret | If Sage changes the plan |

Two rules follow from that table. First, **the refresh token is data, not configuration**: the OAuth
callback writes it into `sage_connections`, encrypted with `SAGE_TOKEN_ENC_KEY`, with a fingerprint
so a key mismatch is detectable. Second, **preview deployments get `SAGE_ENABLED=false`**, so a pull
request can never post to the company's ledger. If the team later moves configuration into Neon's
secret store instead of Vercel, the names stay identical and only the injection point changes; there
is no code difference.

The legacy `SAGE_HOST`, `SAGE_PORTS`, `SAGE_DATABASE`, `SAGE_USER`, `SAGE_PASSWORD` and
`SAGE_CONNECT_TIMEOUT_MS` variables are removed with the MySQL implementation; no code path reads
them after the scaffold lands.

#### Wiring checklist, in the order it has to happen

This is the whole procedure for the day the credentials arrive. It is a checklist, not a design
question: every step has a named actor and a verifiable outcome.

| # | Actor | Step | Verified by |
|---|---|---|---|
| 1 | Alliance Lighting | Confirm the Sage Accounting tenant is live, and note its country and business name | Tenant visible in the Sage portal; country = Canada |
| 2 | Platform | Register the developer application in the Sage developer portal under Alliance's account, with the production callback URL | Client id and secret issued |
| 3 | Platform | Store `SAGE_CLIENT_ID`, `SAGE_CLIENT_SECRET`, `SAGE_TOKEN_ENC_KEY` in **Vercel project env, Production scope, marked Sensitive**; store the non-secret URLs and `SAGE_ENVIRONMENT=production` alongside | `vercel env ls` shows all keys for Production only |
| 4 | Platform | Set `SAGE_ENABLED=true` for Production; leave Preview and Development at `false` with `SAGE_FAKE=true` | Preview deployment reports `disabled` on `/api/health` |
| 5 | Platform | Deploy, then open `https://<production-domain>/api/sage/oauth/start` while signed in as an admin | Redirect to Sage's consent screen |
| 6 | **Alliance Lighting** | Sign in to Sage as the account owner and approve the application | Sage redirects back to `/api/sage/oauth/callback` |
| 7 | Platform | Confirm the callback stored the connection and resolved the business | `sage_connections.state = verified`, `business_id` set, `/api/health` shows `verified` |
| 8 | Platform | If more than one business was returned, select the right one in the admin picker | Posting is blocked until a business is chosen |
| 9 | Platform | Run the tenant probe (`sage.probe` job) | Capsule report: tax rates, ledger accounts, stock items enabled, quota reset boundary |
| 10 | Platform | Post one sandbox invoice, then reconcile it | Link row exists, totals match to the cent, one ledger document |
| 11 | Platform | Set `SAGE_ENVIRONMENT=production` only after the sandbox probe passes, then repeat steps 5-10 against production | First production invoice reconciles; daily reconciliation passes |

Three failure modes this checklist is designed to catch, because each one has bitten an integration
before:

- **Wrong redirect URI** — the app must be registered with the exact production URL. A localhost or
  preview URL is rejected by Sage and looks like an authorisation failure.
- **Token stolen by a preview deployment** — prevented by step 4, not by discipline.
- **Silent expiry** — step 7 plus the daily keep-alive job; a failed keep-alive flips the state to
  `needs_reauth` the same day, which is a banner and an alert, not an error in a log.

### 1.6 Project costing: the dimension stays in this app

This is decided, with one external fact to confirm.

**What exists today.** The legacy posts project work orders to Sage 50's project module
(`tproject`, `inv_project.sage_project_workorder`, `salesHeadProjectWO`), and job costing is a
Sage 50 Premium/Quantum (Canada) feature. Work orders and their costs also exist in the portal, in
`project_workorder`, `project_wopinvoice` and the `inv_*` tables.

**What Sage Accounting Canada provides.** No project/job dimension. The Projects feature that exists
in Sage Accounting is a UK/Ireland capability and is not part of the Canadian edition. This is
verified indirectly (product documentation and regional feature lists), so it carries a
**confirm-with-Sage** caveat: ask the account manager for the Canadian edition's project/job
capability in writing before the conversion design is frozen. If it turns out to exist, this
decision can be revisited cheaply; if it does not, nothing has been built on it.

**Decision.** Project costing lives in this ERP. Sage receives the financial summary — a sales
invoice whose lines carry the work-order number in the description and reference — and no project
dimension. Concretely:

- Work order, quote, purchase order and project profitability are computed in `app` from data we
  already own (`inv_parts`, `inv_hours`, `inv_soparts`, PO receipts, subcontractor invoices).
- Reports that today read a Sage project P&L are rebuilt as app reports, with the work-order number
  as the grouping key. There is no Sage report to reproduce once Sage 50 is retired.
- If finance insists on a ledger-side project view for the accountant, the fallback is one ledger
  account per active project, not one per job — a small, controlled chart of accounts, mapped in the
  conversion. That is a bookkeeping convenience, not a costing system, and it is not the
  recommendation.
- The conversion therefore has no project dimension to load. Sage 50 project rows are converted into
  our own tables (or read from the archive), never into Sage Accounting.

**Why this is safe.** The dimension the business actually uses is the work order, and that never
leaves our database. What leaves is money: one invoice total per work order. Losing the ledger's
project report costs a report; losing the work-order cost history would cost the business.

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

## 7. History: Sage 50 is migrated, not archived

D21 settles this: Sage 50's accounting data moves into Sage Accounting, **including historical
documents**. The first draft's recommendation of archive-plus-opening-balances is withdrawn. The
conversion is now a workstream with its own plan — `plan/modules/SAGE50-MIGRATION.md` — and this
section states only what the API imposes on it, because those constraints shape the schedule.

What the API can receive: contacts, opening balances, sales invoices, purchase invoices, credit
notes, journals, stock items and stock movements, with `migrated` flags and `legacy_id`/`source_guid`
hints on artefacts. What it cannot: purchase orders (no endpoint), projects or jobs (Canadian
edition, §1.6), postings into locked prior-year periods (a tenant policy, not a field), and bulk
import of any kind — one record per request, 2,500 requests/day per company, shared with everything
else on the tenant.

The arithmetic that decides the schedule, stated plainly: of the order of 40,000 sales documents at
two to three calls each (search plus create, with cached lookups), the load is 80,000-120,000 calls.
At 2,500/day that is 32-48 days of uninterrupted posting, before bills, payments and stock. Three
consequences follow:

1. the load must be scheduled, resumable and idempotent exactly like the migration harness, and it
   needs its own quota class so routine posting is not starved;
2. it needs a calendar window measured in weeks, not a weekend maintenance slot;
3. the fastest path is to ask Sage whether a migration service or a temporary quota increase exists
   for the conversion account. If it does, the API becomes a verification pass instead of the
   primary transport, and the schedule collapses to days.

Inventory is the one place where "full history" must be interpreted conservatively. Stock counters
in the legacy have drifted (`plan/CUTOVER-AND-MIGRATION.md` §5), so the conversion loads an opening
position per item dated at cut-off plus the drift report, and only those historical movements the
business can evidence. Replaying years of movements would import the drift as fact and consume quota
that the document load needs.

The rebuild's own `app` tables hold the operational history either way — work orders, quotes, POs,
invoice snapshots, stock ledger — because that history is the business's, not the ledger's. Sage
holds the accounting view of it.

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
  not purchase orders. POs live in our app; a bill is created in Sage when a PO is invoiced. If a
  future API version exposes POs, we revisit, but the app remains the system of record for
  purchasing either way.
- **No quote sync.** Quotes are ours, with our numbering and our PDF; the ledger never sees a quote.
- **No project costing in the ledger.** Sage 50 projects do not exist in Sage Accounting's Canadian
  edition, so project and work-order profitability stays in this app (§1.6). Sage receives the
  financial summary, and the conversion has no project dimension to load.
- **No webhooks, no bulk, no client credentials.** We poll, we post one document at a time, and a
  human authorises the tenant.
- **No secrets in the repository or in the client bundle.** Consumer key, consumer secret, refresh
  token and encrypting key live in the platform secret store.
- **No second writer.** Exactly one environment holds the active token pair for the company. A
  developer testing against a production tenant is the modern version of two writers on one
  database.

---

## 10. Implementation sequence

S0 is done (D19). The rest runs in the order below; S1-S3 need only the developer app credentials
and a sandbox tenant, not the client business decisions in §1.2.

| Phase | Work | Done when |
|---|---|---|
| S0 | ~~Choose the product and record it as D19~~ — decided 2026-11-11: Sage Business Cloud Accounting | Recorded; ADR 0005 marked superseded |
| S1 | OAuth connection: authorise, store encrypted token, refresh under a lock, keep-alive, `needs_reauth` state, disconnect | A scheduled keep-alive survives a week in the sandbox; health reports `verified` |
| S2 | Entity sync: contacts, products/stock items, tax rates, ledger accounts; `sage_links` for each | Re-running the sync twice changes nothing |
| S3 | Sales invoice posting with `external_ref`, search-before-create, idempotent retry, link table, outbox worker | A posted invoice reconciles to the cent; a forced timeout does not duplicate |
| S4 | Purchase invoice posting, credit notes, journals, opening balances | A rehearsal loads opening balances into a sandbox tenant twice with one result |
| S4b | **Historical conversion (D21) — its own workstream** | `plan/modules/SAGE50-MIGRATION.md`: signed baseline, documents loaded and resumable, reconciliation to the cent |
| S5 | Reconciliation job and dashboard, quota guard, exception queue | Daily run report signed by finance (see `plan/modules/SAGE-RECONCILIATION.md`) |
| S6 | Cutover: stop legacy posting, snapshot, load, first reconciled document | `plan/CUTOVER-AND-MIGRATION.md` §4.4 complete |

S1-S3 are specified to the file and function level in `plan/modules/SAGE-ADAPTER-SCAFFOLD.md`, which
is written to be implemented with the fake adapter first and the real client second. Nothing waits
on §1.2 except S4 and S6.
