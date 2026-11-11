import {
  integer,
  jsonb,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { app } from './base'

/**
 * Platform record for generated documents (ADR 0011).
 *
 * The snapshot is the regeneration source: financial documents are rebuilt from
 * this JSON, never from live business rows, so a later price or address edit
 * cannot change an issued PDF.
 */
export const generatedDocuments = app.table('generated_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  schemaVersion: integer('schema_version').notNull(),
  rendererVersion: text('renderer_version').notNull(),
  storageBucket: text('storage_bucket').notNull(),
  storageKey: text('storage_key').notNull().unique(),
  sha256: text('sha256').notNull(),
  byteSize: integer('byte_size').notNull(),
  pageCount: integer('page_count'),
  dataSnapshot: jsonb('data_snapshot').notNull().$type<Record<string, unknown>>(),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type GeneratedDocument = typeof generatedDocuments.$inferSelect
