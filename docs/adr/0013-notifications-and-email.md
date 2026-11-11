# ADR 0013 — Notifications and email

- **Status:** Accepted
- **Date:** 2026-11-11
- **Owners:** Platform, with module owners (Purchasing, Work Orders, Quotes, Compliance, Finance)
- **Repo target:** `packages/notifications/` (`@cls/notifications`),
  `packages/db/src/schema/app/notifications.ts`, `apps/web/src/routes/api/internal/jobs/*`
- **Relates to:** ADR 0012 (jobs runner), ADR 0004 (auth/RBAC), ADR 0011 (PDF attachments),
  `green-system/MODULES.md` §13

> **Post-D18 amendment (2026-11-11).** The rebuild now runs on a serverless host (ADR 0014). Three
> things tighten and nothing reverses: the outbox stays the single path to a mail provider and the
> drain job stays the only sender. (1) **A send must be awaited inside the invocation.** A
> serverless function pauses background work after it responds, so fire-and-forget loses mail
> mid-handshake; each drain invocation sends a bounded batch (25 messages), awaits every send, and
> returns counts, leaving the rest for the next tick. (2) **Outbound SMTP works on ports 465/587
> and not 25**, which suits the Office 365 STARTTLS endpoint; an HTTP provider API is the preferred
> swap if SMTP proves unreliable. (3) **The transport interface is unchanged**, so `memory` in
> tests, `file` locally and a provider API in production differ only in one adapter.

## Context

Email is not a garnish in this business: dispatch confirmations, purchase-order follow-ups,
subcontractor reminders and supplier messages are how work moves. The legacy implementation works
and is unsafe in five specific ways:

1. **Per-user mailboxes with passwords in the database.** PHPMailer connects to
   `smtp.office365.com:587` with TLS using `users.mailing_user` / `users.mailing_password` and
   `cls_mailing_*`, i.e. a plaintext mailbox password per user, in the same MySQL database as the
   invoices. There are also hard-coded fallback credentials and hard-coded `From` addresses in
   code.
2. **The queue is a directory.** `queuePHPMailerToFile()` writes a message file under
   `./failed_emails` tagged with a record id and a template label
   (`InTransit2ReceivedPOmail`, `CancelPOmail`, `DispatchReminderEmail`, …), and `sendEmailQueue()`
   drains it. `retry_emails.php` retries by walking files. Nothing is queryable, nothing records a
   permanent failure, and a retry re-sends whatever the file contains.
3. **Confirmation links are identifiers.** `messages_links`, `messages_links_po`,
   `email_messages_to_sub` and `sub_stock_*` put raw ids in URLs (`emrID`, `subemailKey`,
   `stockmsgID`, `overdueID`), and the action is applied *at login* as a side effect. There is no
   signature, no expiry, no one-time use, and no record of which link caused which change.
4. **Recipients come from whatever the caller passed.** Free-text addresses, BCCs to a fixed
   internal address, and no check for a disabled user or a missing contact.
5. **Failures are silent.** A bad mailbox password surfaces as a file in a directory nobody reads;
   the sender sees "sent" because the function returned.

The rebuild already has the seed of a better model: `app.work_order_notifications`
(`apps/web/src/modules/work-orders/server/notifications.server.ts`) stores `event`, `channel`,
`recipient`, `subject`, `body`, `status` (`queued | sent | failed | skipped`), `error` and `sentAt`.
That is the right shape and the wrong scope: it is work-order specific, has no dedupe key, no
attempt counter, no next-attempt time and no template version.

## Decision

1. **One package owns sending.** `@cls/notifications` holds the transport, the templates, the
   outbox, the recipient resolver and the link signer. Modules import functions from it; they never
   import a mail library, never build SMTP options, and never send inside a request transaction.

