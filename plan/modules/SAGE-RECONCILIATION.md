# Sage reconciliation design

**Status:** active, implementable. **Date:** 2026-11-11. **Owner:** Platform, signed by the finance
owner. **Product:** Sage Business Cloud Accounting (D19), API v3.1.
**Relates to:** `plan/modules/SAGE-CLOUD.md` §7-§8, `plan/CUTOVER-AND-MIGRATION.md` §3.6 and §4.4,
ADR 0012 (jobs), `plan/modules/SAGE-ADAPTER-SCAFFOLD.md` (tables and worker).

---

## 1. What this answers, and what it refuses to answer

The legacy never had to reconcile with Sage: it wrote Sage's own tables, so "what Sage holds" and
"what the portal thinks" were the same rows. With an API they are two databases, and the gap between
them is where money goes missing. This design closes that gap with a daily, evidence-producing check.

It answers four questions:

1. Does every document we believe we posted exist exactly once in the ledger?
2. Do the amounts and tax agree, to the cent?
3. Does the ledger's balance for each customer and vendor agree with our own roll-forward?
4. Did something change in the ledger that we did not cause — a payment, a credit, a deletion?

It refuses to decide whether the ledger is *right* about the business. If the accountant posts a
journal that makes the bank account agree and our roll-forward disagree, the finding is a
conversation with finance, not an automatic correction. The reconciliation reports; humans adjust.

**Standing rule: we never rewrite the ledger to match our view.** No auto-delete, no auto-edit of a
posted document, no compensating journal without a named human. The only automatic repair is
re-linking, described in §6.

---

## 2. Sources of truth, by question

