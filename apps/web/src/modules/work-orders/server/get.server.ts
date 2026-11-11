/**
 * Work-order detail query.
 *
 * SERVER ONLY. Loading a work order is always scoped: a subcontractor can only
 * load its own company's records and a technician only assigned ones. The
 * comparison lives in `access.server.ts`, not in a component.
 */
import { and, desc, eq, inArray } from 'drizzle-orm'
import { getDb, type Db } from '@cls/db'
import {
  auditLog,
  legacyCustomer,
  legacySites,
  legacySubcontractor,
  legacyWoCategories,
  legacyWoPriority,
  legacyWoServtype,
  localWorkOrderHours,
  localWorkOrderSignatures,
  workOrderAssignments,
  workOrderDocuments,
  workOrderHours,
  workOrderNotes,
  workOrderParts,
  workOrderRevisions,
  workOrderReports,
  workOrderSpecialParts,
  workOrderTax,
  users,
} from '@cls/db/schema'
import { getStorage } from '@cls/storage'
import type { AuthSessionView } from '../../../server/auth.types'
import type {
  JsonValue,
  TriageFlag,
  WorkOrderDetail,
  WorkOrderDocumentView,
} from '../types'
import { triageFromColumns } from '../lib/rules'
import { isWorkOrderStatus, statusProjection } from '../lib/status'
import {
  canCalculateInvoice,
  hasGrant,
  hasScopedGrant,
  loadAccessibleWorkOrder,
} from './access.server'
import { getSubcontractorWsibState, userDisplayNames } from '../lib/lookups'

async function signedUrl(key: string): Promise<string | null> {
  try {
    return await getStorage('assets').getSignedUrl(key, 300)
  } catch {
    return null
  }
}

