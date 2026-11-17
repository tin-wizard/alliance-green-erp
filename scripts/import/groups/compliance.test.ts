/**
 * Group 5 — compliance and documents.
 *
 * Pinned here: a WSIB file becomes a subcontractor document with its expiry and
 * upload time, an unknown document type is not guessed, a document whose vendor
 * does not exist is recorded instead of attached to an invented vendor, and both
 * warranty sources land on `app.site_warranties` with the part identity preserved
 * in the description.
 */
import { and, eq, like, sql } from 'drizzle-orm'
import { afterAll, describe, expect, test, vi } from 'vitest'
import { getDb } from '@cls/db'
import { getConfig } from '@cls/core/env.server'
import {
  migrationExceptions,
  migrationRowMap,
  sites,
  siteWarranties,
  subcontractorDocuments,
  subcontractors,
} from '@cls/db/schema'
import { runTransformerRow } from '../testing'
import { transformer } from './compliance'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })

const configured = (() => {
  try {
    return Boolean(process.env.DATABASE_URL ?? getConfig().databaseUrl)
  } catch {
    return Boolean(process.env.DATABASE_URL)
  }
})()

const marker = `cm${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
const dumpId = `test-dump-${marker}`

const base = 1_500_000_000 + Math.floor(Math.random() * 900_000)
const subcontractorId = base
const siteId = base + 2
const uploadedSeconds = 1_700_000_000

async function transform(table: string, sourceKey: string, row: Record<string, string | null>) {
  await getDb().transaction(async (tx) => {
    await runTransformerRow(tx, transformer, { group: 'compliance', table, sourceKey, row, dumpId })
  })
}

async function exceptionFor(exceptionClass: string, entity: string, sourceKey: string) {
  const [row] = await getDb()
    .select()
    .from(migrationExceptions)
    .where(
      and(
        eq(migrationExceptions.exceptionClass, exceptionClass),
        eq(migrationExceptions.entity, entity),
        eq(migrationExceptions.sourceKey, sourceKey),
      ),
    )
    .limit(1)
  return row ?? null
}

async function crosswalkFor(entity: string, sourceKey: string) {
  const [row] = await getDb()
    .select()
    .from(migrationRowMap)
    .where(and(eq(migrationRowMap.entity, entity), eq(migrationRowMap.sourceKey, sourceKey)))
    .limit(1)
  return row ?? null
}

afterAll(async () => {
  if (!configured) return
  const db = getDb()
  await db
    .delete(subcontractorDocuments)
    .where(eq(subcontractorDocuments.subcontractorId, subcontractorId))
  await db.delete(siteWarranties).where(eq(siteWarranties.siteId, siteId))
  await db.delete(sites).where(eq(sites.id, siteId))
  await db.delete(subcontractors).where(eq(subcontractors.id, subcontractorId))
  await db.delete(migrationRowMap).where(like(migrationRowMap.sourceKey, `%${marker}%`))
  await db.delete(migrationExceptions).where(like(migrationExceptions.sourceKey, `%${marker}%`))
  // The whole-table skip is keyed by table name, so it is not covered by the marker.
  await db
    .delete(migrationExceptions)
    .where(
      and(
        eq(migrationExceptions.exceptionClass, 'not_migrated'),
        eq(migrationExceptions.entity, 'signoff_cron'),
      ),
    )
})

describe.skipIf(!configured)('compliance group', () => {
  test('a WSIB document keeps its expiry and learns its upload time', async () => {
    const db = getDb()
    await db.insert(subcontractors).values({ id: subcontractorId, name: `Sub ${marker}` })

    const sourceKey = `wsib:${marker}:1`
    await transform('subcontractor_wsib_insurance_documents', sourceKey, {
      id: '1',
      subid: String(subcontractorId),
      document_type: 'wsib',
      document_name: 'WSIB clearance 2024',
      file_name: `wsib-${marker}.pdf`,
      is_expired: '0',
      expiration_timespan: '365',
      expiration_date: '2025-03-31',
      uploaded_timespan: String(uploadedSeconds),
      near_expire_reminder_done: '1',
      send_email_to_sub: '1',
      email_sent_success: '1',
      last_reminder_date: '2025-03-01',
    })

    const [row] = await db
      .select()
      .from(subcontractorDocuments)
      .where(eq(subcontractorDocuments.fileName, `wsib-${marker}.pdf`))
    expect(row?.subcontractorId).toBe(subcontractorId)
    expect(row?.kind).toBe('wsib')
    expect(row?.expiresOn).toBe('2025-03-31')
    expect(row?.isExpired).toBe(false)
    // The unix stamp is a real instant, not a zero date.
    expect(row?.uploadedAt.toISOString()).toBe(new Date(uploadedSeconds * 1000).toISOString())
    // A filesystem path is never a storage key.
    expect(row?.storageKey).toBeNull()
    expect(await crosswalkFor('subcontractor_wsib_document', sourceKey)).not.toBeNull()
  })

  test('the legacy WSIB-WCB type becomes the wsib kind and keeps its original text', async () => {
    const db = getDb()
    const sourceKey = `wsib:${marker}:5`
    await transform('subcontractor_wsib_insurance_documents', sourceKey, {
      id: '5',
      subid: String(subcontractorId),
      document_type: 'WSIB-WCB',
      document_name: 'WSIB-WCB clearance',
      file_name: `wcb-${marker}.pdf`,
      is_expired: '0',
      expiration_date: '2099-01-01',
      uploaded_timespan: String(uploadedSeconds),
    })
    const [row] = await db
      .select()
      .from(subcontractorDocuments)
      .where(eq(subcontractorDocuments.fileName, `wcb-${marker}.pdf`))
    expect(row?.kind).toBe('wsib')
    expect(row?.documentType).toBe('WSIB-WCB')
    // It is a known spelling, so it is not logged as an unknown value.
    expect(await exceptionFor('unknown_enum', 'subcontractor_wsib_document', sourceKey)).toBeNull()
  })

  test('an unknown document type is not guessed', async () => {
    const db = getDb()
    const sourceKey = `wsib:${marker}:2`
    await transform('subcontractor_wsib_insurance_documents', sourceKey, {
      id: '2',
      subid: String(subcontractorId),
      document_type: 'safety-letter',
      document_name: 'Safety letter',
      file_name: `safety-${marker}.pdf`,
      is_expired: '0',
      expiration_date: '',
      uploaded_timespan: '0',
    })

    const [row] = await db
      .select()
      .from(subcontractorDocuments)
      .where(eq(subcontractorDocuments.fileName, `safety-${marker}.pdf`))
    expect(row?.kind).toBe('other')
    // `uploaded_at` is NOT NULL, so a zero stamp becomes the migration time and
    // the decision is recorded; it is never 1970 and never silently dropped.
    expect(row?.uploadedAt.getUTCFullYear()).toBeGreaterThan(2020)
    const zero = await exceptionFor('zero_date', 'subcontractor_wsib_document', sourceKey)
    expect(zero?.migrationAction).toContain('uploaded_at is NOT NULL')
  })

  test('a document whose vendor is missing is recorded, not invented', async () => {
    const db = getDb()
    const sourceKey = `wsib:${marker}:3`
    const before = (
      await db
        .select({ count: sql<number>`count(*)::int` })
        .from(subcontractorDocuments)
        .where(eq(subcontractorDocuments.fileName, `orphan-${marker}.pdf`))
    )[0]!.count

    await transform('subcontractor_wsib_insurance_documents', sourceKey, {
      id: '3',
      subid: String(base + 777),
      document_type: 'insurance',
      document_name: 'Insurance',
      file_name: `orphan-${marker}.pdf`,
      is_expired: '1',
      expiration_date: '2024-01-01',
      uploaded_timespan: String(uploadedSeconds),
    })

    const after = (
      await db
        .select({ count: sql<number>`count(*)::int` })
        .from(subcontractorDocuments)
        .where(eq(subcontractorDocuments.fileName, `orphan-${marker}.pdf`))
    )[0]!.count
    expect(after).toBe(before)
    const orphan = await exceptionFor(
      'subcontractor_without_vendor',
      'subcontractor_wsib_document',
      sourceKey,
    )
    expect(orphan?.notes).toContain(String(base + 777))
  })

  test('an additional document has no type column and is stored as other', async () => {
    const db = getDb()
    const sourceKey = `additional:${marker}:4`
    await transform('subcontractor_additional_documents', sourceKey, {
      id: '4',
      subid: String(subcontractorId),
      document_name: 'W-9',
      file_name: `w9-${marker}.pdf`,
      document_notes: 'expires when the entity changes',
      uploaded_timespan: String(uploadedSeconds),
    })

    const [row] = await db
      .select()
      .from(subcontractorDocuments)
      .where(eq(subcontractorDocuments.fileName, `w9-${marker}.pdf`))
    expect(row?.kind).toBe('other')
    expect(row?.documentType).toBe('additional')
    expect(await crosswalkFor('subcontractor_document', sourceKey)).not.toBeNull()
  })

  test('a site warranty keeps its notes and expiry', async () => {
    const db = getDb()
    await db.insert(sites).values({ id: siteId, name: `Site ${marker}` })

    await transform('site_warranty', `site_warranty:${marker}:5`, {
      id: '5',
      site_id: String(siteId),
      warranty_notes: 'Roof warranty, 10 years',
      expiration_timespan: '3650',
      expiration_date: '2030-06-30',
    })

    const [row] = await db.select().from(siteWarranties).where(eq(siteWarranties.siteId, siteId))
    expect(row?.description).toBe('Roof warranty, 10 years')
    expect(row?.expiresOn).toBe('2030-06-30')
    expect(row?.workOrderId).toBeNull()
  })

  test('a material warranty folds part and type into the description', async () => {
    const db = getDb()
    await transform('material_warranty', `material_warranty:${marker}:6`, {
      id: '6',
      partno: 'LED-2X4',
      partdesc: 'LED panel 2x4',
      // A real legacy work order has id 999999, so use an id the dump never issues.
      woid: String(base + 998),
      site_id: String(siteId),
      warranty_type: 'warranty',
      start_date: '2024-01-01',
      expiration_date: '2029-01-01',
    })

    const rows = await db.select().from(siteWarranties).where(eq(siteWarranties.siteId, siteId))
    const material = rows.find((row) => row.expiresOn === '2029-01-01')
    expect(material?.description).toBe('warranty — LED-2X4 — LED panel 2x4')
    // The work order does not exist yet at group-5 time, so no FK is invented.
    expect(material?.workOrderId).toBeNull()
  })

  test('the sign-off cron queue is not migrated', async () => {
    const db = getDb()
    const before = (await db.select({ count: sql<number>`count(*)::int` }).from(siteWarranties))[0]!
      .count
    await transform('signoff_cron', `signoff_cron:${marker}:7`, {
      id: '7',
      woid: String(base + 999),
      is_processed: '1',
      timespan_uploaded: String(uploadedSeconds),
      timespan_processed: String(uploadedSeconds + 60),
      signature_found: '1',
      is_reviewed: '1',
    })
    const after = (await db.select({ count: sql<number>`count(*)::int` }).from(siteWarranties))[0]!
      .count
    expect(after).toBe(before)
    // The skip is a documented decision, not an exception per row.
    expect(transformer.unmapped?.['signoff_cron.*']).toContain('transient')
    const skipped = await exceptionFor('not_migrated', 'signoff_cron', 'signoff_cron')
    expect(skipped?.migrationAction).toContain('sign-off extraction queue')
  })
})
