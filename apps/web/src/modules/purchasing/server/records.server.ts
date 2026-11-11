import { writeAudit } from '@cls/auth'
import { eq } from 'drizzle-orm'
import type { Tx } from '@cls/db'
import { purchaseOrderParts, purchaseOrderSpecialParts, purchaseOrderStatusHistory } from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import type { PurchaseOrderCreateInput, PurchaseOrderStatus } from '../types'

export async function auditPurchaseOrder(
  tx: Tx,
  session: AuthSessionView,
  action: string,
  id: number,
  input: {
    summary: string
    before?: Record<string, unknown> | null
    after?: Record<string, unknown> | null
    permission?: string
  },
): Promise<void> {
  await writeAudit(tx, {
    action,
    actorUserId: session.user.id,
    actorLabel: session.user.username,
    actorRole: session.user.role,
    entityType: 'purchase_order',
    entityId: String(id),
    summary: input.summary,
    permission: input.permission ?? 'purchasing:write',
    before: input.before ?? null,
    after: input.after ?? null,
  })
}

export async function recordStatus(
  tx: Tx,
  session: AuthSessionView,
  input: {
    poId: number
    from: PurchaseOrderStatus | null
    to: PurchaseOrderStatus
    action: string
    version: number
    selfApproved?: boolean
    note?: string | null
  },
): Promise<void> {
  await tx.insert(purchaseOrderStatusHistory).values({
    poId: input.poId,
    fromStatus: input.from,
    toStatus: input.to,
    action: input.action,
    actorId: session.user.id,
    actorLabel: session.user.username,
    poVersion: input.version,
    selfApproved: input.selfApproved ?? false,
    note: input.note ?? null,
  })
}

export async function replaceLines(
  tx: Tx,
  poId: number,
  input: Pick<PurchaseOrderCreateInput, 'parts' | 'specialParts'>,
): Promise<void> {
  await tx.delete(purchaseOrderParts).where(eq(purchaseOrderParts.poId, poId))
  await tx.delete(purchaseOrderSpecialParts).where(eq(purchaseOrderSpecialParts.poId, poId))

  if (input.parts.length > 0) {
    await tx.insert(purchaseOrderParts).values(
      input.parts.map((line, index) => ({
        poId,
        partNo: line.partNo,
        description: line.description ?? null,
        qty: line.qty,
        price: line.price,
        itemPurchaseType: line.itemPurchaseType ?? null,
        itemPurchaseTypeNumber: line.itemPurchaseTypeNumber ?? null,
        workOrderNumber:
          line.itemPurchaseType === 'workorder' && line.itemPurchaseTypeNumber
            ? Number(line.itemPurchaseTypeNumber) || null
            : null,
        sortOrder: index,
      })),
    )
  }

  if (input.specialParts.length > 0) {
    await tx.insert(purchaseOrderSpecialParts).values(
      input.specialParts.map((line, index) => ({
        poId,
        name: line.name,
        qty: line.qty,
        price: line.price,
        itemPurchaseType: line.itemPurchaseType ?? null,
        itemPurchaseTypeNumber: line.itemPurchaseTypeNumber ?? null,
        sortOrder: index,
      })),
    )
  }
}
