/**
 * TJX quote lifecycle and generated documents. Real database, rolled back.
 */
import { desc, eq } from 'drizzle-orm'
import { describe, expect, test, vi } from 'vitest'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })

import { ALL_PERMISSIONS, ConflictError, ForbiddenError, ValidationError } from '@cls/core'
import { getConfig } from '@cls/core/env.server'
import { getDb, type Tx } from '@cls/db'
import {
  auditLog,
  customers,
  generatedDocuments,
  sites,
  tjxQuoteRevisions,
  users,
} from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import type { TjxQuoteCreateInput, TjxQuoteSaveInput } from '../types'
import { createQuoteCore, getQuoteDetail, saveQuoteCore } from './quotes.server'
import {
  approveQuoteCore,
  cancelQuoteCore,
  returnQuoteCore,
  saveRevisionCore,
  submitQuoteCore,
} from './lifecycle.server'
import {
  listTjxDocuments,
  regenerateTjxDocument,
  renderTjxDocumentCore,
} from './pdf.server'

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
      await fn(tx)
      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  }
}

const ADMIN_ID = '00000000-0000-4000-8000-0000000000e1'
const WRITER_ID = '00000000-0000-4000-8000-0000000000e2'
const CUSTOMER_ID = 9_440_001
const SITE_ID = 9_440_001

function session(
  id: string,
  email: string,
  role: 'admin' | 'technician',
  grants: AuthSessionView['user']['grants'],
): AuthSessionView {
  return {
    id: `session-${email}`,
    expiresAt: new Date(Date.now() + 60_000),
    lastSeenAt: new Date(),
    user: {
      id,
      email,
      username: email,
      displayName: email,
      role,
      subcontractorId: null,
      grants,
    },
  }
}

function adminSession(): AuthSessionView {
  return session(
    ADMIN_ID,
    'tjx-life-admin@example.test',
    'admin',
    ALL_PERMISSIONS.map((key) => ({ key, scopeSubcontractorId: null })),
  )
}

function writerSession(): AuthSessionView {
  return session(WRITER_ID, 'tjx-life-writer@example.test', 'technician', [
    { key: 'tjx:read', scopeSubcontractorId: null },
    { key: 'tjx:write', scopeSubcontractorId: null },
  ])
}

async function seed(tx: Tx): Promise<void> {
  await tx.insert(users).values([
    {
      id: ADMIN_ID,
      email: 'tjx-life-admin@example.test',
      username: 'tjx-life-admin',
      displayName: 'TJX Life Admin',
      role: 'admin',
    },
    {
      id: WRITER_ID,
      email: 'tjx-life-writer@example.test',
      username: 'tjx-life-writer',
      displayName: 'TJX Life Writer',
      role: 'technician',
    },
  ])
  await tx.insert(customers).values({ id: CUSTOMER_ID, name: 'TJX Life Customer' })
  await tx.insert(sites).values({
    id: SITE_ID,
    customerId: CUSTOMER_ID,
    name: 'TJX Life Site',
    street: '2 Life Way',
    city: 'Toronto',
    province: 'ON',
    postalCode: 'M5V 1A2',
  })
}

function createInput(): TjxQuoteCreateInput {
  return {
    siteId: SITE_ID,
    quoteType: 'Gen 1',
    ceilingGridType: 2,
    isTypeMaintenance: false,
    paymentTermsCode: 4,
    dueDate: '2026-12-01',
    taxProvince: 'ON',
    appliedTaxRate: null,
    shipToType: null,
    shipContactName: null,
    shipCompany: null,
    shipStreet1: null,
    shipStreet2: null,
    shipCity: null,
    shipProvince: null,
    shipPostalCode: null,
    shipPhone: null,
    shippingAddress: null,
    notes: null,
    pdfNotes: null,
  }
}

async function draft(tx: Tx, header = createInput()) {
  const created = await createQuoteCore(tx, header, adminSession())
  const input: TjxQuoteSaveInput = {
    ...header,
    id: created.id,
    version: created.version,
    revisionNotes: null,
    rooms: [],
    specialParts: [{ name: 'Freight', quantity: '1', unitPrice: '10.00' }],
    priceOverrides: [],
  }
  return saveQuoteCore(tx, input, adminSession())
}