2. **One sender identity from environment.** `MAIL_TRANSPORT` (`smtp | file | memory`),
   `MAIL_HOST`, `MAIL_PORT`, `MAIL_SECURE`, `MAIL_USER`, `MAIL_PASSWORD`, `MAIL_FROM`,
   `MAIL_REPLY_TO`, and a non-production `MAIL_OVERRIDE_TO` sink. There is no per-user mailbox and
   **no user mail credential in the database**. Legacy mail passwords are not migrated, and their
   owners are told to rotate them, because they have been stored in plaintext.

3. **Durable outbox, generalising the table that exists.** `app.notifications`:

   | Column | Purpose |
   |---|---|
   | `id`, `created_at`, `created_by` | audit |
   | `kind` | `dispatch | po-followup | rga | quote | dunning | compliance | supplier | system` |
   | `template_key`, `template_version` | which code produced this message |
   | `entity_type`, `entity_id` | work order, purchase order, invoice, quote, subcontractor document |
   | `recipient_user_id`, `recipient_email`, `recipient_name` | resolved at queue time |
   | `subject`, `body_text`, `body_html` | rendered snapshot, so a sent message is reproducible |
   | `payload` (jsonb) | typed input, for re-render and support |
   | `dedupe_key` (unique) | e.g. `po-followup:1234:2026-11-11` |
   | `status` | `queued | sending | sent | failed | skipped | suppressed` |
   | `attempts`, `next_attempt_at`, `last_error_code`, `last_error` | retry state |
   | `provider_message_id`, `sent_at` | delivery evidence |

   `work_order_notifications` is superseded: it becomes a compatibility view over
   `app.notifications` filtered to `entity_type = 'work_order'`, and the migration moves its rows
   once, at that module's cutover, preserving `id` in `legacy_ref`.

4. **Templates are code, versioned, and rendered once.** Each template is a pure
   `payload → { subject, text, html }` function with a stable `key` and an integer `version`, tested
   against fixture payloads (including the TJX fixture shapes used by the money tests). The
   rendered snapshot and version are stored, so changing a template never rewrites history.

5. **Delivery is a job, not a request.** The outbox is drained by
   `platform.notifications-drain` (ADR 0012): claim with `FOR UPDATE SKIP LOCKED` on
   `status = 'queued' AND next_attempt_at <= now()`, mark `sending`, send, mark `sent` with the
   provider id, or `failed` with a classified error. Backoff 1 m, 5 m, 30 m, 2 h, 6 h, maximum five
   attempts; an SMTP 5xx or an invalid-recipient response is permanent and fails immediately.
   A crash mid-send is handled by a `sending` claim older than two minutes returning to `queued`
   with the attempt counted, which can duplicate in the worst case — the dedupe key plus the
   provider id check make that visible rather than invisible.

6. **Links replace identifiers.** Confirmation and action links are signed, expiring, and
   single-purpose:

   - token = base64url(payload) + "." + HMAC-SHA-256(payload, `NOTIFICATION_LINK_SECRET`)
   - payload = `{ purpose, entityType, entityId, recipientUserId, expiresAt, nonce }`
   - the hash is stored in `app.notification_links` with `used_at` and `revoked_at`
   - view links expire in 14 days; actionable approvals (accept a change, confirm a receipt)
     expire in 72 hours and are one-time
   - **login never applies an action.** A link resolves to the item after authentication, and the
     action is an explicit, audited request, so a forwarded email cannot mutate a record
   - no email address, legacy id or MD5 appears in a URL

7. **Recipients are derived, not passed.** The resolver reads the record: site customer contact,
   subcontractor contacts, supplier contacts, the responsible purchaser, the dispatch contact. A
   disabled user (278 of 368 legacy users are disabled) receives nothing. A subcontractor with no
   email on file produces a `skipped: no-recipient` row that appears in the dispatch queue as work
   for a human — never a silent drop, and never a fallback to a hard-coded address. This matters
   for the 339 subcontractor accounts, whose field staff must not be locked out of receiving
   paperwork.

8. **Audit and privacy.** Each record shows its notification timeline with status, attempt count and
   the error code. Only an administrator can retry, and a retry writes an attempt row. Application
   logs carry ids and status, never a recipient address, a subject or a body. Bodies are retained
   24 months, then purged while metadata is kept.

