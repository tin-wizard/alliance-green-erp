// @generated
// Source: packages/db/contract/schema.json (2026-11-11).
// Do not edit by hand. Run `pnpm db:generate:schema` after updating the contract.
// Domain: identity

import { integer, pgTable, serial, smallint, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core'


/**
 * users — Portal user master (role in `access`, md5 password, subcontractor link, mailing credentials).
 * Rows observed: 368. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyUsers = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    username: varchar('username', { length: 32 }).notNull(),
    password: varchar('password', { length: 32 }).notNull(),
    // unsalted md5 hex (32 chars)
    email: varchar('email', { length: 50 }).notNull(),
    access: smallint('access').notNull(),
    // role ladder: 1 sub, 2 supplier, 3 tech, 4 office, 6 admin, 9 super
    subid: integer('subid'),
    phone: varchar('phone', { length: 25 }),
    phone2: varchar('phone2', { length: 50 }),
    phone2Ext: varchar('phone2_ext', { length: 10 }),
    email2: varchar('email2', { length: 100 }),
    fullName: text('full_name'),
    mailingUser: varchar('mailing_user', { length: 100 }),
    mailingPassword: varchar('mailing_password', { length: 250 }),
    clsMailingUser: text('cls_mailing_user'),
    clsMailingPassword: text('cls_mailing_password'),
    userAddworkorderWithoutWsib: integer('user_addworkorder_without_wsib'),
    isEnabled: integer('is_enabled'),
    departmentType: varchar('department_type', { length: 15 }),
  },
  (table) => [
    uniqueIndex('legacy_users_username').on(table.username, table.email),
  ],
)
