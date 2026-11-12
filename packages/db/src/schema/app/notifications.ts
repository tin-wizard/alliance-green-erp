import {
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { app } from './base'

/**
 * Notification outbox (ADR 0013).
 *
 * One row is one rendered message. Queueing is part of the caller's transaction;
 * the drain job is the only sender. Bodies are snapshots so a template change
 * never rewrites history.
 */
export const notificationStatus = app.enum('notification_status', [
  'queued',
  'sending',
  'sent',
  'failed',
  'skipped',
  'suppressed',
])

export const notifications = app.table(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    templateKey: text('template_key').notNull(),
    templateVersion: integer('template_version').notNull().default(1),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    recipientUserId: uuid('recipient_user_id'),
    recipientEmail: text('recipient_email'),
    recipientName: text('recipient_name'),
    subject: text('subject').notNull(),
    bodyText: text('body_text').notNull(),
    bodyHtml: text('body_html'),
    payload: jsonb('payload').$type<Record<string, unknown> | null>(),
    /** Unique when present; the first queue call wins. */
    dedupeKey: text('dedupe_key'),
    status: notificationStatus('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastErrorCode: text('last_error_code'),
    lastError: text('last_error'),
    providerMessageId: text('provider_message_id'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    /** Legacy domain row this outbox row mirrors, e.g. `work_order_notifications:12`. */
    legacyRef: text('legacy_ref'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('notifications_dedupe_unique').on(table.dedupeKey),
    index('notifications_status_due_idx').on(table.status, table.nextAttemptAt),
    index('notifications_recipient_idx').on(table.recipientUserId, table.readAt),
    index('notifications_entity_idx').on(table.entityType, table.entityId),
    index('notifications_created_idx').on(table.createdAt),
    index('notifications_kind_idx').on(table.kind),
  ],
)

/**
 * Signed, expiring action links. Only the hash is stored; the token itself is
 * in the message. Login never applies an action (ADR 0013 §6).
 */
export const notificationLinks = app.table(
  'notification_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    purpose: text('purpose').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    recipientUserId: uuid('recipient_user_id'),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('notification_links_token_unique').on(table.tokenHash),
    index('notification_links_entity_idx').on(table.entityType, table.entityId),
    index('notification_links_expiry_idx').on(table.expiresAt),
  ],
)

export type Notification = typeof notifications.$inferSelect
export type NewNotification = typeof notifications.$inferInsert
export type NotificationLink = typeof notificationLinks.$inferSelect