export async function getWorkOrderDetail(
  session: AuthSessionView,
  id: number,
  executor?: Db,
): Promise<WorkOrderDetail> {
  const row = await loadAccessibleWorkOrder(session, id, executor)
  const db = executor ?? getDb()

  const [
    siteRows,
    subcontractorRows,
    serviceTypeRows,
    priorityRows,
    categoryRows,
    taxRows,
    reportRows,
    hourRows,
    partRows,
    specialPartRows,
    localHourRows,
    signatureRows,
    documentRows,
    revisionRows,
    noteRows,
    activityRows,
    assignmentRows,
  ] = await Promise.all([
    db
      .select({
        id: legacySites.id,
        name: legacySites.name,
        street: legacySites.street,
        city: legacySites.city,
        province: legacySites.province,
        postalCode: legacySites.postalcode,
        contactName: legacySites.cname,
        contactNumber: legacySites.cnumber,
        customerId: legacyCustomer.id,
        customerName: legacyCustomer.name,
      })
      .from(legacySites)
      .leftJoin(legacyCustomer, eq(legacySites.custid, legacyCustomer.id))
      .where(eq(legacySites.id, row.siteId))
      .limit(1),
    row.subcontractorId
      ? db
          .select({ id: legacySubcontractor.id, name: legacySubcontractor.name })
          .from(legacySubcontractor)
          .where(eq(legacySubcontractor.id, row.subcontractorId))
          .limit(1)
      : Promise.resolve([]),
    db
      .select({ name: legacyWoServtype.name })
      .from(legacyWoServtype)
      .where(eq(legacyWoServtype.id, row.serviceTypeId))
      .limit(1),
    db
      .select({ name: legacyWoPriority.name })
      .from(legacyWoPriority)
      .where(eq(legacyWoPriority.id, row.priorityId))
      .limit(1),
    row.categoryId
      ? db
          .select({ name: legacyWoCategories.name })
          .from(legacyWoCategories)
          .where(eq(legacyWoCategories.id, row.categoryId))
          .limit(1)
      : Promise.resolve([]),
    db.select().from(workOrderTax).where(eq(workOrderTax.workOrderId, id)).limit(1),
    db
      .select({ report: workOrderReports.report })
      .from(workOrderReports)
      .where(eq(workOrderReports.workOrderId, id))
      .limit(1),
    db
      .select()
      .from(workOrderHours)
      .where(eq(workOrderHours.workOrderId, id))
      .orderBy(workOrderHours.lineDate, workOrderHours.id),
    db
      .select()
      .from(workOrderParts)
      .where(eq(workOrderParts.workOrderId, id))
      .orderBy(workOrderParts.id),
    db
      .select()
      .from(workOrderSpecialParts)
      .where(eq(workOrderSpecialParts.workOrderId, id))
      .orderBy(workOrderSpecialParts.id),
    db
      .select()
      .from(localWorkOrderHours)
      .where(eq(localWorkOrderHours.workOrderId, id))
      .orderBy(localWorkOrderHours.lineDate, localWorkOrderHours.id),
    db
      .select()
      .from(localWorkOrderSignatures)
      .where(eq(localWorkOrderSignatures.workOrderId, id))
      .orderBy(desc(localWorkOrderSignatures.capturedAt)),
    db
      .select()
      .from(workOrderDocuments)
      .where(eq(workOrderDocuments.workOrderId, id))
      .orderBy(desc(workOrderDocuments.uploadedAt)),
    db
      .select({
        revisionId: workOrderRevisions.revisionId,
        createdAt: workOrderRevisions.createdAt,
        revisionType: workOrderRevisions.revisionType,
        revisedByUserId: workOrderRevisions.revisedByUserId,
        isLastRevision: workOrderRevisions.isLastRevision,
      })
      .from(workOrderRevisions)
      .where(eq(workOrderRevisions.workOrderId, id))
      .orderBy(desc(workOrderRevisions.createdAt), desc(workOrderRevisions.revisionId))
      .limit(100),
    db
      .select()
      .from(workOrderNotes)
      .where(eq(workOrderNotes.workOrderId, id))
      .orderBy(desc(workOrderNotes.createdAt), desc(workOrderNotes.id))
      .limit(100),
    db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityType, 'work_order'), eq(auditLog.entityId, String(id))))
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(100),
    db
      .select()
      .from(workOrderAssignments)
      .where(eq(workOrderAssignments.workOrderId, id))
      .orderBy(workOrderAssignments.assignedAt),
  ])

  const wsib = row.subcontractorId
    ? await getSubcontractorWsibState(row.subcontractorId, executor)
    : { valid: true, expirationDate: null, documentType: null }

  const names = await userDisplayNames(
    [
      ...new Set(
        [
          row.createdBy,
          row.updatedBy,
          ...noteRows.map((note) => note.userId),
          ...assignmentRows.map((assignment) => assignment.techUserId),
          ...revisionRows.map((revision) => revision.revisedByUserId),
        ].filter((value): value is string => Boolean(value)),
      ),
    ],
    executor,
  )

  const statusCode = isWorkOrderStatus(row.status) ? row.status : 1
  const status = statusProjection(statusCode)
  const triage: TriageFlag[] = triageFromColumns(row)
  const canEdit = hasGrant(session, 'workorder:write')
  const canOverrideWsib = row.subcontractorId
    ? hasScopedGrant(session, 'workorder:override_wsib_hold', row.subcontractorId)
    : hasGrant(session, 'workorder:override_wsib_hold')

  const documents: WorkOrderDocumentView[] = await Promise.all(
    documentRows.map(async (document) => ({
      id: document.id,
      kind: document.kind,
      filename: document.filename,
      contentType: document.contentType,
      sizeBytes: document.sizeBytes,
      caption: document.caption,
      uploadedAt: document.uploadedAt.toISOString(),
      url: await signedUrl(document.storageKey),
    })),
  )

  const taxRow = taxRows[0]

  return {
    id: row.id,
    series: row.series === 2 ? 2 : 1,
    status: statusCode,
    statusProjection: status,
    siteId: row.siteId,
    site: siteRows[0]
      ? {
          id: siteRows[0].id,
          name: siteRows[0].name,
          street: siteRows[0].street,
          city: siteRows[0].city,
          province: siteRows[0].province,
          postalCode: siteRows[0].postalCode ?? null,
          contactName: siteRows[0].contactName ?? null,
          contactNumber: siteRows[0].contactNumber ?? null,
          customerId: siteRows[0].customerId ?? null,
          customerName: siteRows[0].customerName ?? null,
        }
      : null,
    subcontractor: subcontractorRows[0] ?? null,
    serviceTypeId: row.serviceTypeId,
    serviceTypeName: serviceTypeRows[0]?.name ?? null,
    priorityId: row.priorityId,
    priorityName: priorityRows[0]?.name ?? null,
    categoryId: row.categoryId,
    categoryName: categoryRows[0]?.name ?? null,
    dateTaken: row.dateTaken,
    expectedCompletion: row.expectedCompletion,
    serviceRequired: row.serviceRequired,
    notes: row.notes,
    customerPo: row.customerPo,
    isLocal: row.isLocal,
    isProject: row.isProject,
    isTjxQuote: row.isTjxQuote,
    isPmaOrder: row.isPmaOrder,
    triage,
    completedAt: row.completedAt?.toISOString() ?? null,
    completionNote: row.completionNote,
    invoicedAt: row.invoicedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdByLabel: row.createdBy ? (names.get(row.createdBy) ?? null) : null,
    updatedByLabel: row.updatedBy ? (names.get(row.updatedBy) ?? null) : null,
    tax: {
      taxProvince: taxRow?.taxProvince ?? 'ON',
      appliedTaxRate: taxRow?.appliedTaxRate ?? null,
      appliedTaxRatePst: taxRow?.appliedTaxRatePst ?? null,
      manualTaxAmount: taxRow?.manualTaxAmount ?? null,
      manualSubtotalAmount: taxRow?.manualSubtotalAmount ?? null,
      subtotalAmount: taxRow?.subtotalAmount ?? null,
      taxTotal: taxRow?.taxTotal ?? null,
      totalAmount: taxRow?.totalAmount ?? null,
      computedAt: taxRow?.computedAt?.toISOString() ?? null,
    },
    report: reportRows[0]?.report ?? '',
    hours: hourRows.map((line) => ({
      id: line.id,
      lineDate: line.lineDate,
      hours: line.hours,
      rateCode: line.rateCode,
      hourlyRate: line.hourlyRate,
      techUserId: line.techUserId,
      note: line.note,
    })),
    parts: partRows.map((line) => ({
      id: line.id,
      partNo: line.partNo,
      description: line.description,
      qty: line.qty,
      price: line.price,
    })),
    specialParts: specialPartRows.map((line) => ({
      id: line.id,
      name: line.name,
      qty: line.qty,
      price: line.price,
      isEmergencyLighting: line.isEmergencyLighting,
    })),
    localHours: localHourRows.map((line) => ({
      id: line.id,
      lineDate: line.lineDate,
      timeIn: line.timeIn,
      timeOut: line.timeOut,
      hours: line.hours,
      headcount: line.headcount,
      techUserId: line.techUserId,
    })),
    signatures: signatureRows.map((line) => ({
      id: line.id,
      signerName: line.signerName,
      storageKey: line.storageKey,
      note: line.note,
      capturedAt: line.capturedAt.toISOString(),
    })),
    documents,
    revisions: revisionRows.map((revision) => ({
      revisionId: revision.revisionId,
      createdAt: revision.createdAt.toISOString(),
      revisionType: revision.revisionType,
      revisedByUserId: revision.revisedByUserId,
      isLastRevision: revision.isLastRevision,
    })),
    noteHistory: noteRows.map((note) => ({
      id: note.id,
      title: note.title,
      notes: note.notes,
      notesType: note.notesType,
      previousStatus: note.previousStatus,
      statusId: note.statusId,
      isPublic: note.isPublic,
      createdAt: note.createdAt.toISOString(),
      actorLabel: note.userId ? (names.get(note.userId) ?? null) : null,
    })),
    activity: activityRows.map((activity) => ({
      id: activity.id,
      action: activity.action,
      summary: activity.summary,
      actorLabel: activity.actorLabel,
      actorRole: activity.actorRole,
      createdAt: activity.createdAt.toISOString(),
      before: (activity.before ?? null) as JsonValue | null,
      after: (activity.after ?? null) as JsonValue | null,
    })),
    assignments: assignmentRows.map((assignment) => ({
      id: assignment.id,
      techUserId: assignment.techUserId,
      techName: assignment.techUserId ? (names.get(assignment.techUserId) ?? null) : null,
      subcontractorId: assignment.subcontractorId,
      subcontractorName:
        assignment.subcontractorId === row.subcontractorId
          ? (subcontractorRows[0]?.name ?? null)
          : null,
      role: assignment.role,
      assignedAt: assignment.assignedAt.toISOString(),
    })),
    wsib: {
      valid: wsib.valid,
      documentType: wsib.documentType,
      expirationDate: wsib.expirationDate,
      canOverride: canOverrideWsib,
      overrideUsed: false,
    },
    capabilities: {
      canEdit,
      canCapture: hasGrant(session, 'workorder:capture'),
      canDispatch: hasGrant(session, 'workorder:dispatch'),
      canApprove: hasGrant(session, 'workorder:approve'),
      canManageRevisions: canEdit,
      canCalculateInvoice: canCalculateInvoice(session),
      canOverrideWsib,
    },
  }
}

/** Used by the notes panel to resolve the current actor's display name. */
export async function currentUserDisplayName(
  userId: string,
  executor?: Db,
): Promise<string | null> {
  const rows = await (executor ?? getDb())
    .select({ displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, [userId]))
    .limit(1)
  return rows[0]?.displayName ?? null
}
