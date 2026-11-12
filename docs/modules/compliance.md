# Compliance

`/compliance` is the first-class WSIB/insurance screen. Master Data still owns
the vendors and document uploads; this module reads them and presents the
operational view without duplicating the document store.

## What the screen shows

- **Subcontractor status** — the latest current (not superseded) WSIB and
  insurance document per vendor, with a valid / expiring / expired / missing
  state and days remaining. A vendor with zero documents is **missing**, never
  valid.
- **Assignment gate** — valid when either a current WSIB or insurance document
  is unexpired, matching `getSubcontractorWsibState` and the Work Orders WSIB
  hold. A vendor with both missing/expired is held.
- **Expiry dashboard** — only the windows Master Data queues reminders for:
  30, 14, 7, 1 and 0 days, plus already expired. A document 20 days out shows as
  expiring but its reminder fires on day 14; the dashboard is a view, not a
  second reminder engine.
- **Work orders without valid coverage** — open work orders (the Work Orders
  `OPEN_STATUSES` set) assigned to a held subcontractor. This is the row set the
  WSIB hold blocks.
- **WSIB override grants** — rows in `app.user_permissions` for
  `workorder:override_wsib_hold`, including the scope vendor and the grant
  `note`, which is the reason recorded with the permission.
- **Recent override use** — `app.audit_log` entries whose summary records a
  WSIB/insurance override, with actor, work order, time and the audit summary as
  the visible reason. The Work Orders module writes the bypass summary in the
  same transaction as the assignment.
- **Site warranty expiry** — `app.site_warranties` rows with an expiry date,
  their site/customer, source work order and the same expiry state. Warranties
  are created from RGA and remain editable in Master Data.

## Reminder jobs

`apps/web/src/modules/compliance/server/jobs.server.ts` registers both
catalogue entries through `@cls/core/jobs` in `start.ts`:

| Job | Handler |
|---|---|
| `compliance.document-expiry` | `runExpiryRemindersInTx` — one reminder row per document and window, deduped by `(document_id, window_days)`. |
| `compliance.wsib-reminders` | The legacy WSIB track: runs the same idempotent sweep and reports ten-day warning and expired counts. |

Both return `skipped` with `{reason:'dry_run'}` during a cutover dry run. A
second run on the same business day inserts nothing and reports 0 processed.
The catalogue entries are marked `registered` because the handlers now exist.

## Tests

`compliance.integration.test.ts` seeds four subcontractors — valid, expired,
zero-document, and one whose WSIB is 7 days out and insurance 30 days out — plus
a blocked work order, an override grant with a reason, an override audit entry
and a warranty. It asserts each state, window, blocked row, grant/audit reason,
warranty state, and that both handlers register idempotently, queue only the
exact reminder windows, and dedupe on a second run. Everything rolls back; no
schema is created.

The signed-in E2E seeds one WSIB document seven days out, opens `/compliance`,
checks the vendor row and the 7-day dashboard, and cleans up.