| Question | Authoritative source | Our side |
|---|---|---|
| Is the document posted? | Sage (`GET /sales_invoices/{id}`, and a search by our reference) | `app.sage_postings`, `app.sage_links` |
| Does the amount match? | Our stored invoice snapshot (operator-authoritative, BUSINESS-RULES MUST #1) | `app.invoices` / snapshot columns, compared with the API `total_amount`, `tax_amount`, `invoice_lines` |
| Does the balance agree? | Sage contact outstanding (`/contacts` `outstanding_amount`; `/contact_payments`, `/contact_allocations`) | our roll-forward: opening + invoices − payments |
| What changed externally? | Sage `updated_or_created_since`, `deleted_since` | a watermark per resource in `app.sage_sync_state` |
| What did we post, and when? | `app.sage_postings` attempt log | payload hash, response id, timestamps |

Our invoice snapshot wins on disputes about *what we billed*. Sage wins on *what is recorded in the
ledger*. A difference between those two statements is the finding; neither side is assumed correct.

---

## 3. Data model the reconciliation needs

Created by the adapter scaffold, listed here because every query below depends on it.

```sql
-- one row per environment and business; tokens encrypted with SAGE_TOKEN_ENC_KEY
create table app.sage_connections (
  id                  bigserial primary key,
  environment         text not null,              -- 'sandbox' | 'production'
  business_id         text not null,
  access_token_enc    text,
  access_expires_at   timestamptz,
  refresh_token_enc   text,
  refresh_expires_at  timestamptz,
  state               text not null,              -- disconnected|needs_reauth|verified|degraded|disabled
  last_refresh_at     timestamptz,
  last_error          text,
  updated_at          timestamptz not null default now(),
  unique (environment)
);

-- the only path to Sage: one row per attempted document, retried in place
create table app.sage_postings (
  id              bigserial primary key,
  doc_type        text not null,                  -- sales_invoice|purchase_invoice|journal|opening_balance|stock_movement
  doc_id          text not null,                  -- our id, text so WO/invoice/quote numbering all fit
  external_ref    text not null,                  -- 'cls:sales_invoice:1042'
  payload         jsonb not null,
  payload_hash    text not null,
  status          text not null default 'queued', -- queued|sending|sent|retryable|permanent|unknown|skipped
  attempts        int  not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error_code text,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  sent_at         timestamptz,
  unique (doc_type, doc_id),
  unique (external_ref)
);

-- the outcome: one ledger document per posting, never two
create table app.sage_links (
  id             bigserial primary key,
  doc_type       text not null,
  doc_id         text not null,
  external_ref   text not null,
  api_id         text not null,
  api_reference  text,
  api_total      numeric(14,2),
  api_tax        numeric(14,2),
  api_status     text,
  linked_at      timestamptz not null default now(),
  last_seen_at   timestamptz,
  unique (doc_type, doc_id),
  unique (doc_type, api_id)
);

-- quota accounting, so the 2,500/day cap is a budget rather than a surprise
create table app.sage_quota_usage (
  usage_day    date not null,
  minute_bucket timestamptz not null,
  class        text not null,                     -- posting|sync|payment_poll|reconcile|probe
  calls        int not null default 0,
  primary key (usage_day, minute_bucket, class)
);

-- one row per run, one row per finding; this is the artefact finance signs
create table app.sage_reconciliation_runs (
  id          bigserial primary key,
  mode        text not null,                      -- daily|cutover|manual
  started_at  timestamptz not null,
  finished_at timestamptz,
  status      text not null default 'running',    -- running|passed|failed|error
  doc_count   int, money_total numeric(14,2),
  findings    int, blockers int,
  report      jsonb
);

create table app.sage_reconciliation_findings (
  id           bigserial primary key,
  run_id       bigint not null references app.sage_reconciliation_runs(id) on delete cascade,
  code         text not null,
  severity     text not null,                     -- blocker|warning|info
  doc_type     text, doc_id text, external_ref text, contact_id text,
  expected     numeric(14,2), actual numeric(14,2),
  detail       jsonb,
  owner        text,                              -- platform|finance|module owner
  decision     text,                              -- open|accepted|fixed_externally|excluded
  decided_at   timestamptz, decided_by uuid
);
```

`app.sage_sync_state` holds one watermark per polled resource:
`resource text primary key, watermark timestamptz, last_run_at timestamptz, last_error text`.

---

## 4. The six checks

Each check runs inside one run, in this order, and writes findings rather than throwing. A check
that cannot run (Sage unreachable, no token) marks the run `error` with a reason; it never reports
`passed` because nothing was compared.

### 4.1 Link integrity

```sql
-- documents we consider posted but have no ledger identity
select p.doc_type, p.doc_id, p.external_ref, p.status
from app.sage_postings p
left join app.sage_links l
  on l.doc_type = p.doc_type and l.doc_id = p.doc_id
where p.status = 'sent' and l.id is null;

-- a ledger id attached to two of our documents (the double-post signature)
select doc_type, api_id, count(*) , array_agg(doc_id)
from app.sage_links
group by doc_type, api_id
having count(*) > 1;

-- a posting with no attempt history beyond the first, older than an hour
select * from app.sage_postings
where status in ('queued','unknown') and updated_at < now() - interval '1 hour';
```

Findings: `MISSING_IN_SAGE` (blocker), `DUPLICATE_IN_SAGE` (blocker), `STUCK_POSTING` (warning
below 4 attempts, blocker at `unknown` after two searches).

### 4.2 Document amount and tax agreement

For every `sage_links` row touched in the window (plus every `unknown` posting):

```
GET /sales_invoices/{api_id}?nested_attributes=all
→ total_amount, net_amount, tax_amount, tax_analysis, invoice_lines[]
```

Compare, to the cent:

- our invoice snapshot `total` versus `total_amount`;
- our snapshot `tax_total` versus `tax_amount`;
- our per-line net and tax totals versus the sum of `invoice_lines[].net_amount` and `.tax_amount`;
- per tax rate: our snapshot's tax by rate versus `tax_analysis[]` grouped by `tax_rate.id`.

Findings: `AMOUNT_MISMATCH`, `TAX_MISMATCH` (both blocker, owner module owner + finance). A one-cent
difference is a blocker, not a rounding note: it compounds and it hides the real cause.

### 4.3 Balance roll-forward per contact

For each customer with activity since the last passed run:

```
expected = opening_balance
         + sum(posted sales invoices since opening)
         - sum(posted credit notes)
         - sum(allocated payments)
```

Compare with `GET /contacts/{id}` `outstanding_amount` (and `GET /contacts/{id}/payments` where the
tenant exposes it; otherwise `/contact_payments?contact_id=…`).

The same for vendors with purchase invoices and supplier credit notes.

Findings: `BALANCE_MISMATCH` (blocker for the contact, owner finance). A mismatch that exists for
every contact at once is usually our opening-balance load, not the ledger — say so in the detail.

### 4.4 External change feed

Poll with the stored watermark:

```
GET /sales_invoices?updated_or_created_since=<watermark>&items_per_page=200
GET /sales_invoices?deleted_since=<watermark>&items_per_page=200
GET /purchase_invoices?... (same two)
GET /contact_payments?updated_or_created_since=<watermark>
```

Classify each returned document:

- matches a `sage_links.api_id` and totals still agree → `last_seen_at` update, no finding;
- matches by api_id but amounts changed → `EXTERNAL_CHANGE` (warning, finance): someone edited a
  posted document, which our snapshot no longer describes;
- exists in Sage with an `external_ref` we own but no link → `ORPHAN_IN_SAGE`: adopt the link if the
  reference is unique and the totals agree, otherwise `warning`;
- was deleted and we have a link → `DELETED_IN_SAGE` (blocker, finance): a posted invoice vanishing
  is either a correction we must mirror in our own records or an accident;
- a payment or credit allocation appears → update the roll-forward inputs, no finding unless it
  cannot be matched to a contact (`PAYMENT_UNMATCHED`, warning).

Only accepted changes advance the watermark, and only after the batch is applied — the same rule the
migration harness uses for partial failure. A failed batch re-reads the same window next run.

### 4.5 Tax by period

Group posted invoices by issue month and `tax_rate_id`; compare with the ledger's `tax_analysis`
totals for the same period. This is the check that catches a wrong rate selected at posting time —
the failure mode the legacy hard-coded 13% used to hide.

Findings: `TAX_PERIOD_MISMATCH` (warning, finance; blocker if it exceeds one dollar in a month).

### 4.6 Queue and quota health

Not money, but the leading indicator: count postings by status and age, quota calls used today by
class, attempts > 3, `unknown` postings, **and token age** (`days_since_refresh`,
`refresh_expires_at - now`). Findings: `QUEUE_BACKLOG`, `QUOTA_NEAR_LIMIT` (warning at 80%),
`QUOTA_EXHAUSTED` (blocker), `REAUTH_REQUIRED` (blocker; the connection state is `needs_reauth`),
`TOKEN_STALE` (warning at 14 days since the last successful refresh, blocker at 21).

---

## 5. Findings, severity and owners

| Code | Severity | Owner | Response |
|---|---|---|---|
| `DUPLICATE_IN_SAGE` | blocker | platform | Stop the posting worker for that document type; reconcile by hand; credit note if needed |
| `MISSING_IN_SAGE` | blocker | platform | Re-post through the outbox with the same external ref (search-then-create) |
| `AMOUNT_MISMATCH`, `TAX_MISMATCH` | blocker | module owner + finance | Do not silently re-total; decide whether our snapshot or the ledger document is wrong |
| `DELETED_IN_SAGE` | blocker | finance | Decide: re-issue, or accept and void our copy; never auto-repost |
| `ORPHAN_IN_SAGE` | warning | platform | Adopt the link if the external ref is unique and totals agree |
| `EXTERNAL_CHANGE` | warning | finance | Record the new values; the ledger is authoritative for what it now says |
| `BALANCE_MISMATCH` | blocker | finance | Investigate from the opening balance forward, not by adjusting our copy |
| `PAYMENT_UNMATCHED` | warning | finance | Allocate or refund; appears until resolved |
| `TAX_PERIOD_MISMATCH` | warning / blocker > $1 | finance | Rate mapping or posting bug; fix at the source |
| `STUCK_POSTING` | warning → blocker | platform | Search-then-create; escalate at two failed searches |
| `QUEUE_BACKLOG`, `QUOTA_NEAR_LIMIT` | warning | platform | Throttle sync, let posting have the budget |
| `QUOTA_EXHAUSTED`, `REAUTH_REQUIRED` | blocker | platform | Stop posting, alert; a human authorises or the quota resets |
| `TOKEN_STALE` | warning ≥14 d, blocker ≥21 d | platform | The refresh token dies at 31 days idle; at 21 days a human must authorise before any invoice fails |

A run **passes** only when there are zero blockers and every warning from the previous run has a
decision (`accepted`, `fixed_externally`, `excluded`). Warnings do not block the run, but an
undecided warning older than one business day fails it — otherwise the report becomes wallpaper.

---

## 6. Automatic repairs, and only these

1. **Re-link by external reference** when exactly one ledger document carries a reference we own and
   no link exists. The reference is unique by construction (`cls:<docType>:<docId>`), so this is
   safe and it is the recovery path for a timeout after a successful POST.
2. **Advance the watermark** after a fully applied batch.
3. **Mark a posting `skipped`** when its document was cancelled before it ever posted (never when a
   ledger document exists).
4. **Refresh `api_total`/`api_tax`/`api_status`** on a link from a read, so the report compares
   fresh values rather than the values recorded at post time.

Everything else is a human decision recorded on the finding row. In particular there is no automatic
"fix the total in Sage", no automatic delete, and no automatic journal to force agreement.

---

## 7. Schedule, budget and staleness

| Job | Schedule (America/Toronto) | Calls | Purpose |
|---|---|---|---|
| `sage.poll-external` | every 30 min, 06:00-20:00 | ~4-8 each | payments, allocations, deletions; updates the roll-forward inputs |
| `sage.reconcile` | 06:00 daily | ~30-60 | the six checks, writes the run and findings |
| `sage.quota-guard` | every 10 min | 0 (database only) | stops posting at 90% of the daily budget |
| `sage.keepalive` | 03:00 daily | 1-2 | refresh token keep-alive; prevents the 31-day idle death |

Daily cost is roughly 25% of the 2,500/day quota at normal volume, and the reconciliation runs on the
`reconcile` class so a busy posting day cannot starve it.

A run is **stale** after 26 hours and surfaces as `degraded` on `/api/health`; two missed runs are an
alert. A stale reconciliation is itself a finding, because "no findings" and "no run" look identical
in a dashboard otherwise.

---

## 8. Cutover mode

The same checks run before the switch, with a different baseline and no postings of ours yet.

1. **Capture the legacy baseline.** Signed Sage 50 reports: aged receivables and payables by contact,
   trial balance, tax collected by code and period. Stored with the snapshot id, the date, and the
   person who pulled them.
2. **Load contacts and opening balances.** Each load is a posting of kind `opening_balance` with
   `external_ref = cutover:<snapshotId>:<contactId>` and `migrated = true` where the API exposes it.
   Load twice in the sandbox; the second run must change nothing.
3. **Compare totals.** Sum of loaded opening balances per contact versus the aged report, to the
   cent. Sum of the trial balance positions versus the opening journals. Any difference fails the
   cutover, and the report names the contact and the amount.
4. **Decide open documents.** If the client chooses to reissue open invoices and bills (§1.2 item 2
   of `SAGE-CLOUD.md`), each gets `external_ref = cutover-open:<legacyDocId>`, and the sum of
   reissued open items plus written-off items must equal the signed aged total. If the client
   chooses archive-only, no documents are reissued and the check is the balance comparison alone.
5. **Freeze and switch.** After the legacy posting path stops, run the daily checks with
   `mode=cutover` until the first real invoice posts, then `mode=daily`.

The cutover report is the artefact the finance owner signs; the migration harness's parity report and
this one are kept together, because they answer different questions (data moved correctly / money
still agrees).

---

## 9. What this does not do

- It does not compare our internal `app` accounting to the ledger for *work orders, quotes, POs or
  inventory* — those are not ledger objects. Their parity is the migration harness's job.
- It does not reconcile bank or credit-card accounts; that is the accountant's statement
  reconciliation inside Sage, and duplicating it would produce a second, competing truth.
- It does not poll on every page view. A reconciliation that runs in a request is a reconciliation
  that costs quota per click.
- It does not treat the ledger as authoritative about what we billed, or our snapshot as
  authoritative about what is recorded. It reports the difference and asks a human.

---

## 10. Acceptance for the implementation

- All six checks run against the fake adapter with scripted faults, and each produces its intended
  finding code (unit-level, no network).
- A forced timeout after a successful POST produces `MISSING_IN_SAGE` on the first run, then a link
  and no finding on the second, without a second ledger document.
- A tampered amount in the fake produces `AMOUNT_MISMATCH` naming the document and both values.
- A deleted invoice produces `DELETED_IN_SAGE` and does not re-post.
- A run with a blocker reports `failed`; a run with only decided warnings reports `passed`.
- The daily job stays inside its quota class on a simulated 400-document day.
- The cutover mode loads opening balances twice into the sandbox with zero net change and a zero-cent
  difference against the baseline file.
