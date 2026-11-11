# Sage adapter scaffold — implementation specification

**Status:** specified; **not yet applied to the repo.** The working tree is owned by the Quotes
agent (Invoicing + the Playwright parallel-429 fix), so this document is the hand-off: it is written
to be implemented in one PR when the orchestrator releases the tree.
**Date:** 2026-11-11. **Owner:** Platform.
**Implements:** `plan/modules/SAGE-CLOUD.md` S1-S3, `plan/modules/SAGE-RECONCILIATION.md`
**Replaces:** `packages/sage/src/legacy-port-scan.ts`, the `mysql2` dependency, and the
`SAGE_HOST|PORTS|DATABASE|USER|PASSWORD|CONNECT_TIMEOUT_MS` env groups.

---

## 1. Scope and the fake-first rule

The scaffold delivers, with no live Sage tenant required:

1. the cloud adapter interface and its connection state machine;
2. an OAuth 2.0 authorisation-code flow with encrypted token custody, serialised refresh, keep-alive
   and a first-class `needs_reauth` state;
3. a quota-aware HTTP client (2,500/day, 100/min) with retry classification;
4. the posting outbox and worker, with search-before-create idempotency;
5. a **fake adapter** that implements the same interface, is scriptable for faults, and is the only
   implementation wired in development and tests;
6. the database tables from `SAGE-RECONCILIATION.md` §3;
7. health states and the `numberInUse` capability the work-order allocator already probes for.

The real HTTP client is written against the documented v3.1 shapes and is exercised only against the
fake until the developer app credentials arrive. That is not a stub: the fake is the test double the
reconciliation design is validated on, and it stays in the repo afterwards as the dev sandbox.

---

## 2. Current state in the repo (read, not changed)

| File | Today | Fate |
|---|---|---|
| `packages/sage/src/types.ts` | Sage 50 discovery types (`SageEndpoint`, port constants, sentinel SQL) | Replaced by cloud types; the legacy names removed |
| `packages/sage/src/legacy-port-scan.ts` | `LegacyPortScanAdapter` with TCP probe + sentinel | Deleted with its test |
| `packages/sage/src/index.ts` | `getSageAdapter()` builds a port-scan adapter from `getConfig().sage` | Rewritten: builds the cloud adapter or the fake from `SAGE_ENABLED` / `SAGE_ENVIRONMENT` |
| `packages/sage/package.json` | depends on `mysql2` | `mysql2` removed; no new runtime dependency (uses `fetch`, `node:crypto`) |
| `apps/web/src/server/health.server.ts` | calls `getSageAdapter().health()` | Unchanged call site; payload gains `connection` detail |
| `apps/web/src/modules/work-orders/server/sage-collisions.server.ts` | probes for optional `numberInUse` | Now satisfied by the new adapter; see §9 |
| `packages/core/src/env.server.ts` | `sage` block with host/ports/database/user/password | Replaced by the cloud env block; legacy keys rejected with a clear message |

---

## 3. Target layout

```
packages/sage/src/
  index.ts            getSageAdapter(), getSagePoster(), test seams
  types.ts            public types: connection, health, documents, outcomes
  adapter.ts          SageCloudAdapter implements SageAdapter (fetch client)
  fake.ts             FakeSageAdapter: in-memory ledger + scripted faults
  auth/
    oauth.ts          authorise URL, code exchange, state/nonce
    tokens.ts         TokenService: 5-min access, 4-min refresh, rotation, lock, encryption
    crypto.ts         AES-256-GCM seal/open with SAGE_TOKEN_ENC_KEY, fingerprint
  client/
    http.ts           fetch wrapper: headers, timeout, classification
    rate-limit.ts     minute bucket + daily budget read/write (app.sage_quota_usage)
    errors.ts         SageError taxonomy (permanent, retryable, auth, quota, validation)
  posting/
    outbox.ts         enqueue(), claim(), complete(), fail() — SQL and state machine
    worker.ts         runPostingBatch(): the drain job body
    mappers/
      sales-invoice.ts
      purchase-invoice.ts
      journal.ts
      opening-balance.ts
      stock-movement.ts
  reconcile/
    run.ts            the six checks (per SAGE-RECONCILIATION.md)
    findings.ts       codes, severity, owner defaults
  number-in-use.ts    numberInUse() for the WO allocator
```

