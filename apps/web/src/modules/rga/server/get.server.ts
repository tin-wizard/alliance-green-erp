/**
 * RGA reads. Queries are scoped here, not in the UI: a subcontractor account
 * can only ever load its own company's rows.
 */
import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
import type { Db, Executor } from '@cls/db'
import {
  purchaseOrders,
  rgaCreditLines,
  rgaCredits,
  rgaNotifications,
  rgaParts,
  rgas,
  rgaSpecialParts,
  rgaStatusHistory,
  sites,
  subcontractors,
  suppliers,
  users,
  workOrders,
} from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import { rgaNumber, statusLabel } from '../lib/lifecycle'
import { assertRgaRead, loadRga, subcontractorScope } from './access.server'

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

export async function listRgas(
  session: AuthSessionView,
  filters: { status?: number; type?: string; search?: string; limit?: number },
  executor: Db | Executor,
) {
  assertRgaRead(session)
  const conditions: SQL[] = []
  const scope = subcontractorScope(session)
  if (scope !== null) conditions.push(eq(rgas.subcontractorId, scope))
  if (filters.status) conditions.push(eq(rgas.status, filters.status))
  if (filters.type) conditions.push(eq(rgas.rgaType, filters.type))
  const term = (filters.search ?? '').trim()
  if (term) {
    conditions.push(
      or(
        ilike(suppliers.name, `%${term}%`),
        sql`cast(${rgas.id} as text) ilike ${`%${term}%`}`,
        ilike(rgas.rgaInvoiceNumber, `%${term}%`),
        sql`cast(${workOrders.id} as text) ilike ${`%${term}%`}`,
      )!,
    )
  }

  const rows = await executor
    .select({
      id: rgas.id,
      rgaType: rgas.rgaType,
      status: rgas.status,
      requestDate: rgas.requestDate,
      supplierName: suppliers.name,
      purchaseOrderNumber: purchaseOrders.displayNumber,
      workOrderNumber: workOrders.id,
      siteName: sites.name,
      subcontractorName: subcontractors.name,
      totalReturnQty: sql<string>`(
        select coalesce(sum(${rgaParts.returnQty}), 0)
        from ${rgaParts}
        where ${rgaParts.rgaId} = ${rgas.id}
      )`,
      creditNumber: rgaCredits.creditNumber,
      version: rgas.version,
    })
    .from(rgas)
    .leftJoin(suppliers, eq(suppliers.id, rgas.supplierId))
    .leftJoin(purchaseOrders, eq(purchaseOrders.id, rgas.poId))
    .leftJoin(workOrders, eq(workOrders.id, rgas.workOrderId))
    .leftJoin(sites, eq(sites.id, rgas.siteId))
    .leftJoin(subcontractors, eq(subcontractors.id, rgas.subcontractorId))
    .leftJoin(rgaCredits, eq(rgaCredits.rgaId, rgas.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(rgas.requestDate), desc(rgas.id))
    .limit(filters.limit ?? 100)

  return rows.map((row) => ({
    ...row,
    number: rgaNumber(row.id),
    statusLabel: statusLabel(row.status),
    requestDate: row.requestDate,
  }))
}

export async function getRgaDetail(
  session: AuthSessionView,
  id: number,
  executor: Db | Executor,
) {
  const header = await loadRga(session, id, executor)
  const [supplier] = header.supplierId
    ? await executor
        .select({
          id: suppliers.id,
          name: suppliers.name,
          address: suppliers.address,
          city: suppliers.city,
          province: suppliers.province,
          postalCode: suppliers.postalCode,
        })
        .from(suppliers)
        .where(eq(suppliers.id, header.supplierId))
        .limit(1)
    : []
  const [po] = header.poId
    ? await executor
        .select({ id: purchaseOrders.id, displayNumber: purchaseOrders.displayNumber })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, header.poId))
        .limit(1)
    : []
  const [wo] = header.workOrderId
    ? await executor
        .select({ id: workOrders.id, number: workOrders.id })
        .from(workOrders)
        .where(eq(workOrders.id, header.workOrderId))
        .limit(1)
    : []
  const [site] = header.siteId
    ? await executor
        .select({
          id: sites.id,
          name: sites.name,
          street: sites.street,
          city: sites.city,
          province: sites.province,
          postalCode: sites.postalCode,
        })
        .from(sites)
        .where(eq(sites.id, header.siteId))
        .limit(1)
    : []
  const [subcontractor] = header.subcontractorId
    ? await executor
        .select({ id: subcontractors.id, name: subcontractors.name })
        .from(subcontractors)
        .where(eq(subcontractors.id, header.subcontractorId))
        .limit(1)
    : []

  const [parts, specialParts, history, creditRows, notifications] = await Promise.all([
    executor.select().from(rgaParts).where(eq(rgaParts.rgaId, id)).orderBy(rgaParts.position),
    executor
      .select()
      .from(rgaSpecialParts)
      .where(eq(rgaSpecialParts.rgaId, id))
      .orderBy(rgaSpecialParts.position),
    executor
      .select({
        id: rgaStatusHistory.id,
        fromStatus: rgaStatusHistory.fromStatus,
        toStatus: rgaStatusHistory.toStatus,
        action: rgaStatusHistory.action,
        actorLabel: rgaStatusHistory.actorLabel,
        note: rgaStatusHistory.note,
        rgaVersion: rgaStatusHistory.rgaVersion,
        createdAt: rgaStatusHistory.createdAt,
      })
      .from(rgaStatusHistory)
      .where(eq(rgaStatusHistory.rgaId, id))
      .orderBy(desc(rgaStatusHistory.createdAt), desc(rgaStatusHistory.id)),
    executor.select().from(rgaCredits).where(eq(rgaCredits.rgaId, id)).limit(1),
    executor
      .select({
        id: rgaNotifications.id,
        notifyType: rgaNotifications.notifyType,
        status: rgaNotifications.status,
        dueAt: rgaNotifications.dueAt,
        subject: rgaNotifications.subject,
        sentAt: rgaNotifications.sentAt,
        lastError: rgaNotifications.lastError,
        createdAt: rgaNotifications.createdAt,
      })
      .from(rgaNotifications)
      .where(eq(rgaNotifications.rgaId, id))
      .orderBy(desc(rgaNotifications.createdAt))
      .limit(20),
  ])

  const credit = creditRows[0]
    ? {
        ...creditRows[0],
        lines: await executor
          .select()
          .from(rgaCreditLines)
          .where(eq(rgaCreditLines.creditId, creditRows[0].id))
          .orderBy(rgaCreditLines.position),
      }
    : null

  return {
    rga: {
      ...header,
      number: rgaNumber(header.id),
      statusLabel: statusLabel(header.status),
      requestDate: header.requestDate,
      rgaInvoiceDate: header.rgaInvoiceDate,
      approvedAt: iso(header.approvedAt),
      completedAt: iso(header.completedAt),
      createdAt: header.createdAt.toISOString(),
      updatedAt: header.updatedAt.toISOString(),
    },
    supplier: supplier ?? null,
    purchaseOrder: po ?? null,
    workOrder: wo ?? null,
    site: site ?? null,
    subcontractor: subcontractor ?? null,
    parts,
    specialParts,
    history: history.map((row) => ({
      ...row,
      fromStatusLabel: row.fromStatus === null ? null : statusLabel(row.fromStatus),
      toStatusLabel: statusLabel(row.toStatus),
      createdAt: row.createdAt.toISOString(),
    })),
    credit: credit
      ? {
          ...credit,
          creditDate: credit.creditDate,
          postedAt: iso(credit.postedAt),
          createdAt: credit.createdAt.toISOString(),
        }
      : null,
    notifications: notifications.map((row) => ({
      ...row,
      dueAt: row.dueAt.toISOString(),
      sentAt: iso(row.sentAt),
      createdAt: row.createdAt.toISOString(),
    })),
  }
}

/** Creator labels for the approver's queue, joined in one query. */
export async function recentRgaActivity(
  session: AuthSessionView,
  executor: Db | Executor,
) {
  assertRgaRead(session)
  const scope = subcontractorScope(session)
  return executor
    .select({
      id: rgaStatusHistory.id,
      rgaId: rgaStatusHistory.rgaId,
      action: rgaStatusHistory.action,
      actorLabel: rgaStatusHistory.actorLabel,
      note: rgaStatusHistory.note,
      createdAt: rgaStatusHistory.createdAt,
      createdByName: users.displayName,
    })
    .from(rgaStatusHistory)
    .leftJoin(users, eq(users.id, rgaStatusHistory.actorId))
    .leftJoin(rgas, eq(rgas.id, rgaStatusHistory.rgaId))
    .where(scope === null ? undefined : eq(rgas.subcontractorId, scope))
    .orderBy(desc(rgaStatusHistory.createdAt))
    .limit(20)
}
