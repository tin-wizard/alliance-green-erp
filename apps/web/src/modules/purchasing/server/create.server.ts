/**
 * Create or edit a purchase order.
 *
 * SERVER ONLY. The header and lines are written in one transaction with the
 * allocated number and a status-history row. Creating always starts at 3 Saved;
 * approval is a separate, audited transition.
 */
import { eq } from 'drizzle-orm'
import { ValidationError } from '@cls/core'
import type { Db, Tx } from '@cls/db'
import { purchaseOrders } from '@cls/db/schema'
import { calculatePurchaseOrderTotals } from '@cls/pricing'
import type { AuthSessionView } from '../../../server/auth.types'
import type {
  PurchaseOrderCreateInput,
  PurchaseOrderUpdateInput,
} from '../types'
import { loadSupplier, assertPurchaseOrderWrite, isEditableStatus } from './access.server'
import { allocatePurchaseOrderNumber, displayNumberFor } from './numbering.server'
import {
  auditPurchaseOrder,
  recordStatus,
  replaceLines,
} from './records.server'

function totalsFor(input: PurchaseOrderCreateInput) {
  return calculatePurchaseOrderTotals({
    taxProvince: input.taxCode,
    appliedTaxRate: input.appliedTaxRate,
    parts: input.parts.map((line) => ({ qty: line.qty, price: line.price })),
    specialParts: input.specialParts.map((line) => ({
      name: line.name,
      qty: line.qty,
      price: line.price,
    })),
  })
}

function validateInput(input: PurchaseOrderCreateInput): void {
  if (!input.shipmentType) throw new ValidationError('Choose a ship-to type.')
  if (input.parts.length === 0 && input.specialParts.length === 0) {
    throw new ValidationError('A purchase order needs at least one line.')
  }
  for (const line of input.parts) {
    if (Number(line.qty) < 0) throw new ValidationError('Part quantity cannot be negative.')
  }
  for (const line of input.specialParts) {
    if (Number(line.qty) < 0) throw new ValidationError('Special-part quantity cannot be negative.')
  }
}

export interface CreatePurchaseOrderResult {
  id: number
  displayNumber: string
  version: number
}

export async function createPurchaseOrderCore(
  tx: Tx,
  input: PurchaseOrderCreateInput,
  session: AuthSessionView,
): Promise<CreatePurchaseOrderResult> {
  assertPurchaseOrderWrite(session)
  validateInput(input)

  const supplier = await loadSupplier(tx, input.supplierId)
  if (input.transferFromPoId) {
    const [source] = await tx
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, input.transferFromPoId))
      .limit(1)
    if (!source) throw new ValidationError('The source purchase order for the transfer does not exist.')
  }

  const totals = totalsFor(input)
  const number = await allocatePurchaseOrderNumber(tx, {
    transferFromPoId: input.transferFromPoId ?? null,
  })

  const [row] = await tx
    .insert(purchaseOrders)
    .values({
      id: number.id,
      displayNumber: input.transferFromPoId ? number.displayNumber : null,
      supplierId: supplier.id,
      subSupplierId: input.subSupplierId ?? null,
      status: 3,
      priorityId: input.priorityId ?? null,
      shipmentType: input.shipmentType,
      shipContact: input.shipContact ?? null,
      shipCompany: input.shipCompany ?? supplier.name,
      shipStreet1: input.shipStreet1 ?? null,
      shipStreet2: input.shipStreet2 ?? null,
      shipCity: input.shipCity ?? null,
      shipProvince: input.shipProvince ?? null,
      shipPostalCode: input.shipPostalCode ?? null,
      shipPhone: input.shipPhone ?? null,
      expectedDelivery: input.expectedDelivery ?? null,
      supplierNotes: input.supplierNotes ?? null,
      notes: input.notes ?? null,
      fob: input.fob ?? null,
      payTerms: input.payTerms ?? null,
      shipVia: input.shipVia ?? null,
      taxCode: (input.taxCode || 'ON').toUpperCase(),
      appliedTaxRate: input.appliedTaxRate ?? null,
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
      isTransfer: Boolean(input.isTransfer ?? input.transferFromPoId),
      transferFromPoId: input.transferFromPoId ?? null,
      preorderId: input.preorderId ?? null,
      rfqId: input.rfqId ?? null,
      supplierQuoteId: input.supplierQuoteId ?? null,
      createdBy: session.user.id,
      updatedBy: session.user.id,
    })
    .returning()

  if (!row) throw new ValidationError('The purchase order could not be created.')

  await replaceLines(tx, row.id, input)
  await recordStatus(tx, session, {
    poId: row.id,
    from: null,
    to: 3,
    action: 'create',
    version: row.version,
  })
  await auditPurchaseOrder(tx, session, 'purchase_order.create', row.id, {
    summary: `Created purchase order ${displayNumberFor(row.id, row.displayNumber)}.`,
    after: row as unknown as Record<string, unknown>,
  })

  return { id: row.id, displayNumber: displayNumberFor(row.id, row.displayNumber), version: row.version }
}

