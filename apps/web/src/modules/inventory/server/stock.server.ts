/**
 * Stock posting and counter arithmetic.
 *
 * SERVER ONLY. Every movement inserts the ledger row first and only then
 * changes `parts` counters, in the same transaction. The ledger idempotency key
 * makes a retried receipt or sale a no-op for both the ledger and the counter.
 */
import { and, eq } from 'drizzle-orm'
import { ValidationError } from '@cls/core'
import type { Tx } from '@cls/db'
import { inventoryMovements, partStockAdjustments, parts, type Part } from '@cls/db/schema'
import { format, parseDecimal, round, compare } from '@cls/pricing'
import type { AuthSessionView } from '../../../server/auth.types'
import { assertPermission } from '../../../server/middleware'
import { allocateLocalId } from '../../master-data/server/write-support.server'
import { applyAdjustment, applyPurchase, applySale, type StockCounters } from '../lib/stock'

export interface PurchaseReceiptStockLine {
  receiptLineId: number
  partNo: string
  qty: string
}

function countersOf(part: Part): StockCounters {
  return {
    purchasedQuantity: part.purchasedQuantity,
    currentQuantity: part.currentQuantity,
    soldQuantity: part.soldQuantity,
  }
}

async function loadPartForUpdate(tx: Tx, id: number): Promise<Part | null> {
  const [row] = await tx.select().from(parts).where(eq(parts.id, id)).for('update')
  return row ?? null
}

/**
 * E3: unknown part numbers are auto-created before the counter update. The new
 * part uses the negative local id space so it can never collide with a Sage id.
 */
export async function ensurePart(tx: Tx, partNo: string): Promise<Part> {
  const number = partNo.trim()
  if (!number) throw new ValidationError('A stock movement needs a part number.')

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [existing] = await tx
      .select()
      .from(parts)
      .where(eq(parts.partNumber, number))
      .for('update')
    if (existing) return existing

    const id = await allocateLocalId(tx, 'part')
    const [created] = await tx
      .insert(parts)
      .values({
        id,
        partNumber: number,
        name: number,
        activeInSage: false,
        notes: 'Auto-created by an inventory movement (BUSINESS-RULES E3).',
      })
      .onConflictDoNothing({ target: parts.partNumber })
      .returning()
    if (created) return created
  }
  const [created] = await tx.select().from(parts).where(eq(parts.partNumber, number)).for('update')
  if (!created) throw new ValidationError(`Could not create part ${number}.`)
  return created
}

async function writeCounters(tx: Tx, partId: number, next: StockCounters): Promise<void> {
  await tx
    .update(parts)
    .set({
      purchasedQuantity: next.purchasedQuantity,
      currentQuantity: next.currentQuantity,
      soldQuantity: next.soldQuantity,
      updatedAt: new Date(),
    })
    .where(eq(parts.id, partId))
}

/**
 * Receipt posting called by Purchasing in the receipt transaction.
 * Purchase increments purchased and current quantity.
 */
export async function postPurchaseReceipt(
  tx: Tx,
  input: {
    poId: number
    receiptId: number
    lines: PurchaseReceiptStockLine[]
    session: AuthSessionView
  },
): Promise<number> {
  if (input.lines.length === 0) return 0
  let posted = 0

  for (const line of input.lines) {
    const part = await ensurePart(tx, line.partNo)
    const [inserted] = await tx
      .insert(inventoryMovements)
      .values({
        partNo: part.partNumber,
        partId: part.id,
        qty: line.qty,
        movementType: 'purchase_receipt',
        transactionType: 'Purchase',
        referenceType: 'purchase_order_receipt',
        referenceId: String(input.receiptId),
        documentType: 'purchase_order',
        documentId: String(input.poId),
        woidPoid: input.poId,
        poId: input.poId,
        receiptId: input.receiptId,
        receiptLineId: line.receiptLineId,
        idempotencyKey: `purchase-receipt:${input.receiptId}:${line.receiptLineId}`,
        createdBy: input.session.user.id,
      })
      .onConflictDoNothing({ target: inventoryMovements.idempotencyKey })
      .returning({ id: inventoryMovements.id })

    if (!inserted) continue
    await writeCounters(tx, part.id, applyPurchase(countersOf(part), line.qty))
    posted += 1
  }
  return posted
}

export interface StockAdjustmentInput {
  partNo: string
  qty: string
  adjustmentType: 'global' | 'alliance' | 'subcontractor' | 'customer' | 'contractor'
  notes?: string | null
  price?: string | null
  workOrderNumber?: number | null
  siteId?: number | null
  subcontractorId?: number | null
  massAdjustmentNumber?: number | null
  onFieldCountedQty?: string | null
  idempotencyKey: string
}

