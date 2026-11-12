import { jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { app } from './base'

/**
 * Typed application settings. The registry in the Admin module decides which
 * keys exist, their type and their default; this table stores the override.
 */
export const settings = app.table('settings', {
  key: text('key').primaryKey(),
  /** `string | number | boolean | json` — validated by the key's definition. */
  valueType: text('value_type').notNull(),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type Setting = typeof settings.$inferSelect
export type NewSetting = typeof settings.$inferInsert