9. **Attachments go through `@cls/pdf`.** A purchase order or invoice email renders the PDF from the
   same view model as the download (ADR 0011) and stores the object key; the outbox row references
   it. No template builds its own PDF.

10. **Tests never send mail.** `memory` transport in unit and integration tests with assertions on
    outbox rows and rendered output; `file` transport in local development writing `.eml` under
    `var/mail`; `MAIL_OVERRIDE_TO` redirects every message to one sink outside production and adds
    a visible banner line naming the intended recipient.

11. **Inbound is out of scope.** Supplier replies are not read by IMAP in this phase. The supplier
    message thread stores outbound messages and lets an operator paste a reply; automated inbound
    parsing is a separate decision with its own risk.

## Alternatives considered

1. **Keep PHPMailer and the per-user mailbox model.** Rejected: plaintext credentials in a database
   that also holds the ledger, one Office 365 throttle per user, no rotation path, and it is the
   direct cause of the silent failures. A shared sender with a per-module `Reply-To` is both simpler
   and more deliverable.
2. **Send synchronously inside the request.** Rejected: a nine-second SMTP negotiation in the
   middle of saving a PO, no retry when the send fails, and an email that is sent while the database
   transaction may still roll back.
3. **Send through a transactional email vendor (Brevo, SendGrid, Postmark).** Rejected for now, not
   forever: the vendor is undecided, the host is LAN-only, and moving customer names and invoice
   amounts to a third party is a decision the human has to make. The transport interface makes the
   swap one file, and the outbox means no message is lost while that decision waits.
4. **Keep the file queue with a database index.** Rejected: files are not queryable, cannot hold
   retry state, and a retry re-sends a stale body.
5. **Reuse `work_order_notifications` unchanged for every module.** Rejected: no dedupe key, no
   attempts, no template version, and a per-module table would multiply the same columns five
   times. One general table with a typed `kind` and a compatibility view is smaller.
6. **Put ids in links and apply the action at login, as legacy does.** Rejected: the current
   behaviour means a single clicked URL changes business data with no signature, no expiry and no
   audit. Signed one-time tokens cost one table and remove that class of bug.

## Consequences

- **Positive:** one place to see whether any message was sent, failed or skipped, with the rendered
  body preserved.
- **Positive:** no mailbox password exists in the rebuild, so the credential class of incident is
  gone; rotating the sender password is one environment change.
- **Positive:** reminders become testable: a fixture record produces an outbox row with a known
  dedupe key, and the assertions are database reads, not network calls.
- **Negative:** a shared sender means every message comes from one address. Per-module `Reply-To`
  and a `kind` label mitigate confusion; anyone who needs a personal From must use their own mail
  client.
- **Negative:** the outbox needs supervision. A permanently failing recipient is visible but
  requires a human; that is the intended trade against silent failure.
- **Negative:** the 24-month body retention and the purge job are new operational duties.
- **Risk:** deliverability through Office 365 depends on SPF/DKIM being correct for the sending
  domain. The `From` must be a tenant-authorised shared mailbox; a test send to the sink is part of
  the deployment checklist, not an afterthought.

## Verification

- Unit tests: dedupe key uniqueness; backoff sequence; permanent vs transient error
  classification; template version stored with the snapshot; recipient resolver excludes disabled
  users and records `skipped: no-recipient`; signed link rejects tampering, expiry, replay and
  revocation.
- Integration tests with the `memory` transport: queue → drain job → `sent`, and a retry after a
  simulated 4xx reaching the next attempt time; a duplicate queue call writes one row.
- A manual smoke against the sink (`MAIL_OVERRIDE_TO`) proves SMTP credentials, TLS and `From`
  authorisation before the first production reminder job is enabled.
- The cutover rehearsal asserts that notification rows written during the rehearsal are tagged with
  the run id and deleted afterwards, and that no message left the host.
