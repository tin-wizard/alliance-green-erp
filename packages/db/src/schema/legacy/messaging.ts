// @generated
// Source: packages/db/contract/schema.json (2026-11-11).
// Do not edit by hand. Run `pnpm db:generate:schema` after updating the contract.
// Domain: messaging

import { integer, pgEnum, pgTable, serial, smallint, text, timestamp, varchar } from 'drizzle-orm/pg-core'
export const legacyEnumSubStockMessagesUsertype = pgEnum('legacy_sub_stock_messages_usertype', ["", "sub", "admin"])

/**
 * customer_emails — Additional customer e-mail addresses.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyCustomerEmails = pgTable(
  'customer_emails',
  {
    id: serial('id').primaryKey(),
    email: varchar('email', { length: 200 }),
    name: varchar('name', { length: 50 }),
  },
)

/**
 * email_messages_to_sub — Outbound e-mail log to subcontractors.
 * Rows observed: 352. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyEmailMessagesToSub = pgTable(
  'email_messages_to_sub',
  {
    id: serial('id').primaryKey(),
    senderId: integer('sender_id').notNull(),
    sender: varchar('sender', { length: 50 }),
    subid: integer('subid').notNull(),
    receiverEmails: varchar('receiver_emails', { length: 200 }).notNull(),
    subject: varchar('subject', { length: 200 }).notNull(),
    datetime: integer('datetime').notNull(),
    message: text('message').notNull(),
    fileAttachments: text('file_attachments'),
    parentId: integer('parent_id'),
    confirmationKey: text('confirmation_key'),
  },
)

/**
 * messages — Internal portal message inbox (sender/receiver/subject/body/read flag).
 * Rows observed: 17280. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyMessages = pgTable(
  'messages',
  {
    id: serial('id').primaryKey(),
    sender: varchar('sender', { length: 100 }).notNull(),
    receiver: varchar('receiver', { length: 100 }).notNull(),
    subject: varchar('subject', { length: 100 }).notNull(),
    datetime: varchar('datetime', { length: 100 }).notNull(),
    message: text('message').notNull(),
    read: smallint('read').notNull(),
  },
)

/**
 * messages_links — E-mailed confirmation links tied to a WO (key, responded flag).
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyMessagesLinks = pgTable(
  'messages_links',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid'),
    confirmationKey: text('confirmation_key'),
    messageText: text('message_text'),
    messageTitle: varchar('message_title', { length: 100 }),
    date: timestamp('date', { mode: 'string', withTimezone: false }),
    isResponded: integer('is_responded'),
  },
)

/**
 * messages_links_po — Same for purchase orders.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyMessagesLinksPo = pgTable(
  'messages_links_po',
  {
    id: serial('id').primaryKey(),
    poid: integer('poid'),
    confirmationKey: text('confirmation_key'),
    messageText: text('message_text'),
    messageTitle: varchar('message_title', { length: 100 }),
    date: timestamp('date', { mode: 'string', withTimezone: false }),
    isResponded: integer('is_responded'),
  },
)

/**
 * sub_stock_messages — Stock messages shown to subcontractors in their portal.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacySubStockMessages = pgTable(
  'sub_stock_messages',
  {
    id: serial('id').primaryKey(),
    notificationId: integer('notification_id'),
    subid: integer('subid'),
    userid: integer('userid'),
    usertype: legacyEnumSubStockMessagesUsertype('usertype'),
    username: varchar('username', { length: 30 }),
    messageSubject: text('message_subject'),
    messageText: text('message_text').notNull(),
    isRead: smallint('is_read'),
    isReadBy: integer('is_read_by'),
    dateCreated: timestamp('date_created', { mode: 'string', withTimezone: false }),
    confirmationKey: varchar('confirmation_key', { length: 50 }),
  },
)

/**
 * sub_stock_notification — Stock notification subscriptions.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacySubStockNotification = pgTable(
  'sub_stock_notification',
  {
    id: serial('id').primaryKey(),
    userid: integer('userid'),
    subid: integer('subid'),
    containStock: integer('contain_stock'),
    notificationCode: varchar('notification_code', { length: 10 }).notNull(),
    dateCreated: timestamp('date_created', { mode: 'string', withTimezone: false }),
    isResponded: integer('is_responded'),
    stockfilename: varchar('stockfilename', { length: 50 }),
  },
)
