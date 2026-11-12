# Messaging and notifications

`/messages` combines two things that were separate legacy mechanisms:

- **Internal threads** — staff-to-staff messages. These are not email. A thread
  has participants and an unread count derived from each participant's
  `last_read_at`; the sender's own reply marks the thread read for them.
- **Notification centre** — the messages addressed to the signed-in user from
  the durable outbox, with status, attempt count and the last error.

An administrator (`messages:admin`) also sees the **outbox** tab: every row,
counts by status, the failure text, the next attempt time, and a retry button.
Retry resets a failed/skipped row to queued and writes `notification.retry` to
the audit log. Only the drain job sends.

## Outbox (ADR 0013)

Migration `0011` creates:

- `app.notifications` — rendered snapshot, recipient, dedupe key, status,
  attempts, next attempt, provider id, read state and legacy reference.
- `app.notification_links` — hashed, expiring action tokens (login never applies
  an action).
- `app.message_threads`, `app.message_thread_participants`, `app.messages`.

The migration also copies existing `work_order_notifications` and
`rga_notifications` rows into the general outbox with a `legacy_ref`, so the
centre starts with the messages the old senders already queued. Their domain
tables remain the compatibility source and are now mirrored on every new queue
call:

- Work Orders queues `kind = dispatch`.
- RGA reminders queue `kind = rga`.
- Compliance expiry reminders queue `kind = compliance` with the subcontractor
  contact as recipient; no contact produces a `skipped: no_recipient` row
  instead of a silent drop.

`@cls/notifications` owns the outbox helper, retry policy and transports. Tests
use the memory transport; local development can use `MAIL_TRANSPORT=file`
(`var/mail/*.eml`); production selects `smtp`, which fails visibly until the
provider adapter is installed. The default outside tests is `smtp`, never a
silent memory success.

`platform.notifications-drain` is registered through `@cls/core/jobs`. It claims
up to 25 due rows with `FOR UPDATE SKIP LOCKED`, marks `sending`, awaits every
send and records `sent` with the provider id. Failures back off 1 m / 5 m /
30 m / 2 h / 6 h; after the fifth retry the row is `failed`. A transport error is
stored on the row and shown in the admin outbox.

## Permissions

`messages:read` (admin, technician), `messages:write` (admin, technician) and
`messages:admin` (admin). The seed owns the matrix; run `pnpm db:seed` after
pulling this change.

## Tests

`messaging.integration.test.ts` pins thread unread state per participant,
thread scoping, notification recipient scoping, mark-read, admin-only outbox,
retry and a successful/failed drain with the memory transport. The notifications
package unit tests pin the backoff sequence and the file/memory transports. The
signed-in E2E creates two users, reads a seeded outbox notification, marks it
read, starts a thread and sees the reply view.
