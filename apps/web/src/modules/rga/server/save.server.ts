/**
 * Raise and edit RGAs. The header points at a supplier and optionally a
 * purchase order and work order; lines are replaced wholesale inside one
 * transaction, exactly like the legacy save screen.
 */
import { and, eq } from 'drizzle-orm'
import { ForbiddenError, NotFoundError, ValidationError } from '@cls/core'
import type { Tx } from '@cls/db'
import {
  purchaseOrders,
  rgaNotifications,
  rgaParts,
  rgas,
  rgaSpecialParts,
  rgaStatusHistory,
  workOrders,
} from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import { canEdit } from '../lib/lifecycle'
import type { CreateRgaInput, UpdateRgaInput } from '../lib/validation'
import { assertRgaWrite, loadRga, subcontractorScope } from './access.server'
import { auditRga, rgaSnapshot } from './records.server'

interface ResolvedContext {
  supplierId: number | null
  poId: number | null
  workOrderId: number | null
  siteId: number | null
  subcontractorId: number | null
}

async function resolveContext(
  tx: Tx,
  session: AuthSessionView,
  input: {
    supplierId?: number | null
    poId?: number | null
    workOrderId?: number | null
    siteId?: number | null
  },
): Promise<ResolvedContext> {
  let siteId = input.siteId ?? null
  let subcontractorId: number | null = null

  if (input.workOrderId) {
    const [wo] = await tx
      .select({
        id: workOrders.id,
        siteId: workOrders.siteId,
        subcontractorId: workOrders.subcontractorId,
      })
      .from(workOrders)
      .where(eq(workOrders.id, input.workOrderId))
      .limit(1)
    if (!wo) throw new NotFoundError('Work order')
    if (siteId !== null && siteId !== wo.siteId) {
      throw new ValidationError('The work order belongs to a different site.')
    }
    siteId = siteId ?? wo.siteId
    subcontractorId = wo.subcontractorId
  }

  // Subcontractor accounts can only raise against their own work orders.
  const scope = subcontractorScope(session)
  if (scope !== null) {
    if (!input.workOrderId) {
      throw new ForbiddenError('A subcontractor must raise an RGA against one of its work orders.')
    }
    if (subcontractorId !== scope) {
      throw new ForbiddenError('That work order belongs to another subcontractor.')
    }
    subcontractorId = scope
  }

  let supplierId = input.supplierId ?? null
  if (input.poId) {
    const [po] = await tx
      .select({ id: purchaseOrders.id, supplierId: purchaseOrders.supplierId })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, input.poId))
      .limit(1)
    if (!po) throw new NotFoundError('Purchase order')
    if (supplierId !== null && supplierId !== po.supplierId) {
      throw new ValidationError('The supplier does not match the purchase order.')
    }
    supplierId = po.supplierId
  }

  return { supplierId, poId: input.poId ?? null, workOrderId: input.workOrderId ?? null, siteId, subcontractorId }
}

async function replaceLines(tx: Tx, rgaId: number, input: CreateRgaInput | UpdateRgaInput) {
  await tx.delete(rgaParts).where(eq(rgaParts.rgaId, rgaId))
  await tx.delete(rgaSpecialParts).where(eq(rgaSpecialParts.rgaId, rgaId))

  if (input.parts.length > 0) {
    await tx.insert(rgaParts).values(
      input.parts.map((line, index) => ({
        rgaId,
        position: index + 1,
        partNo: line.partNo,
        description: line.description ?? null,
        qty: line.qty,
        returnQty: line.returnQty,
        price: line.price,
        reasonForReturn: line.reasonForReturn ?? null,
        underWarranty: line.underWarranty,
        purchaseType: line.purchaseType ?? null,
        purchaseTypeNumber: line.purchaseTypeNumber ?? null,
        poNumber: line.poNumber ?? null,
        poPartId: line.poPartId ?? null,
        modelNumber: line.modelNumber ?? null,
        originalInvoiceNumber: line.originalInvoiceNumber ?? null,
        originalInvoiceDate: line.originalInvoiceDate ?? null,
      })),
    )
  }

  if (input.specialParts.length > 0) {
    await tx.insert(rgaSpecialParts).values(
      input.specialParts.map((line, index) => ({
        rgaId,
        position: index + 1,
        name: line.name,
        description: line.description ?? null,
        qty: line.qty,
        returnQty: line.returnQty,
        price: line.price,
        reasonForReturn: line.reasonForReturn ?? null,
        purchaseType: line.purchaseType ?? null,
        purchaseTypeNumber: line.purchaseTypeNumber ?? null,
        poNumber: line.poNumber ?? null,
        poSpecialPartId: line.poSpecialPartId ?? null,
        modelNumber: line.modelNumber ?? null,
        originalInvoiceNumber: line.originalInvoiceNumber ?? null,
        originalInvoiceDate: line.originalInvoiceDate ?? null,
      })),
    )
  }
}