The job wiring lives in the app (`apps/web/src/modules/sage/server/jobs.server.ts`), registered in the
ADR 0012 catalogue as `sage.post-pending`, `sage.poll-external`, `sage.reconcile`,
`sage.keepalive`, `sage.quota-guard`.

---

## 4. Public types

```ts
export type SageConnectionState =
  | 'disabled'         // SAGE_ENABLED=false; no calls attempted
  | 'disconnected'     // enabled, never authorised
  | 'needs_reauth'     // refresh token dead or revoked: a human must authorise again
  | 'verified'         // token fresh, last probe succeeded
  | 'degraded'         // reachable but failing calls, or quota exhausted
  | 'error'            // last call failed in a way we cannot classify

export interface SageHealth {
  status: SageConnectionState | 'unverified'   // 'unverified' kept for compatibility
  checkedAt: Date
  environment: 'sandbox' | 'production'
  businessId: string | null
  accessTokenExpiresAt: Date | null
  refreshExpiresAt: Date | null
  quota: { used: number; limit: number; resetsAt: Date }
  message: string
}

export type SageDocumentType =
  | 'sales_invoice' | 'sales_credit_note'
  | 'purchase_invoice' | 'purchase_credit_note'
  | 'journal' | 'opening_balance' | 'stock_movement'

export interface PostingRequest { docType: SageDocumentType; docId: string; payload: unknown }
export interface PostingResult {
  externalRef: string
  apiId: string
  status: 'created' | 'already_exists' | 'rejected' | 'unknown'
  apiReference?: string
  total?: string
}
```

`needs_reauth` is a **state**, not an exception type. Every caller treats it as "Sage work is paused
and a human is needed", never as a generic failure, because the UI must say *authorise the Sage
connection* rather than *something went wrong*.

---

## 5. OAuth and token custody

### Authorise (once per environment)

- `GET /api/sage/oauth/start` — admin-only, refuses unless `SAGE_ENABLED=true` and the caller holds
  `sage.connect` (granted to admins). Generates `state` (32 random bytes, stored hashed with a
  10-minute expiry) and redirects to `SAGE_AUTH_BASE_URL` with `client_id`, `redirect_uri`,
  `response_type=code`, `scope=full_access`, `state`.
- `GET /api/sage/oauth/callback` — verifies `state` (single use), exchanges the code at
  `SAGE_TOKEN_URL` with client id/secret/redirect, then in **one transaction**: seals both tokens,
  writes `sage_connections`, sets state `verified`, records `last_refresh_at`. The response is a
  redirect to a page that says which business was connected.
- `GET /businesses` immediately after the exchange; if more than one business is returned, the
  callback does **not** guess: it stores the connection as `verified` with `business_id = null` and
  sends the operator to a picker. Defaulting to the "lead" business is how postings land in the
  wrong set of books.

### Refresh

- Access token lifetime 300 s; refresh when 240 s have elapsed.
- One refresh at a time, enforced with `pg_advisory_xact_lock(hashtext('sage:refresh:<env>'))`.
- The response contains a **new refresh token**; the old one is dead the moment the response is
  produced. Therefore: seal the new pair and commit **before** returning the access token to the
  caller. If the commit fails, mark `needs_reauth` and stop — do not retry with the old token.
- On `invalid_grant` / 400 from the token endpoint: state `needs_reauth`, alert, keep the outbox
  intact. Never delete postings.
- Keep-alive: a daily 1-call refresh (or `GET /businesses` if the token is fresh) prevents the
  31-day idle death. A failed keep-alive sets `needs_reauth` the same day, so the outage is a
  banner rather than a month-end surprise.

**Token age is a health assertion, not a hope.** The integration dies silently if nothing refreshes
for 31 days, so every health check computes and reports:

| Measure | Healthy | Warning | Blocker |
|---|---|---|---|
| `daysSinceRefresh` (last successful refresh or keep-alive) | < 14 | 14-20 → `refresh_stale` warning | ≥ 21 → `needs_reauth`, stop posting |
| `refreshExpiresAt - now` | > 10 days | 3-10 days → warning | < 3 days → blocker |
| `accessExpiresAt` after a refresh attempt | future | — | past after a successful refresh means a clock or storage bug: `error` |

