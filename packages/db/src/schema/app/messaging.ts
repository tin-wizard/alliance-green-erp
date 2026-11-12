import { index, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { app } from './base'

/** Internal staff messages. Not email; the notification outbox is separate. */
export const messageThreads = app.table(
  'message_threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subject: text('subject').notNull(),
    createdBy: uuid('created_by').notNull(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('message_threads_last_message_idx').on(table.lastMessageAt)],
)

export const messageThreadParticipants = app.table(
  'message_thread_participants',
  {
    threadId: uuid('thread_id')
      .notNull()
      .references(() => messageThreads.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    /** Null means the participant has never opened the thread. */
    lastReadAt: timestamp('last_read_at', { withTimezone: true }),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.threadId, table.userId] }),
    index('message_thread_participants_user_idx').on(table.userId),
  ],
)

export const messages = app.table(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => messageThreads.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id').notNull(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('messages_thread_created_idx').on(table.threadId, table.createdAt)],
)

export type MessageThread = typeof messageThreads.$inferSelect
export type Message = typeof messages.$inferSelect
