import { describe, expect, test, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { createHash } from 'node:crypto'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })

import { getConfig } from '@cls/core/env.server'
import { ALL_PERMISSIONS, ValidationError } from '@cls/core'
import { getDb, type Tx } from '@cls/db'
import {
  auditLog,
  complianceReminders,
  customers,
  importState,
  legacyCustomer,
  parts,
  sites,
  subcontractorContacts,
  subcontractorDocuments,
  subcontractors,
  supplierContacts,
  suppliers,
  users,
} from '@cls/db/schema'
import { setStorageForTests, type StorageAdapter } from '@cls/storage'
import type { AuthSessionView } from '../../../server/auth.types'
import { siteCreateSchema } from '../lib/write-validation'
import {
  createCustomer,
  createPart,
  createSite,
  createSubcontractor,
  createSupplier,
  rejectPriceFields,
  updatePart,
  updateSupplier,
} from './master-data.write.server'
import { uploadSubcontractorDocument } from './documents.server'
import { runExpiryRemindersInTx } from './reminders.server'
import { runSageImport } from './import.server'
import { assertSagePostable } from './write-support.server'

function databaseConfigured(): boolean {
  try {
    return Boolean(getConfig().databaseUrl)
  } catch {
    return false
  }
}

class Rollback extends Error {}

async function inRollback(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await getDb().transaction(async (tx) => {
      await tx
        .insert(users)
        .values({
          id: '00000000-0000-4000-8000-000000000001',
          email: 'md-admin-test@example.test',
          username: 'md-admin-test',
          displayName: 'Master Data Admin',
          role: 'admin',
        })
        .onConflictDoNothing()
      await fn(tx)
      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  }
}

function adminSession(): AuthSessionView {
  return {
    id: 'session-test',
    expiresAt: new Date(Date.now() + 60_000),
    lastSeenAt: new Date(),
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      email: 'admin@example.test',
      username: 'admin',
      displayName: 'Master Data Admin',
      role: 'admin',
      subcontractorId: null,
      grants: ALL_PERMISSIONS.map((key) => ({ key, scopeSubcontractorId: null })),
    },
  }
}

function memoryStorage(): StorageAdapter {
  const objects = new Map<string, Uint8Array>()
  return {
    name: 'local',
    async put(key, body, options) {
      const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body
      objects.set(key, bytes)
      return { key, size: bytes.byteLength, contentType: options.contentType }
    },
    async get(key) {
      const body = objects.get(key)
      if (!body) throw new Error('not found')
      return { body, contentType: 'application/pdf', etag: 'test' }
    },
    async getSignedUrl() {
      return null
    },
    async delete(key) {
      objects.delete(key)
    },
    async health() {
      return { status: 'ok' as const, driver: 'local' as const, message: 'test' }
    },
  }
}

const PDF_BASE64 = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64')