The 21-day blocker sits a third of the way inside the 31-day window on purpose: it leaves ten days to
find a human, authorise, and resume, without a single failed invoice. Normal invoice cadence keeps
the token alive on its own; this assertion exists for the case where the business is quiet — a
shutdown, a holiday closure, a month with no invoicing — which is exactly when nobody notices.

The daily `sage.keepalive` job writes a `sage_health_samples` row (checked_at, days_since_refresh,
refresh_expires_at, state), so "was the token alive last Tuesday" is a query rather than a log
archaeology exercise. The samples also back the dashboard's 30-day token-age sparkline.

### Custody

- AES-256-GCM, key from `SAGE_TOKEN_ENC_KEY` (32 bytes, base64), random IV per seal, AAD =
  `environment|business_id`.
- The database stores ciphertext plus a SHA-256 fingerprint of the token. A key rotation decrypts
  with the old key and re-encrypts with the new one in one scripted operation; losing the key means
  re-authorising, which is an accepted recovery path.
- Tokens never appear in logs, error messages, API responses, or the client bundle. The health
  payload exposes expiry timestamps only.

---

## 6. HTTP client and the two quotas

```
Authorization: Bearer <access>
X-Business: <business_id>
Accept: application/json
Content-Type: application/json
```

- **Timeouts:** 10 s connect, 30 s total for a single record; a batch never exceeds the platform
  function budget.
- **Minute quota:** token bucket of 90 (headroom under the documented 100), refilled per 60 s,
  shared process-wide; on 429 the bucket drains and the `Retry-After` delay is honoured.
- **Daily quota:** `app.sage_quota_usage` is incremented per call by class. Budgets:

  | Class | Daily budget | Notes |
  |---|---:|---|
  | `posting` | 1,500 | May not be starved by other classes |
  | `sync` | 500 | contacts, products, tax, ledger |
  | `payment_poll` | 300 | incremental only |
  | `reconcile` | 150 | reserved; the daily run uses ~30-60 |
  | `probe` | 50 | health checks |

  At 90% of the total, posting continues and every other class stops; at 98%, posting stops and the
  queue holds. Both transitions write a finding (`QUOTA_NEAR_LIMIT`, `QUOTA_EXHAUSTED`) and alert.
- **Reset boundary:** assumed UTC midnight (unverified — §1.3 of SAGE-CLOUD.md). The guard reads the
  counter, never a local clock, so a wrong boundary costs one day of headroom, not a failure.
- **Classification:** 429 → retryable with `Retry-After`; 5xx/timeout → retryable; 401 → refresh once
  then `needs_reauth`; 403 → `needs_reauth` or permission problem depending on the body; 422 →
  permanent with the field errors preserved on the finding; 409 → treat as "already exists" and
  search.

---

## 7. Posting outbox and worker

State machine on `app.sage_postings.status`:

```
queued ──claim──> sending ──2xx──> sent
   ▲                 │
   │                 ├─ retryable error ──> retryable ──(next_attempt_at)──> queued
   │                 ├─ 422/409-permanent ──> permanent
   │                 └─ timeout ──> unknown ──search──> sent | retryable | permanent
   └──────────────────────────── skipped (document cancelled before posting)
```

Worker algorithm (`runPostingBatch({ limit: 10, docTypes })`):

1. Claim with `FOR UPDATE SKIP LOCKED` on `status in ('queued','retryable')` and
   `next_attempt_at <= now()`, ordered by `created_at`, limited to the batch size, per document type
   to preserve invoice-before-credit-note ordering.
2. Budget check per class; if the budget is exhausted, return `{ paused: 'quota' }` and let the job
   finish successfully (a paused job is not a failed job).
3. **Search before create** — `GET /sales_invoices?search=<externalRef>&items_per_page=1` (and the
   purchase equivalent). A hit with an exact reference means the previous attempt succeeded:
   write the link, mark `sent`, done. This runs on every attempt, not only after a timeout, because
   the cost is one cheap call and the alternative is a duplicate invoice.
4. `POST` the document. On 201, store `api_id`, `api_reference`, `api_total`, `api_tax` in
   `sage_links` and mark `sent` in the same transaction. On 4xx/5xx, follow §6 classification.
5. On timeout or a network error with no response: mark `unknown`, do not count a permanent attempt,
   and set `next_attempt_at` to now + 1 minute so the search runs promptly.
