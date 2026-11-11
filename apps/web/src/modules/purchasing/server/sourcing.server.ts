/**
 * Pre-orders and RFQs, including idempotent conversion/award.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { ValidationError } from '@cls/core'
import type { Db } from '@cls/db'
import {
  purchaseOrderPreorderParts,
  purchaseOrderPreorderSpecialParts,
  purchaseOrderPreorderSuppliers,
  purchaseOrderPreorders,
  purchaseOrderRfqLines,
  purchaseOrderRfqSuppliers,
  purchaseOrderRfqs,
  purchaseOrderSupplierQuoteLines,
  purchaseOrderSupplierQuotes,
  purchaseOrders,
} from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import type { PurchaseOrderCreateInput } from '../types'
import {
  assertPurchaseOrderRead,
  assertPurchaseOrderWrite,
  isSupplierOffered,
  supplierIdForSession,
} from './access.server'
import { createPurchaseOrderCore } from './create.server'

export async function createPreorder(
  input: {
    sourceQuoteId?: number | null
    report?: string | null
    priorityId?: number | null
    notes?: string | null
    isWithoutQuote: boolean
    workOrderNumber?: number | null
    parts: PurchaseOrderCreateInput['parts']
    specialParts: PurchaseOrderCreateInput['specialParts']
    supplierIds: number[]
  },
  session: AuthSessionView,
  db: Db,
) {
  assertPurchaseOrderWrite(session)
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(purchaseOrderPreorders)
      .values({
        sourceQuoteId: input.sourceQuoteId ?? null,
        report: input.report ?? null,
        priorityId: input.priorityId ?? null,
        notes: input.notes ?? null,
        isWithoutQuote: input.isWithoutQuote,
        workOrderNumber: input.workOrderNumber ?? null,
        createdBy: session.user.id,
      })
      .returning()
    if (!row) throw new ValidationError('The pre-order could not be created.')

    if (input.parts.length) {
      await tx.insert(purchaseOrderPreorderParts).values(
        input.parts.map((line, index) => ({
          preorderId: row.id,
          partNo: line.partNo,
          qty: line.qty,
          price: line.price,
          itemPurchaseType: line.itemPurchaseType ?? null,
          itemPurchaseTypeNumber: line.itemPurchaseTypeNumber ?? null,
          supplierId: input.supplierIds[0] ?? null,
          sortOrder: index,
        })),
      )
    }
    if (input.specialParts.length) {
      await tx.insert(purchaseOrderPreorderSpecialParts).values(
        input.specialParts.map((line, index) => ({
          preorderId: row.id,
          name: line.name,
          qty: line.qty,
          price: line.price,
          itemPurchaseType: line.itemPurchaseType ?? null,
          itemPurchaseTypeNumber: line.itemPurchaseTypeNumber ?? null,
          supplierId: input.supplierIds[0] ?? null,
          sortOrder: index,
        })),
      )
    }
    if (input.supplierIds.length) {
      await tx.insert(purchaseOrderPreorderSuppliers).values(
        input.supplierIds.map((supplierId) => ({
          preorderId: row.id,
          supplierId,
        })),
      )
    }
    return { id: row.id, status: row.status }
  })
}

export async function respondToPreorder(
  input: { id: number; supplierId: number; action: 'accept' | 'decline' | 'waiting'; notes?: string | null },
  session: AuthSessionView,
  db: Db,
) {
  if (session.user.role !== 'supplier') assertPurchaseOrderWrite(session)
  return db.transaction(async (tx) => {
    if (session.user.role === 'supplier') {
      const own = await supplierIdForSession(session, tx)
      if (own !== input.supplierId) throw new ValidationError('This pre-order is not yours.')
    }
    const [row] = await tx
      .update(purchaseOrderPreorderSuppliers)
      .set({ responseStatus: input.action, notes: input.notes ?? null })
      .where(
        and(
          eq(purchaseOrderPreorderSuppliers.preorderId, input.id),
          eq(purchaseOrderPreorderSuppliers.supplierId, input.supplierId),
        ),
      )
      .returning()
    if (!row) throw new ValidationError('The supplier is not attached to that pre-order.')
    return { id: row.id, responseStatus: row.responseStatus }
  })
}

export async function convertPreorder(
  input: { id: number; supplierId: number },
  session: AuthSessionView,
  db: Db,
) {
  assertPurchaseOrderWrite(session)
  return db.transaction(async (tx) => {
    const [preorder] = await tx
      .select()
      .from(purchaseOrderPreorders)
      .where(eq(purchaseOrderPreorders.id, input.id))
      .limit(1)
    if (!preorder) throw new ValidationError('The pre-order does not exist.')

    const [existing] = await tx
      .select({ id: purchaseOrders.id, displayNumber: purchaseOrders.displayNumber, version: purchaseOrders.version })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.preorderId, preorder.id))
      .limit(1)
    if (existing) {
      return { id: existing.id, displayNumber: existing.displayNumber ?? String(existing.id), version: existing.version, idempotent: true }
    }

    const parts = await tx
      .select()
      .from(purchaseOrderPreorderParts)
      .where(eq(purchaseOrderPreorderParts.preorderId, preorder.id))
    const specials = await tx
      .select()
      .from(purchaseOrderPreorderSpecialParts)
      .where(eq(purchaseOrderPreorderSpecialParts.preorderId, preorder.id))

    const created = await createPurchaseOrderCore(
      tx,
      {
        supplierId: input.supplierId,
        shipmentType: 'alliance',
        taxCode: 'ON',
        notes: preorder.notes,
        parts: parts.map((line) => ({
          partNo: line.partNo,
          qty: line.qty,
          price: line.price,
          itemPurchaseType: line.itemPurchaseType,
          itemPurchaseTypeNumber: line.itemPurchaseTypeNumber,
        })),
        specialParts: specials.map((line) => ({
          name: line.name,
          qty: line.qty,
          price: line.price,
          itemPurchaseType: line.itemPurchaseType,
          itemPurchaseTypeNumber: line.itemPurchaseTypeNumber,
        })),
      },
      session,
    )

    await tx
      .update(purchaseOrders)
      .set({ preorderId: preorder.id })
      .where(eq(purchaseOrders.id, created.id))
    await tx
      .update(purchaseOrderPreorders)
      .set({ status: 2 })
      .where(eq(purchaseOrderPreorders.id, preorder.id))
    await tx
      .update(purchaseOrderPreorderSuppliers)
      .set({ responseStatus: 'accepted' })
      .where(
        and(
          eq(purchaseOrderPreorderSuppliers.preorderId, preorder.id),
          eq(purchaseOrderPreorderSuppliers.supplierId, input.supplierId),
        ),
      )

    return { ...created, idempotent: false }
  })
}

export async function createRfq(
  input: {
    sourceQuoteId?: number | null
    report?: string | null
    priorityId?: number | null
    notes?: string | null
    supplierIds: number[]
    lines: PurchaseOrderCreateInput['parts']
  },
  session: AuthSessionView,
  db: Db,
) {
  assertPurchaseOrderWrite(session)
  if (input.lines.length === 0) throw new ValidationError('An RFQ needs at least one line.')
  if (input.supplierIds.length === 0) throw new ValidationError('Choose at least one supplier.')
  return db.transaction(async (tx) => {
    const [rfq] = await tx
      .insert(purchaseOrderRfqs)
      .values({
        sourceQuoteId: input.sourceQuoteId ?? null,
        report: input.report ?? null,
        priorityId: input.priorityId ?? null,
        notes: input.notes ?? null,
        status: 2,
        createdBy: session.user.id,
      })
      .returning()
    if (!rfq) throw new ValidationError('The RFQ could not be created.')
    await tx.insert(purchaseOrderRfqLines).values(
      input.lines.map((line, index) => ({
        rfqId: rfq.id,
        partNo: line.partNo,
        qty: line.qty,
        targetPrice: line.price,
        itemPurchaseType: line.itemPurchaseType ?? null,
        itemPurchaseTypeNumber: line.itemPurchaseTypeNumber ?? null,
        sortOrder: index,
      })),
    )
    await tx.insert(purchaseOrderRfqSuppliers).values(
      input.supplierIds.map((supplierId) => ({ rfqId: rfq.id, supplierId })),
    )
    return { id: rfq.id, status: rfq.status }
  })
}

export async function submitSupplierQuote(
  input: {
    rfqId: number
    expectedDelivery?: string | null
    notes?: string | null
    lines: Array<{ rfqLineId: number; price: string; note?: string | null }>
  },
  session: AuthSessionView,
  db: Db,
) {
  if (session.user.role !== 'supplier') {
    throw new ValidationError('Only a supplier account can submit a supplier quote.')
  }
  return db.transaction(async (tx) => {
    const supplierId = await supplierIdForSession(session, tx)
    if (!(await isSupplierOffered(tx, input.rfqId, supplierId))) {
      throw new ValidationError('You were not invited to this RFQ.')
    }
    const rfqLines = await tx
      .select()
      .from(purchaseOrderRfqLines)
      .where(eq(purchaseOrderRfqLines.rfqId, input.rfqId))
    if (rfqLines.length === 0) throw new ValidationError('That RFQ has no lines.')

    const [existing] = await tx
      .select()
      .from(purchaseOrderSupplierQuotes)
      .where(
        and(
          eq(purchaseOrderSupplierQuotes.rfqId, input.rfqId),
          eq(purchaseOrderSupplierQuotes.supplierId, supplierId),
        ),
      )
      .limit(1)

    let quoteId: number
    if (existing) {
      if (existing.processedAsOrder) throw new ValidationError('That quote has already been awarded.')
      const [updated] = await tx
        .update(purchaseOrderSupplierQuotes)
        .set({
          expectedDelivery: input.expectedDelivery ?? null,
          notes: input.notes ?? null,
          status: 3,
          submittedAt: new Date(),
        })
        .where(eq(purchaseOrderSupplierQuotes.id, existing.id))
        .returning()
      quoteId = updated!.id
      await tx
        .delete(purchaseOrderSupplierQuoteLines)
        .where(eq(purchaseOrderSupplierQuoteLines.supplierQuoteId, quoteId))
    } else {
      const [created] = await tx
        .insert(purchaseOrderSupplierQuotes)
        .values({
          rfqId: input.rfqId,
          supplierId,
          expectedDelivery: input.expectedDelivery ?? null,
          notes: input.notes ?? null,
          status: 3,
        })
        .returning()
      quoteId = created!.id
    }

    await tx.insert(purchaseOrderSupplierQuoteLines).values(
      input.lines.map((line) => {
        const rfqLine = rfqLines.find((row) => row.id === line.rfqLineId)
        if (!rfqLine) throw new ValidationError('A quote line does not belong to this RFQ.')
        return {
          supplierQuoteId: quoteId,
          rfqLineId: line.rfqLineId,
          partNo: rfqLine.partNo,
          name: rfqLine.name,
          qty: rfqLine.qty,
          price: line.price,
          note: line.note ?? null,
        }
      }),
    )
    await tx
      .update(purchaseOrderRfqSuppliers)
      .set({ responseStatus: 'accepted', quotesCounter: 1 })
      .where(
        and(
          eq(purchaseOrderRfqSuppliers.rfqId, input.rfqId),
          eq(purchaseOrderRfqSuppliers.supplierId, supplierId),
        ),
      )
    await tx
      .update(purchaseOrderRfqs)
      .set({ status: 3 })
      .where(and(eq(purchaseOrderRfqs.id, input.rfqId), eq(purchaseOrderRfqs.status, 2)))
    return { id: quoteId }
  })
}

export async function awardRfq(
  input: { rfqId: number; supplierQuoteId: number; lineIds: number[] },
  session: AuthSessionView,
  db: Db,
) {
  assertPurchaseOrderWrite(session)
  return db.transaction(async (tx) => {
    const [quote] = await tx
      .select()
      .from(purchaseOrderSupplierQuotes)
      .where(
        and(
          eq(purchaseOrderSupplierQuotes.id, input.supplierQuoteId),
          eq(purchaseOrderSupplierQuotes.rfqId, input.rfqId),
        ),
      )
      .limit(1)
    if (!quote) throw new ValidationError('That supplier quote is not on this RFQ.')
    if (quote.processedAsOrder) {
      const [existing] = await tx
        .select({ id: purchaseOrders.id, displayNumber: purchaseOrders.displayNumber, version: purchaseOrders.version })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.supplierQuoteId, quote.id))
        .limit(1)
      if (existing) {
        return { ...existing, displayNumber: existing.displayNumber ?? String(existing.id), idempotent: true }
      }
    }

    const lines = await tx
      .select()
      .from(purchaseOrderSupplierQuoteLines)
      .where(
        and(
          eq(purchaseOrderSupplierQuoteLines.supplierQuoteId, quote.id),
          inArray(purchaseOrderSupplierQuoteLines.rfqLineId, input.lineIds),
        ),
      )
    if (lines.length === 0) throw new ValidationError('Choose at least one quoted line to award.')

    const created = await createPurchaseOrderCore(
      tx,
      {
        supplierId: quote.supplierId,
        shipmentType: 'alliance',
        taxCode: 'ON',
        rfqId: input.rfqId,
        supplierQuoteId: quote.id,
        parts: lines.map((line) => ({
          partNo: line.partNo ?? 'SPECIAL',
          qty: line.qty,
          price: line.price,
        })),
        specialParts: [],
      },
      session,
    )

    await tx
      .update(purchaseOrders)
      .set({ rfqId: input.rfqId, supplierQuoteId: quote.id })
      .where(eq(purchaseOrders.id, created.id))
    await tx
      .update(purchaseOrderSupplierQuotes)
      .set({ processedAsOrder: true, status: 4 })
      .where(eq(purchaseOrderSupplierQuotes.id, quote.id))
    await tx
      .update(purchaseOrderRfqLines)
      .set({ awardedSupplierQuoteId: quote.id, awardedPoId: created.id })
      .where(inArray(purchaseOrderRfqLines.id, lines.map((line) => line.rfqLineId)))

    const remaining = await tx
      .select()
      .from(purchaseOrderRfqLines)
      .where(eq(purchaseOrderRfqLines.rfqId, input.rfqId))
    if (remaining.every((line) => line.awardedPoId !== null || line.cancelled)) {
      await tx
        .update(purchaseOrderRfqs)
        .set({ status: 4 })
        .where(eq(purchaseOrderRfqs.id, input.rfqId))
    }

    return { ...created, idempotent: false }
  })
}

export async function listSupplierPortal(
  session: AuthSessionView,
  db: Db,
) {
  if (session.user.role !== 'supplier') throw new ValidationError('Supplier portal only.')
  const supplierId = await supplierIdForSession(session, db)
  const pos = await db
    .select({
      id: purchaseOrders.id,
      displayNumber: purchaseOrders.displayNumber,
      status: purchaseOrders.status,
      total: purchaseOrders.total,
      expectedDelivery: purchaseOrders.expectedDelivery,
    })
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.supplierId, supplierId),
        inArray(purchaseOrders.status, [2, 4, 6]),
      ),
    )
  const offers = await db
    .select({
      rfqId: purchaseOrderRfqs.id,
      status: purchaseOrderRfqs.status,
      responseStatus: purchaseOrderRfqSuppliers.responseStatus,
    })
    .from(purchaseOrderRfqSuppliers)
    .innerJoin(purchaseOrderRfqs, eq(purchaseOrderRfqs.id, purchaseOrderRfqSuppliers.rfqId))
    .where(eq(purchaseOrderRfqSuppliers.supplierId, supplierId))
  return {
    purchaseOrders: pos.map((row) => ({
      id: row.id,
      displayNumber: row.displayNumber ?? String(row.id),
      status: row.status,
      total: row.total,
      expectedDelivery: row.expectedDelivery,
    })),
    rfqs: offers,
  }
}

export async function listRfqs(session: AuthSessionView, db: Db) {
  assertPurchaseOrderRead(session)
  if (session.user.role === 'supplier') {
    const supplierId = await supplierIdForSession(session, db)
    const offered = await db
      .select({ rfqId: purchaseOrderRfqSuppliers.rfqId })
      .from(purchaseOrderRfqSuppliers)
      .where(eq(purchaseOrderRfqSuppliers.supplierId, supplierId))
    const ids = offered.map((row) => row.rfqId)
    if (ids.length === 0) return []
    const scoped = await db
      .select()
      .from(purchaseOrderRfqs)
      .where(inArray(purchaseOrderRfqs.id, ids))
    const scopedLines = await db
      .select()
      .from(purchaseOrderRfqLines)
      .where(inArray(purchaseOrderRfqLines.rfqId, ids))
    return scoped.map((rfq) => ({
      id: rfq.id,
      status: rfq.status,
      report: rfq.report,
      lines: scopedLines.filter((line) => line.rfqId === rfq.id).length,
      createdAt: rfq.createdAt.toISOString(),
    }))
  }
  const rfqs = await db.select().from(purchaseOrderRfqs)
  const lines = await db.select().from(purchaseOrderRfqLines)
  return rfqs.map((rfq) => ({
    id: rfq.id,
    status: rfq.status,
    report: rfq.report,
    lines: lines.filter((line) => line.rfqId === rfq.id).length,
    createdAt: rfq.createdAt.toISOString(),
  }))
}