export async function createRgaCore(
  tx: Tx,
  input: CreateRgaInput,
  session: AuthSessionView,
) {
  assertRgaWrite(session)
  const context = await resolveContext(tx, session, input)

  if (input.rgaType === 'credit' && context.supplierId === null) {
    throw new ValidationError('A credit request needs a supplier.')
  }

  const [row] = await tx
    .insert(rgas)
    .values({
      supplierId: context.supplierId,
      poId: context.poId,
      workOrderId: context.workOrderId,
      siteId: context.siteId,
      subcontractorId: context.subcontractorId,
      rgaType: input.rgaType,
      replacementType: input.replacementType ?? null,
      status: 2,
      requestDate: input.requestDate,
      rgaNotes: input.rgaNotes ?? null,
      internalNotes: input.internalNotes ?? null,
      shippingAddress: input.shippingAddress ?? null,
      createdBy: session.user.id,
    })
    .returning()
  if (!row) throw new ValidationError('The RGA could not be created.')

  await replaceLines(tx, row.id, input)

  await tx.insert(rgaStatusHistory).values({
    rgaId: row.id,
    fromStatus: null,
    toStatus: 2,
    action: 'created',
    actorId: session.user.id,
    actorLabel: session.user.email,
    rgaVersion: row.version,
  })

  // Durable outbox row for the submission itself. The reminder job adds more.
  await tx
    .insert(rgaNotifications)
    .values({
      rgaId: row.id,
      notifyType: 'Submission',
      status: 'pending',
      recipientUserId: session.user.id,
      recipientEmail: session.user.email,
      subject: `RGA R-${row.id} raised`,
      body: `RGA R-${row.id} was raised and is waiting for approval.`,
      idempotencyKey: `rga:${row.id}:submitted`,
    })
    .onConflictDoNothing()

  await auditRga(tx, session, 'rga.create', row.id, {
    summary: `Raised RGA R-${row.id}.`,
    after: rgaSnapshot(row),
  })

  return row
}

export async function saveRgaCore(
  tx: Tx,
  input: UpdateRgaInput,
  session: AuthSessionView,
) {
  assertRgaWrite(session)
  const row = await loadRga(session, input.rgaId, tx)
  if (!canEdit(row.status)) {
    throw new ValidationError('This RGA can no longer be edited.')
  }
  if (row.version !== input.version) {
    throw new ValidationError('This RGA changed since you loaded it. Reload and try again.')
  }

  const context = await resolveContext(tx, session, input)
  if (input.rgaType === 'credit' && context.supplierId === null) {
    throw new ValidationError('A credit request needs a supplier.')
  }

  const [updated] = await tx
    .update(rgas)
    .set({
      supplierId: context.supplierId,
      poId: context.poId,
      workOrderId: context.workOrderId,
      siteId: context.siteId,
      subcontractorId: context.subcontractorId,
      rgaType: input.rgaType,
      replacementType: input.replacementType ?? null,
      requestDate: input.requestDate ?? row.requestDate,
      rgaNotes: input.rgaNotes ?? null,
      internalNotes: input.internalNotes ?? null,
      shippingAddress: input.shippingAddress ?? null,
      revisionNo: row.revisionNo + 1,
      version: row.version + 1,
      updatedAt: new Date(),
    })
    .where(and(eq(rgas.id, row.id), eq(rgas.version, row.version)))
    .returning()
  if (!updated) {
    throw new ValidationError('This RGA changed since you loaded it. Reload and try again.')
  }

  await replaceLines(tx, row.id, input)
  await tx.insert(rgaStatusHistory).values({
    rgaId: row.id,
    fromStatus: row.status,
    toStatus: row.status,
    action: 'edited',
    actorId: session.user.id,
    actorLabel: session.user.email,
    rgaVersion: updated.version,
  })
  await auditRga(tx, session, 'rga.update', row.id, {
    summary: `Updated RGA R-${row.id}.`,
    before: rgaSnapshot(row),
    after: rgaSnapshot(updated),
  })

  return updated
}