6. Backoff for retryable errors: 1 m, 5 m, 30 m, 2 h, 6 h with ±20% jitter; attempt 6 → `permanent`
   and a finding for a human.
7. Never delete or edit a `sent` row. A correction is a credit note or a new document.

**External reference format:** `cls:<docType>:<docId>` — stable across retries, unique in our
database, carried in the API's free-text reference/notes field, and the key the reconciliation joins
on. Opening balances use `cutover:<snapshotId>:<contactId>`; reissued open documents use
`cutover-open:<legacyDocId>`.

**Payload mapping rules** (S3 covers sales invoices; S4 the rest):

- contact: `sage_contacts.contact_id` resolved from `app.customers.sage_contact_id`; a missing link
  is a permanent `CONTACT_NOT_LINKED` finding, never a silent create — creating a duplicate customer
  in the ledger is worse than not posting.
- lines: parts → `product_id`, labour and services → `service_id`, special parts → `ledger_account_id`
  with a description; `quantity`, `unit_price`, `tax_rate_id`, `discount_amount` per line.
- tax: `tax_rate_id` resolved from our province tax table to the tenant's rate id **at posting
  time**, cached for an hour; a missing mapping is permanent and blocks the document.
- totals: the API computes from lines. Before sending, the mapper proves that the line set reproduces
  our stored net/tax/total to the cent; if it cannot, it adds an explicit rounding line and records
  `ROUNDING_LINE_ADDED` on the posting. It never sends a total field and hopes.

---

## 8. Fake adapter

`FakeSageAdapter` implements the same interface and simulates the product closely enough to exercise
every failure path:

- deterministic opaque ids (`fake_si_000123`), an in-memory ledger keyed by id and by external
  reference;
- validates required fields and Canadian tax presence, returning 422 shapes for missing
  contact/tax/ledger mappings;
- enforces the same two quotas, with a clock the test controls;
- scripted faults per document type: `failNext(n, '429'|'500'|'timeout_after_commit'|'422'|'401')`,
  `expireAccessToken()`, `killRefreshToken()` (drives `needs_reauth`), `deleteDocument(apiId)`,
  `tamperAmount(apiId, delta)`, `addPayment(contactId, amount)`;
- a latency setting (0 ms in tests, 200-800 ms in dev sandbox) so timeout paths are testable without
  real waiting;
- a `snapshot()` of its ledger for assertions, and `reset()` between tests.

Selection: `getSageAdapter()` returns the fake when `SAGE_ENVIRONMENT=development`, when
`SAGE_ENABLED=false` with `SAGE_FAKE=true`, or always in `NODE_ENV=test`. Production requires
`SAGE_ENVIRONMENT=production` and refuses to start with `SAGE_FAKE=true` — an environment guard, not
a convention.

---

## 9. Work-order numbering and `numberInUse`

The legacy allocator checked `tcustr.sSource` and `tProject.sName` to avoid colliding with Sage. In
Sage Accounting, an invoice's number is the ledger's, our reference is ours, and no Sage field
constrains a work-order number. The honest implementation therefore:

- `numberInUse(id)` checks **our own** tables — work orders, quotes, invoices, and
  `app.sage_links.api_reference` — for the number, and returns `false` when free.
- It returns `null` only when the check cannot run (database unavailable), which keeps the allocator's
  existing "unverifiable" behaviour intact.
- The `describe()` string becomes `app numbering + sage_links.api_reference`, and the old
  "Sage collision check unavailable" warning disappears.

The allocator itself is unchanged. This is the one place where the cloud move removes work rather
than adding it: BUSINESS-RULES C3 was a workaround for writing under Sage, and app-owned numbering
with a real uniqueness constraint satisfies it properly.

---

## 10. Database and environment changes

**New schema file:** `packages/db/src/schema/app/sage.ts` exporting `sageConnections`, `sagePostings`,
`sageLinks`, `sageQuotaUsage`, `sageSyncState`, `sageHealthSamples`, `sageReconciliationRuns`,
`sageReconciliationFindings` (columns as in `SAGE-RECONCILIATION.md` §3, plus indexes on
`(status, next_attempt_at)` and `(usage_day, class)`).
**Migration:** `0007_sage_cloud.sql` (0005 and 0006 belong to the in-flight Purchasing/Inventory
work; the scaffold rebases on whatever is present when it lands).

