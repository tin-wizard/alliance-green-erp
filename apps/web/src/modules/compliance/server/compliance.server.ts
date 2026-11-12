/**
 * Compliance read model. One query set feeds the WSIB/insurance screen, the
 * expiry dashboard, open work orders whose assignment gate is blocked, warranty
 * expiry, and the override audit trail.
 */
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { getDb, type Db } from '@cls/db'
import {
  auditLog,
  customers,
  siteWarranties,
  sites,
  subcontractorDocuments,
  subcontractors,
  userPermissions,
  users,
  workOrders,
} from '@cls/db/schema'
import { OPEN_STATUSES, statusLabel } from '../../work-orders/lib/status'
import { REMINDER_WINDOWS } from '../../master-data/server/reminders.server'
import { businessToday } from '../../master-data/lib/compliance'
import type {
  ComplianceDocumentView,
  ComplianceOverview,
  ComplianceState,
  ExpiryRow,
  MissingWsibWorkOrder,
  OverrideGrant,
  OverrideUse,
  SubcontractorComplianceView,
  WarrantyRow,
} from '../types'

type Executor = Db

function daysBetween(today: string, expiresOn: string): number {
  const start = Date.parse(`${today}T00:00:00Z`)
  const end = Date.parse(`${expiresOn.slice(0, 10)}T00:00:00Z`)
  return Math.round((end - start) / 86_400_000)
}

function windowFor(days: number): (typeof REMINDER_WINDOWS)[number] | null {
  if (days < 0) return null
  for (const window of [...REMINDER_WINDOWS].sort((left, right) => left - right)) {
    if (days <= window) return window
  }
  return null
}

function stateFor(days: number, isExpired: boolean): ComplianceState {
  if (isExpired || days < 0) return 'expired'
  if (days <= 30) return 'expiring'
  return 'valid'
}

function documentView(row: {
  id: string
  kind: string
  fileName: string | null
  documentType: string | null
  expiresOn: string | null
  isExpired: boolean
} | null, today: string): ComplianceDocumentView | null {
  if (!row) return null
  if (!row.expiresOn) {
    return {
      id: row.id,
      kind: row.kind as 'wsib' | 'insurance',
      fileName: row.fileName,
      documentType: row.documentType,
      expiresOn: null,
      daysRemaining: null,
      state: 'missing',
      window: null,
    }
  }
  const days = daysBetween(today, row.expiresOn)
  return {
    id: row.id,
    kind: row.kind as 'wsib' | 'insurance',
    fileName: row.fileName,
    documentType: row.documentType,
    expiresOn: row.expiresOn,
    daysRemaining: days,
    state: stateFor(days, row.isExpired),
    window: windowFor(days),
  }
}