export async function adjustPartStockCore(
  tx: Tx,
  input: StockAdjustmentInput,
  session: AuthSessionView,
): Promise<{ adjustmentId: number; currentQuantity: string; replay: boolean }> {
  assertPermission(session, 'inventory:adjust')
  const part = await ensurePart(tx, input.partNo)
  const qty = parseDecimal(input.qty)
  if (!qty) throw new ValidationError('Enter an adjustment quantity.')

  const [adjustment] = await tx
    .insert(partStockAdjustments)
    .values({
      partNo: part.partNumber,
      partId: part.id,
      qty: format(round(qty, 2), 2),
      price: input.price ?? null,
      adjustmentType: input.adjustmentType,
      notes: input.notes ?? null,
      workOrderNumber: input.workOrderNumber ?? null,
      siteId: input.siteId ?? null,
      subcontractorId: input.subcontractorId ?? null,
      massAdjustmentNumber: input.massAdjustmentNumber ?? null,
      idempotencyKey: input.idempotencyKey,
      createdBy: session.user.id,
    })
    .onConflictDoNothing({ target: partStockAdjustments.idempotencyKey })
    .returning()

  if (!adjustment) {
    const [existing] = await tx
      .select()
      .from(partStockAdjustments)
      .where(eq(partStockAdjustments.idempotencyKey, input.idempotencyKey))
      .limit(1)
    if (!existing) throw new ValidationError('The adjustment could not be recorded.')
    const current = await loadPartForUpdate(tx, part.id)
    return {
      adjustmentId: existing.id,
      currentQuantity: current?.currentQuantity ?? part.currentQuantity,
      replay: true,
    }
  }

  const next = applyAdjustment(countersOf(part), format(qty, 2))
  await writeCounters(tx, part.id, next)

  await tx.insert(inventoryMovements).values({
    partNo: part.partNumber,
    partId: part.id,
    qty: format(qty, 2),
    price: input.price ?? null,
    movementType: 'adjustment',
    transactionType: 'Adjustment',
    referenceType: 'part_stock_adjustment',
    referenceId: String(adjustment.id),
    documentType: 'part_stock_adjustment',
    documentId: String(adjustment.id),
    woidPoid: input.workOrderNumber ?? null,
    adjustmentType: input.adjustmentType,
    onFieldCountedQty: input.onFieldCountedQty ?? null,
    adjSubcontractor: input.subcontractorId ?? null,
    adjSite: input.siteId ?? null,
    idempotencyKey: `adjustment:${adjustment.id}`,
    note: input.notes ?? null,
    createdBy: session.user.id,
  })

  return { adjustmentId: adjustment.id, currentQuantity: next.currentQuantity, replay: false }
}

export interface SaleInput {
  workOrderId: number
  workOrderLineId: number
  partNo: string
  qty: string
  price?: string | null
  note?: string | null
}

/**
 * Work-order part consumption. Mirrors E1/E2: sold then current, then ledger,
 * with the work-order id duplicated into `woid_poid`, `invoice_number` and
 * `invoice_id`.
 */
export async function postWorkOrderPartSale(
  tx: Tx,
  input: SaleInput,
  session: AuthSessionView,
): Promise<{ posted: boolean; currentQuantity: string }> {
  const part = await ensurePart(tx, input.partNo)
  const qty = parseDecimal(input.qty)
  if (!qty || compare(qty, { value: 0n, scale: 2 }) < 0) {
    throw new ValidationError('A sale quantity must be zero or greater.')
  }
  const idempotencyKey = `workorder-sale:${input.workOrderId}:${input.workOrderLineId}`

  const [inserted] = await tx
    .insert(inventoryMovements)
    .values({
      partNo: part.partNumber,
      partId: part.id,
      qty: format(qty, 2),
      price: input.price ?? null,
      movementType: 'sale',
      transactionType: 'Sale',
      referenceType: 'work_order',
      referenceId: String(input.workOrderId),
      documentType: 'work_order',
      documentId: String(input.workOrderId),
      woidPoid: input.workOrderId,
      invoiceNumber: String(input.workOrderId),
      invoiceId: input.workOrderId,
      idempotencyKey,
      note: input.note ?? null,
      createdBy: session.user.id,
    })
    .onConflictDoNothing({ target: inventoryMovements.idempotencyKey })
    .returning({ id: inventoryMovements.id })

  if (!inserted) {
    const current = await loadPartForUpdate(tx, part.id)
    return { posted: false, currentQuantity: current?.currentQuantity ?? part.currentQuantity }
  }

  const next = applySale(countersOf(part), format(qty, 2))
  await writeCounters(tx, part.id, next)
  return { posted: true, currentQuantity: next.currentQuantity }
}

/** Mark a movement as excluded from stock management without deleting history. */
export async function excludeMovementFromStock(
  tx: Tx,
  movementId: number,
  session: AuthSessionView,
): Promise<void> {
  assertPermission(session, 'inventory:adjust')
  await tx
    .update(inventoryMovements)
    .set({ isIncludedInStockManagement: false })
    .where(eq(inventoryMovements.id, movementId))
}

/** Soft-delete a ledger row. The counter is not rewritten (E4). */
export async function softDeleteMovement(
  tx: Tx,
  movementId: number,
  session: AuthSessionView,
): Promise<void> {
  assertPermission(session, 'inventory:adjust')
  await tx
    .update(inventoryMovements)
    .set({ isLogDeleted: true, isIncludedInStockManagement: false })
    .where(and(eq(inventoryMovements.id, movementId), eq(inventoryMovements.isLogDeleted, false)))
}