describe.skipIf(!databaseConfigured())('TJX quote lifecycle', () => {
  test('submits, returns and approves with revision rows and audit', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const saved = await draft(tx)

      const submitted = await submitQuoteCore(
        tx,
        { id: saved.id, version: saved.version },
        writerSession(),
      )
      expect(submitted.status).toBe(3)
      expect(submitted.statusLabel).toBe('Waiting for Approval')

      const returned = await returnQuoteCore(
        tx,
        { id: submitted.id, version: submitted.version },
        writerSession(),
      )
      expect(returned.status).toBe(1)

      const submittedAgain = await submitQuoteCore(
        tx,
        { id: returned.id, version: returned.version },
        adminSession(),
      )
      const approved = await approveQuoteCore(
        tx,
        { id: submittedAgain.id, version: submittedAgain.version },
        adminSession(),
      )
      expect(approved.status).toBe(4)
      expect(approved.canEdit).toBe(false)

      const revisions = await tx
        .select()
        .from(tjxQuoteRevisions)
        .where(eq(tjxQuoteRevisions.quoteId, saved.id))
        .orderBy(tjxQuoteRevisions.saveSeq)
      expect(revisions.map((row) => row.revisionType)).toEqual([
        'insert',
        'update',
        'submit',
        'update',
        'submit',
        'approve',
      ])

      const audits = await tx
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.action, 'tjx.quote.approve'))
      expect(audits).toHaveLength(1)
    })
  })

  test('requires quote:approve and tjx:write to approve', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const saved = await draft(tx)
      const submitted = await submitQuoteCore(
        tx,
        { id: saved.id, version: saved.version },
        writerSession(),
      )

      await expect(
        approveQuoteCore(tx, { id: submitted.id, version: submitted.version }, writerSession()),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  test('submit rejects missing header fields and an empty quote', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const header = createInput()
      header.ceilingGridType = null
      const created = await createQuoteCore(tx, header, adminSession())
      const input: TjxQuoteSaveInput = {
        ...header,
        id: created.id,
        version: created.version,
        revisionNotes: null,
        rooms: [],
        specialParts: [],
        priceOverrides: [],
      }
      const saved = await saveQuoteCore(tx, input, adminSession())

      await expect(
        submitQuoteCore(tx, { id: saved.id, version: saved.version }, adminSession()),
      ).rejects.toBeInstanceOf(ValidationError)
    })
  })

  test('cancels a draft, and an approved quote needs approval authority', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const saved = await draft(tx)
      const cancelled = await cancelQuoteCore(
        tx,
        { id: saved.id, version: saved.version },
        writerSession(),
      )
      expect(cancelled.status).toBe(5)

      const second = await draft(tx)
      const submitted = await submitQuoteCore(
        tx,
        { id: second.id, version: second.version },
        adminSession(),
      )
      const approved = await approveQuoteCore(
        tx,
        { id: submitted.id, version: submitted.version },
        adminSession(),
      )
      await expect(
        cancelQuoteCore(tx, { id: approved.id, version: approved.version }, writerSession()),
      ).rejects.toBeInstanceOf(ForbiddenError)
      const cancelledApproved = await cancelQuoteCore(
        tx,
        { id: approved.id, version: approved.version },
        adminSession(),
      )
      expect(cancelledApproved.status).toBe(5)
    })
  })

  test('save as revision increments revision_no and leaves status alone', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const saved = await draft(tx)
      const revised = await saveRevisionCore(
        tx,
        { id: saved.id, version: saved.version, notes: 'Reissued for the mall office.' },
        adminSession(),
      )

      expect(revised.status).toBe(1)
      expect(revised.revisionNo).toBe(1)
      expect(revised.revisionNotes).toBe('Reissued for the mall office.')

      const revisions = await tx
        .select()
        .from(tjxQuoteRevisions)
        .where(eq(tjxQuoteRevisions.quoteId, saved.id))
        .orderBy(desc(tjxQuoteRevisions.saveSeq))
      expect(revisions[0]!.notes).toBe('Reissued for the mall office.')
      expect(revisions[0]!.revisionNo).toBe(1)
    })
  })

  test('rejects a stale transition version', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const saved = await draft(tx)
      const revised = await saveRevisionCore(
        tx,
        { id: saved.id, version: saved.version, notes: 'One' },
        adminSession(),
      )
      await expect(
        submitQuoteCore(tx, { id: saved.id, version: saved.version }, adminSession()),
      ).rejects.toBeInstanceOf(ConflictError)
      expect(revised.version).toBe(saved.version + 1)
    })
  })

  test('renders the customer quote and internal order sheet, then regenerates identically', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const saved = await draft(tx)
      const quotePdf = await renderTjxDocumentCore(tx, saved.id, adminSession(), 'tjx-quote')
      const orderSheet = await renderTjxDocumentCore(
        tx,
        saved.id,
        adminSession(),
        'tjx-order-sheet',
      )

      expect(quotePdf.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(quotePdf.byteSize).toBeGreaterThan(1000)
      expect(quotePdf.pageCount).toBeGreaterThanOrEqual(1)
      expect(orderSheet.sha256).not.toBe(quotePdf.sha256)

      const rows = await tx
        .select()
        .from(generatedDocuments)
        .where(eq(generatedDocuments.entityType, 'tjx_quote'))
        .orderBy(generatedDocuments.createdAt)
      expect(rows).toHaveLength(2)
      expect(new Set(rows.map((row) => row.kind))).toEqual(
        new Set(['tjx-quote', 'tjx-order-sheet']),
      )
      expect(rows[0]!.entityId).toBe(String(saved.id))
      expect(rows[0]!.dataSnapshot).toMatchObject({ kind: 'tjx-quote' })

      const regenerated = await regenerateTjxDocument(quotePdf.documentId, adminSession(), tx)
      expect(regenerated.sha256).toBe(quotePdf.sha256)

      const listed = await listTjxDocuments(saved.id, adminSession(), tx)
      expect(listed).toHaveLength(3)
      expect(listed.map((row) => row.kind)).toContain('tjx-quote')
    })
  })

  test('approved quote totals stay frozen and cannot be edited', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const saved = await draft(tx)
      const submitted = await submitQuoteCore(
        tx,
        { id: saved.id, version: saved.version },
        adminSession(),
      )
      const approved = await approveQuoteCore(
        tx,
        { id: submitted.id, version: submitted.version },
        adminSession(),
      )
      const input: TjxQuoteSaveInput = {
        ...createInput(),
        id: approved.id,
        version: approved.version,
        revisionNotes: null,
        rooms: [],
        specialParts: [{ name: 'Freight', quantity: '1', unitPrice: '10.00' }],
        priceOverrides: [],
      }
      await expect(saveQuoteCore(tx, input, adminSession())).rejects.toBeInstanceOf(ValidationError)

      const detail = await getQuoteDetail(tx, approved.id)
      expect(detail.total).toBe('11.30')
      expect(detail.withoutMarkupTotal).toBe('11.30')
    })
  })
})