export async function getComplianceOverview(
  today = businessToday(),
  executor?: Executor,
): Promise<ComplianceOverview> {
  const db = executor ?? getDb()

  const [subs, documentRows, openCounts, openRows, grantRows, auditRows, warrantyRows] =
    await Promise.all([
      db
        .select({
          id: subcontractors.id,
          name: subcontractors.name,
          province: subcontractors.province,
          isActive: subcontractors.isActive,
        })
        .from(subcontractors)
        .orderBy(asc(subcontractors.name)),
      db
        .select({
          id: subcontractorDocuments.id,
          subcontractorId: subcontractorDocuments.subcontractorId,
          kind: subcontractorDocuments.kind,
          fileName: subcontractorDocuments.fileName,
          documentType: subcontractorDocuments.documentType,
          expiresOn: subcontractorDocuments.expiresOn,
          isExpired: subcontractorDocuments.isExpired,
          uploadedAt: subcontractorDocuments.uploadedAt,
        })
        .from(subcontractorDocuments)
        .where(
          and(
            isNull(subcontractorDocuments.supersededAt),
            inArray(subcontractorDocuments.kind, ['wsib', 'insurance']),
          ),
        )
        .orderBy(desc(subcontractorDocuments.uploadedAt)),
      db
        .select({
          subcontractorId: workOrders.subcontractorId,
          count: sql<number>`count(*)::int`,
        })
        .from(workOrders)
        .where(
          and(
            isNotNull(workOrders.subcontractorId),
            inArray(workOrders.status, [...OPEN_STATUSES]),
          ),
        )
        .groupBy(workOrders.subcontractorId),
      db
        .select({
          id: workOrders.id,
          site: sites.name,
          customer: customers.name,
          subcontractorId: workOrders.subcontractorId,
          subcontractor: subcontractors.name,
          status: workOrders.status,
          dateTaken: workOrders.dateTaken,
        })
        .from(workOrders)
        .innerJoin(sites, eq(sites.id, workOrders.siteId))
        .leftJoin(customers, eq(customers.id, sites.customerId))
        .innerJoin(subcontractors, eq(subcontractors.id, workOrders.subcontractorId))
        .where(
          and(
            isNotNull(workOrders.subcontractorId),
            inArray(workOrders.status, [...OPEN_STATUSES]),
          ),
        )
        .orderBy(asc(workOrders.id)),
      db
        .select({
          userId: userPermissions.userId,
          user: users.displayName,
          email: users.email,
          scopeSubcontractorId: userPermissions.scopeSubcontractorId,
          scopeSubcontractor: subcontractors.name,
          note: userPermissions.note,
          grantedAt: userPermissions.grantedAt,
          expiresAt: userPermissions.expiresAt,
        })
        .from(userPermissions)
        .innerJoin(users, eq(users.id, userPermissions.userId))
        .leftJoin(subcontractors, eq(subcontractors.id, userPermissions.scopeSubcontractorId))
        .where(
          and(
            eq(userPermissions.permissionKey, 'workorder:override_wsib_hold'),
            eq(userPermissions.isAllowed, true),
          ),
        )
        .orderBy(asc(users.displayName)),
      db
        .select({
          id: auditLog.id,
          action: auditLog.action,
          entityId: auditLog.entityId,
          actor: sql<string>`coalesce(${auditLog.actorLabel}, ${users.displayName}, 'Unknown')`,
          reason: sql<string>`coalesce(${auditLog.summary}, '')`,
          createdAt: auditLog.createdAt,
        })
        .from(auditLog)
        .leftJoin(users, eq(users.id, auditLog.actorUserId))
        .where(ilike(auditLog.summary, '%WSIB%override%'))
        .orderBy(desc(auditLog.createdAt))
        .limit(100),
      db
        .select({
          id: siteWarranties.id,
          siteId: siteWarranties.siteId,
          site: sites.name,
          customer: customers.name,
          description: siteWarranties.description,
          expiresOn: siteWarranties.expiresOn,
          workOrderId: siteWarranties.workOrderId,
        })
        .from(siteWarranties)
        .innerJoin(sites, eq(sites.id, siteWarranties.siteId))
        .leftJoin(customers, eq(customers.id, sites.customerId))
        .where(isNotNull(siteWarranties.expiresOn))
        .orderBy(asc(siteWarranties.expiresOn))
        .limit(500),
    ])

  const latest = new Map<string, (typeof documentRows)[number]>()
  for (const row of documentRows) {
    const key = `${row.subcontractorId}:${row.kind}`
    if (!latest.has(key)) latest.set(key, row)
  }
  const openBySubcontractor = new Map(
    openCounts
      .filter((row) => row.subcontractorId !== null)
      .map((row) => [row.subcontractorId as number, row.count]),
  )

  const subcontractorViews: SubcontractorComplianceView[] = []
  for (const sub of subs) {
    const wsib = documentView(latest.get(`${sub.id}:wsib`) ?? null, today)
    const insurance = documentView(latest.get(`${sub.id}:insurance`) ?? null, today)
    const gateValid = [wsib, insurance].some(
      (document) => document?.state === 'valid' || document?.state === 'expiring',
    )
    subcontractorViews.push({
      ...sub,
      wsib,
      insurance,
      gateValid,
      openWorkOrders: openBySubcontractor.get(sub.id) ?? 0,
    })
  }
  const active = subcontractorViews.filter((row) => row.isActive)
  const gateBlocked = new Set(
    active.filter((row) => !row.gateValid).map((row) => row.id),
  )

  const expiries: ExpiryRow[] = active.flatMap((row) =>
    [row.wsib, row.insurance]
      .filter((document): document is ComplianceDocumentView => {
        return (
          document !== null &&
          document.expiresOn !== null &&
          document.daysRemaining !== null &&
          (document.state === 'expiring' || document.state === 'expired')
        )
      })
      .map((document) => ({
        kind: document.kind,
        subcontractorId: row.id,
        subcontractor: row.name,
        fileName: document.fileName,
        expiresOn: document.expiresOn!,
        daysRemaining: document.daysRemaining!,
        state: document.state,
        window: document.window,
      })),
  )

  const missingWsibWorkOrders: MissingWsibWorkOrder[] = openRows
    .filter((row) => row.subcontractorId !== null && gateBlocked.has(row.subcontractorId))
    .map((row) => ({
      id: row.id,
      site: row.site,
      customer: row.customer ?? '',
      subcontractorId: row.subcontractorId as number,
      subcontractor: row.subcontractor,
      status: row.status,
      statusLabel: statusLabel(row.status as never),
      dateTaken: row.dateTaken,
    }))

  const overrideGrants: OverrideGrant[] = grantRows.map((row) => ({
    userId: row.userId,
    user: row.user,
    email: row.email,
    scopeSubcontractorId: row.scopeSubcontractorId,
    scopeSubcontractor: row.scopeSubcontractor,
    note: row.note,
    grantedAt: row.grantedAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
  }))
  const overrideUses: OverrideUse[] = auditRows.map((row) => ({
    id: row.id,
    action: row.action,
    entityId: row.entityId,
    actor: row.actor,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  }))
  const warranties: WarrantyRow[] = warrantyRows
    .filter((row): row is typeof row & { expiresOn: string } => row.expiresOn !== null)
    .map((row) => {
      const days = daysBetween(today, row.expiresOn)
      return {
        id: row.id,
        siteId: row.siteId,
        site: row.site,
        customer: row.customer ?? '',
        description: row.description,
        expiresOn: row.expiresOn,
        daysRemaining: days,
        state: stateFor(days, false),
        workOrderId: row.workOrderId,
      }
    })

  const missingWsib = active.filter((row) => row.wsib?.state !== 'valid' && row.wsib?.state !== 'expiring').length
  const missingInsurance = active.filter(
    (row) => row.insurance?.state !== 'valid' && row.insurance?.state !== 'expiring',
  ).length

  return {
    today,
    totals: {
      activeSubcontractors: active.length,
      gateBlocked: gateBlocked.size,
      missingWsib,
      missingInsurance,
      expiring30: expiries.filter((row) => row.state === 'expiring').length,
      expired: expiries.filter((row) => row.state === 'expired').length,
      openWorkOrdersBlocked: missingWsibWorkOrders.length,
      warrantyExpiring30: warranties.filter((row) => row.state === 'expiring').length,
      warrantyExpired: warranties.filter((row) => row.state === 'expired').length,
    },
    subcontractors: subcontractorViews,
    expiries,
    missingWsibWorkOrders,
    overrideGrants,
    overrideUses,
    warranties,
  }
}