**Env (`packages/core/src/env.server.ts`):** replace the `sage` block with

```ts
sage: {
  enabled: boolean            // SAGE_ENABLED, default false
  environment: 'sandbox' | 'production'
  clientId?: string
  clientSecret?: string
  redirectUri?: string
  apiBaseUrl: string          // default https://api.accounting.sage.com/v3.1
  authBaseUrl: string
  tokenUrl: string
  businessId?: string
  tokenEncKey?: string        // required when enabled
  dailyQuota: number          // default 2500
  minuteQuota: number         // default 100
}
```

Validation rules: `enabled=true` in production requires `clientId`, `clientSecret`, `redirectUri` and
`tokenEncKey`; `environment=production` with `NODE_ENV!=='production'` is allowed (sandbox testing of
production-shaped config) but `SAGE_FAKE=true` is rejected in production; any of the legacy
`SAGE_HOST|PORTS|DATABASE|USER|PASSWORD|CONNECT_TIMEOUT_MS` keys present cause a startup error naming
the replacement, so a stale Vercel variable cannot silently do nothing.

---

## 11. Test matrix

| Area | Cases |
|---|---|
| OAuth | state mismatch rejected; replayed state rejected; code exchange failure leaves state `disconnected`; multi-business callback leaves `business_id` null |
| Tokens | refresh at 240 s; two concurrent callers produce one refresh (advisory lock); rotation stores the new token before use; commit failure yields `needs_reauth`; 31-day expiry path; keep-alive failure flips state same day |
| Crypto | seal/open round-trip; wrong key fails closed; AAD mismatch rejected; fingerprint mismatch detected |
| Quotas | bucket admits 90/min; 429 with `Retry-After` honoured; posting keeps budget under sync load; 90% and 98% transitions write findings; counter survives process restart |
| Outbox | claim ordering per doc type; `FOR UPDATE SKIP LOCKED` under two workers, no double claim; cancel-before-post marks `skipped`; sent rows immutable |
| Idempotency | search-hit adopts link; timeout-after-commit yields one ledger document; forced 500 then success yields one; 422 is permanent and does not retry; 409 resolves by search |
| Mapping | invoice total reproduced to the cent including rounding line; missing contact link is permanent; missing tax mapping is permanent; tax by rate matches the snapshot |
| Health | each state renders; `needs_reauth` is distinguishable from `error`; disabled makes zero calls; token-age thresholds fire at 14 and 21 days with a frozen clock; a stored sample is written by keep-alive |
| Numbering | `numberInUse` finds a number in work orders, quotes, invoices and `sage_links`; returns null on database failure |
| No network | the whole suite runs with the fake; a guard fails the build if a test imports the real client without an explicit `SAGE_TEST_HTTP=1` opt-in |

---

## 12. Rollout, and what this does not touch

1. **PR 1 — boundary and fake.** Types, state machine, env, schema, fake adapter, `getSageAdapter()`
   rewrite, delete port scan + `mysql2`, health payload. No call sites change behaviour beyond the
   health shape.
2. **PR 2 — OAuth and tokens.** Routes, token service, encryption, keep-alive job, `needs_reauth`
   surfaced in the UI. Still fake-only in tests.
3. **PR 3 — outbox and worker.** Tables, enqueue API, worker, job registration, search-before-create,
   mappers for sales invoices. Reconciliation skeleton with checks 4.1-4.2.
4. **PR 4 — real client behind a flag.** `fetch` client, rate limiter, classification; enabled only
   when credentials exist. Sandbox tenant probe (SAGE-CLOUD.md §1.3), then the first human-authorised
   test invoice.
5. **PR 5 — reconciliation completion.** Checks 4.3-4.6, run report, dashboard, cutover mode.

Not touched: invoicing/purchasing/work-order modules (they enqueue and read state), the migration
harness, notification templates, or the pricing fixtures. The scaffold touches `packages/sage`,
`packages/db/src/schema/app/sage.ts`, `packages/core/src/env.server.ts`, the health payload, and one
new `apps/web/src/modules/sage/server/` directory.

**Ready to start on the orchestrator's word.** Until then this spec and the reconciliation design are
the deliverables; the repo stays with the Quotes agent.