export async function updatePurchaseOrderCore(
  tx: Tx,
  input: PurchaseOrderUpdateInput,
  session: AuthSessionView,
): Promise<CreatePurchaseOrderResult> {
  assertPurchaseOrderWrite(session)
  validateInput(input)

  const [current] = await tx
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, input.id))
    .limit(1)
  if (!current) throw new ValidationError('The purchase order does not exist.')
  if (!isEditableStatus(current.status)) {
    throw new ValidationError(
      'This purchase order cannot be edited after a receipt; only notes and tracking may change.',
    )
  }
  if (current.version !== input.version) {
    throw new ValidationError('This purchase order changed since it was loaded. Reload and retry.')
  }

  await loadSupplier(tx, input.supplierId)
  const totals = totalsFor(input)
  const resetApproval = current.status === 8 || current.status === 2 || current.status === 6
  const nextStatus = resetApproval ? 3 : current.status
  const nextVersion = current.version + 1

  const [row] = await tx
    .update(purchaseOrders)
    .set({
      supplierId: input.supplierId,
      subSupplierId: input.subSupplierId ?? null,
      priorityId: input.priorityId ?? null,
      shipmentType: input.shipmentType,
      shipContact: input.shipContact ?? null,
      shipCompany: input.shipCompany ?? null,
      shipStreet1: input.shipStreet1 ?? null,
      shipStreet2: input.shipStreet2 ?? null,
      shipCity: input.shipCity ?? null,
      shipProvince: input.shipProvince ?? null,
      shipPostalCode: input.shipPostalCode ?? null,
      shipPhone: input.shipPhone ?? null,
      expectedDelivery: input.expectedDelivery ?? null,
      supplierNotes: input.supplierNotes ?? null,
      notes: input.notes ?? null,
      fob: input.fob ?? null,
      payTerms: input.payTerms ?? null,
      shipVia: input.shipVia ?? null,
      taxCode: (input.taxCode || 'ON').toUpperCase(),
      appliedTaxRate: input.appliedTaxRate ?? null,
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
      status: nextStatus,
      isApproved: resetApproval ? false : current.isApproved,
      approvalRequestBy: resetApproval ? null : current.approvalRequestBy,
      approvedBy: resetApproval ? null : current.approvedBy,
      approvedAt: resetApproval ? null : current.approvedAt,
      approvalRevision: resetApproval ? null : current.approvalRevision,
      selfApproved: resetApproval ? false : current.selfApproved,
      version: nextVersion,
      updatedBy: session.user.id,
      updatedAt: new Date(),
    })
    .where(eq(purchaseOrders.id, input.id))
    .returning()

  if (!row) throw new ValidationError('The purchase order could not be updated.')

  await replaceLines(tx, row.id, input)
  if (resetApproval) {
    await recordStatus(tx, session, {
      poId: row.id,
      from: current.status as 8 | 2 | 6,
      to: 3,
      action: 'edit_after_approval',
      version: nextVersion,
      note: 'Commercial edit cleared approval; re-approval required.',
    })
  }
  await auditPurchaseOrder(tx, session, 'purchase_order.update', row.id, {
    summary: `Updated purchase order ${displayNumberFor(row.id, row.displayNumber)}${
      resetApproval ? '; approval cleared' : ''
    }.`,
    before: current as unknown as Record<string, unknown>,
    after: row as unknown as Record<string, unknown>,
  })

  return { id: row.id, displayNumber: displayNumberFor(row.id, row.displayNumber), version: row.version }
}

export async function createPurchaseOrder(
  input: PurchaseOrderCreateInput,
  session: AuthSessionView,
  executor?: Db,
): Promise<CreatePurchaseOrderResult> {
  const db = executor ?? (await import('@cls/db')).getDb()
  return db.transaction((tx) => createPurchaseOrderCore(tx, input, session))
}

export async function updatePurchaseOrder(
  input: PurchaseOrderUpdateInput,
  session: AuthSessionView,
  executor?: Db,
): Promise<CreatePurchaseOrderResult> {
  const db = executor ?? (await import('@cls/db')).getDb()
  return db.transaction((tx) => updatePurchaseOrderCore(tx, input, session))
}