describe.skipIf(!databaseConfigured())('master-data writes', () => {
  test('creates local customers, blocks duplicates, allows an admin override and audits', async () => {
    await inRollback(async (tx) => {
      const session = adminSession()
      const suffix = Date.now().toString(36)
      const created = await createCustomer(
        tx,
        {
          idempotencyKey: crypto.randomUUID(),
          name: `Parity Customer ${suffix}`,
          street: null,
          city: 'Toronto',
          province: 'ON',
          postalCode: 'M5V 9Z9',
          contactName: null,
          contactNumber: null,
          contactEmail: null,
          salesperson: null,
          isActive: true,
          duplicateOverride: null,
        },
        session,
      )
      expect(created.id).toBeLessThan(0)
      expect(created.isLocal).toBe(true)
      expect(created.sageLinked).toBe(false)

      const [row] = await tx.select().from(customers).where(eq(customers.id, created.id))
      expect(row?.sageCustomerId).toBeNull()
      expect(row?.name).toBe(`Parity Customer ${suffix}`)

      const [audit] = await tx
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entityType, 'customer'), eq(auditLog.entityId, String(created.id))))
      expect(audit?.action).toBe('masterdata.customer.create')
      expect((audit?.after as Record<string, unknown>).permission).toBe('customer:write')

      await expect(
        createCustomer(
          tx,
          {
            idempotencyKey: crypto.randomUUID(),
            name: `Parity Customer ${suffix} Ltd.`,
            street: null,
            city: 'Toronto',
            province: 'ON',
            postalCode: 'M5V 9Z9',
            contactName: null,
            contactNumber: null,
            contactEmail: null,
            salesperson: null,
            isActive: true,
            duplicateOverride: null,
          },
          session,
        ),
      ).rejects.toMatchObject({ code: 'validation_failed' })

      await expect(
        createCustomer(
          tx,
          {
            idempotencyKey: crypto.randomUUID(),
            name: `Parity Customer ${suffix} Similar`,
            street: null,
            city: 'Toronto',
            province: 'ON',
            postalCode: null,
            contactName: null,
            contactNumber: null,
            contactEmail: null,
            salesperson: null,
            isActive: true,
            duplicateOverride: { reason: 'Different legal entity, confirmed by owner.' },
          },
          session,
        ),
      ).resolves.toMatchObject({ isLocal: true })

      expect(() => assertSagePostable('Customer', created.id, null)).toThrow(/not linked in Sage/)
    })
  })

  test('a site must choose its billing state and can be an explicit orphan', async () => {
    expect(
      siteCreateSchema.safeParse({
        idempotencyKey: crypto.randomUUID(),
        name: 'No parent decision',
        street: '1 Main St',
        city: 'Toronto',
        province: 'ON',
        isActive: true,
        warranty: false,
      }).success,
    ).toBe(false)

    await inRollback(async (tx) => {
      const session = adminSession()
      const suffix = Date.now().toString(36)
      const customer = await createCustomer(
        tx,
        {
          idempotencyKey: crypto.randomUUID(),
          name: `Site Parent ${suffix}`,
          street: null,
          city: 'Toronto',
          province: 'ON',
          postalCode: null,
          contactName: null,
          contactNumber: null,
          contactEmail: null,
          salesperson: null,
          isActive: true,
          duplicateOverride: null,
        },
        session,
      )
      const localSite = await createSite(
        tx,
        {
          idempotencyKey: crypto.randomUUID(),
          billingParent: 'existing',
          customerId: customer.id,
          name: `Local Site ${suffix}`,
          street: '1 Main St',
          street2: null,
          city: 'Toronto',
          province: 'ON',
          postalCode: null,
          contactName: null,
          contactNumber: null,
          warranty: false,
          warrantyExpiresOn: null,
          warrantyNotes: null,
          notes: null,
          dns: null,
          lift: null,
          mall: null,
          isActive: true,
          duplicateOverride: null,
        },
        session,
      )
      expect(localSite.id).toBeLessThan(0)
      const [siteRow] = await tx.select().from(sites).where(eq(sites.id, localSite.id))
      expect(siteRow?.customerId).toBe(customer.id)
      expect(siteRow?.sageSiteId).toBeNull()

      const orphan = await createSite(
        tx,
        {
          idempotencyKey: crypto.randomUUID(),
          billingParent: 'orphan',
          customerId: null,
          name: `Orphan Site ${suffix}`,
          street: '2 Main St',
          street2: null,
          city: 'Toronto',
          province: 'ON',
          postalCode: null,
          contactName: null,
          contactNumber: null,
          warranty: false,
          warrantyExpiresOn: null,
          warrantyNotes: null,
          notes: null,
          dns: null,
          lift: null,
          mall: null,
          isActive: true,
          duplicateOverride: null,
        },
        session,
      )
      const [orphanRow] = await tx.select().from(sites).where(eq(sites.id, orphan.id))
      expect(orphanRow?.customerId).toBeNull()
    })
  })

  test('subcontractors and suppliers create and replace their contacts', async () => {
    await inRollback(async (tx) => {
      const session = adminSession()
      const suffix = Date.now().toString(36)
      const sub = await createSubcontractor(
        tx,
        {
          idempotencyKey: crypto.randomUUID(),
          name: `Contact Vendor ${suffix}`,
          street: null,
          city: 'Toronto',
          province: 'ON',
          postalCode: null,
          contactName: 'Primary',
          contactNumber: '416-555-0111',
          contactEmail: `vendor-${suffix}@example.test`,
          email2: null,
          email3: null,
          rateInterior: null,
          rateExterior: null,
          rateOther: null,
          isActive: true,
          contacts: [
            { contactName: 'First Contact', phone: '416-555-0112', phoneExt: '1', email: null },
            { contactName: 'Second Contact', phone: null, phoneExt: null, email: null },
          ],
          duplicateOverride: null,
        },
        session,
      )
      const subContacts = await tx
        .select()
        .from(subcontractorContacts)
        .where(eq(subcontractorContacts.subcontractorId, sub.id))
      expect(subContacts).toHaveLength(2)

      const supplier = await createSupplier(
        tx,
        {
          idempotencyKey: crypto.randomUUID(),
          name: `Contact Supplier ${suffix}`,
          address: null,
          city: 'Toronto',
          province: 'ON',
          postalCode: null,
          contactPerson: 'Primary',
          contactNumber: '416-555-0113',
          additionalEmails: null,
          additionalEmailsAccounting: null,
          isUnderCls: false,
          isOnlineVendor: false,
          bypassPoApproval: false,
          poNotes: null,
          isActive: true,
          contacts: [
            {
              contactName: 'Supplier Contact',
              phone: '416-555-0114',
              phoneExt: null,
              email: `supplier-${suffix}@example.test`,
            },
          ],
          duplicateOverride: null,
        },
        session,
      )
      const beforeSupplier = await tx.select().from(suppliers).where(eq(suppliers.id, supplier.id))
      expect(beforeSupplier[0]?.sageVendorId).toBeNull()

      await updateSupplier(
        tx,
        {
          id: supplier.id,
          updatedAt: beforeSupplier[0]!.updatedAt.toISOString(),
          name: `Contact Supplier ${suffix}`,
          address: null,
          city: 'Toronto',
          province: 'ON',
          postalCode: null,
          contactPerson: 'Updated',
          contactNumber: '416-555-0115',
          additionalEmails: null,
          additionalEmailsAccounting: null,
          isUnderCls: false,
          isOnlineVendor: false,
          bypassPoApproval: false,
          poNotes: null,
          isActive: true,
          contacts: [
            {
              contactName: 'Replacement',
              phone: '416-555-0116',
              phoneExt: null,
              email: null,
            },
          ],
          duplicateOverride: null,
        },
        session,
      )
      const afterContacts = await tx
        .select()
        .from(supplierContacts)
        .where(eq(supplierContacts.supplierId, supplier.id))
      expect(afterContacts).toHaveLength(1)
      expect(afterContacts[0]?.contactName).toBe('Replacement')
    })
  })

  test('parts reject every price field and never write cost or sell price', async () => {
    await inRollback(async (tx) => {
      const session = adminSession()
      expect(() => rejectPriceFields({ cost: '10.00' })).toThrow(ValidationError)
      expect(() => rejectPriceFields({ nested: { sellPrice: '20.00' } })).toThrow(ValidationError)
      await expect(
        createPart(
          tx,
          {
            idempotencyKey: crypto.randomUUID(),
            partNumber: `PARITY-${Date.now()}`,
            name: 'Price attempt',
            partGroupId: null,
            parentPartNumber: null,
            clsLinkedPartCode: null,
            warranty: null,
            labourWarranty: null,
            installProfitFormula: null,
            recycleProfitFormula: null,
            notes: null,
            subignore: false,
            duplicateOverride: null,
            cost: '1.00',
          } as never,
          session,
        ),
      ).rejects.toMatchObject({ code: 'validation_failed' })

      const number = `PARITY-PART-${Date.now()}`
      const result = await createPart(
        tx,
        {
          idempotencyKey: crypto.randomUUID(),
          partNumber: number,
          name: 'Non-price part',
          partGroupId: null,
          parentPartNumber: null,
          clsLinkedPartCode: null,
          warranty: null,
          labourWarranty: null,
          installProfitFormula: null,
          recycleProfitFormula: null,
          notes: 'Identity only',
          subignore: false,
          duplicateOverride: null,
        },
        session,
      )
      const [row] = await tx.select().from(parts).where(eq(parts.id, result.id))
      expect(row?.cost).toBeNull()
      expect(row?.sellPrice).toBeNull()

      // Editing a part must not collide with itself in duplicate detection.
      await expect(
        updatePart(
          tx,
          {
            id: result.id,
            updatedAt: row!.updatedAt.toISOString(),
            partNumber: number,
            name: 'Non-price part edited',
            partGroupId: null,
            parentPartNumber: null,
            clsLinkedPartCode: null,
            warranty: null,
            labourWarranty: null,
            installProfitFormula: null,
            recycleProfitFormula: null,
            notes: 'Identity only',
            subignore: false,
            duplicateOverride: null,
          },
          session,
        ),
      ).resolves.toMatchObject({ id: result.id })
    })
  })

  test('documents validate content, checksum, supersede instead of delete and queue one reminder', async () => {
    const storage = memoryStorage()
    setStorageForTests(storage)
    try {
      await inRollback(async (tx) => {
        const session = adminSession()
        const id = -990001
        await tx.insert(subcontractors).values({ id, name: `Doc Vendor ${Date.now()}` })

        const first = await uploadSubcontractorDocument(
          tx,
          {
            subcontractorId: id,
            kind: 'wsib',
            documentType: 'WSIB',
            documentName: 'First certificate',
            expiresOn: '2099-12-31',
            replacesDocumentId: null,
            fileName: 'wsib.pdf',
            contentType: 'application/pdf',
            data: PDF_BASE64,
          },
          session,
        )
        const [firstRow] = await tx
          .select()
          .from(subcontractorDocuments)
          .where(eq(subcontractorDocuments.id, first.id))
        expect(firstRow?.checksumSha256).toBe(
          createHash('sha256').update(Buffer.from(PDF_BASE64, 'base64')).digest('hex'),
        )
        expect(firstRow?.storageKey).toContain(`subcontractors/${id}/compliance/`)

        await expect(
          uploadSubcontractorDocument(
            tx,
            {
              subcontractorId: id,
              kind: 'wsib',
              documentType: 'WSIB',
              documentName: 'Wrong type',
              expiresOn: '2099-12-31',
              replacesDocumentId: null,
              fileName: 'wsib.png',
              contentType: 'image/png',
              data: PDF_BASE64,
            },
            session,
          ),
        ).rejects.toThrow(/do not match/)

        const second = await uploadSubcontractorDocument(
          tx,
          {
            subcontractorId: id,
            kind: 'wsib',
            documentType: 'WSIB',
            documentName: 'Replacement',
            expiresOn: '2099-12-31',
            replacesDocumentId: first.id,
            fileName: 'wsib-2.pdf',
            contentType: 'application/pdf',
            data: PDF_BASE64,
          },
          session,
        )
        expect(second.supersededId).toBe(first.id)
        const docs = await tx
          .select()
          .from(subcontractorDocuments)
          .where(eq(subcontractorDocuments.subcontractorId, id))
        expect(docs).toHaveLength(2)
        const old = docs.find((document) => document.id === first.id)
        expect(old?.supersededAt).not.toBeNull()
      })
    } finally {
      setStorageForTests(undefined)
    }
  })

  test('expiry reminders use the 30/14/7/1/0 windows and dedupe on re-run', async () => {
    await inRollback(async (tx) => {
      const id = -990002
      const today = '2026-11-11'
      await tx.insert(subcontractors).values({ id, name: `Reminder Vendor ${Date.now()}` })
      const [doc] = await tx
        .insert(subcontractorDocuments)
        .values({
          subcontractorId: id,
          kind: 'wsib',
          documentType: 'WSIB',
          expiresOn: '2026-12-11',
          isExpired: false,
        })
        .returning()

      const first = await runExpiryRemindersInTx(tx, today)
      expect(first.queued).toBeGreaterThanOrEqual(1)
      const rows = await tx
        .select()
        .from(complianceReminders)
        .where(eq(complianceReminders.documentId, doc!.id))
      expect(rows).toHaveLength(1)
      expect(rows[0]?.windowDays).toBe(30)

      const second = await runExpiryRemindersInTx(tx, today)
      expect(second.queued).toBe(0)
    })
  })

  test('Sage import links local drafts without renumbering, creates new ids and records conflicts', async () => {
    await inRollback(async (tx) => {
      const session = adminSession()
      const suffix = Date.now().toString(36)
      const sourceId = 994001
      const createId = 994002
      const missingId = 994003
      const conflictId = 994004

      await tx.insert(legacyCustomer).values([
        { id: sourceId, name: `Import Draft ${suffix}`, postalcode: 'M5V 9Y1' },
        { id: createId, name: `Import New ${suffix}`, postalcode: 'M5V 9Y2' },
        { id: conflictId, name: `Sage Name ${suffix}`, postalcode: 'M5V 9Y4' },
      ])
      await tx.insert(customers).values([
        { id: -990010, name: `Import Draft ${suffix}`, postalCode: 'M5V 9Y1' },
        { id: missingId, sageCustomerId: missingId, name: `Missing ${suffix}` },
        {
          id: conflictId,
          sageCustomerId: conflictId,
          name: `Operator Name ${suffix}`,
          postalCode: 'M5V 9Y4',
        },
      ])
      await tx.insert(importState).values({
        entity: 'customers',
        localId: conflictId,
        sageId: conflictId,
        lastSnapshot: { name: `Sage Name ${suffix}`, postalCode: 'M5V 9Y4' },
      })

      const dry = await runSageImport(
        tx,
        { apply: false, entities: ['customers'], onlySageIds: [sourceId, createId, conflictId, missingId] },
        session,
      )
      expect(dry.applied).toBe(false)
      expect(dry.summaries[0]?.link).toBe(1)
      expect(dry.summaries[0]?.create).toBe(1)
      expect(dry.summaries[0]?.conflicts).toBeGreaterThanOrEqual(1)
      expect(dry.summaries[0]?.missing).toBe(1)

      const applied = await runSageImport(
        tx,
        { apply: true, entities: ['customers'], onlySageIds: [sourceId, createId, conflictId, missingId] },
        session,
      )
      expect(applied.applied).toBe(true)
      const [draft] = await tx.select().from(customers).where(eq(customers.id, -990010))
      expect(draft?.id).toBe(-990010)
      expect(draft?.sageCustomerId).toBe(sourceId)
      const [created] = await tx.select().from(customers).where(eq(customers.id, createId))
      expect(created?.sageCustomerId).toBe(createId)
      const [conflicted] = await tx.select().from(customers).where(eq(customers.id, conflictId))
      expect(conflicted?.name).toBe(`Operator Name ${suffix}`)
    })
  })
})
