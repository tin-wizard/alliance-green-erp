/**
 * Field capture: labour, parts, special-order parts, service report, local time
 * and signatures.
 *
 * SERVER ONLY. Capture is scoped like every read: a subcontractor writes only
 * to its own company's work orders and a technician only to assigned ones.
 * Terminal records reject capture — invoiced and cancelled work is immutable
 * (BUSINESS-RULES C5/B3).
 */
import { eq, sql } from 'drizzle-orm'
import { ValidationError } from '@cls/core'
import { getDb, type Db, type Tx } from '@cls/db'
import {
  localWorkOrderHours,
  localWorkOrderTechs,
  workOrderHours,
  workOrderNotes,
  workOrderParts,
  workOrderReports,
  workOrderSpecialParts,
  workOrders,
} from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import type {
  CaptureHoursInput,
  CaptureLocalHoursInput,
  CapturePartsInput,
  CaptureReportInput,
  CaptureSpecialPartsInput,
  WorkOrderStatusCode,
} from '../types'
import { assertPermission, loadAccessibleWorkOrder } from './access.server'
import { auditWorkOrder, captureRevision } from './records.server'
import { recalculateWorkOrderTax } from './tax.server'

const LOCKED_STATUSES: readonly WorkOrderStatusCode[] = [6, 10, 11]

async function beginCapture(
  tx: Tx,
  session: AuthSessionView,
  workOrderId: number,
): Promise<WorkOrderStatusCode> {
  assertPermission(session, 'workorder:capture')
  const row = await loadAccessibleWorkOrder(session, workOrderId, tx)
  const status = row.status as WorkOrderStatusCode
  if (LOCKED_STATUSES.includes(status)) {
    throw new ValidationError(
      'This work order is closed. Cancelled, declined and invoiced work orders cannot be edited.',
    )
  }
  return status
}

async function touch(tx: Tx, workOrderId: number, actorId: string): Promise<void> {
  await tx
    .update(workOrders)
    .set({
      version: sql`${workOrders.version} + 1`,
      updatedBy: actorId,
      updatedAt: new Date(),
    })
    .where(eq(workOrders.id, workOrderId))
}

export async function captureHoursCore(
  tx: Tx,
  input: CaptureHoursInput,
  session: AuthSessionView,
): Promise<{ inserted: number }> {
  await beginCapture(tx, session, input.workOrderId)
  await tx.insert(workOrderHours).values(
    input.lines.map((line) => ({
      workOrderId: input.workOrderId,
      lineDate: line.lineDate,
      hours: line.hours,
      rateCode: line.rateCode ?? 1,
      hourlyRate: line.hourlyRate,
      techUserId: line.techUserId ?? null,
      note: line.note ?? null,
      createdBy: session.user.id,
    })),
  )
  await touch(tx, input.workOrderId, session.user.id)
  await recalculateWorkOrderTax(tx, input.workOrderId)
  await auditWorkOrder(tx, session, 'workorder.capture_hours', input.workOrderId, {
    summary: `Added ${input.lines.length} labour line(s).`,
    after: { lines: input.lines },
  })
  await captureRevision(tx, input.workOrderId, 'capture', session.user.id)
  return { inserted: input.lines.length }
}

export async function capturePartsCore(
  tx: Tx,
  input: CapturePartsInput,
  session: AuthSessionView,
): Promise<{ inserted: number }> {
  await beginCapture(tx, session, input.workOrderId)
  await tx.insert(workOrderParts).values(
    input.lines.map((line) => ({
      workOrderId: input.workOrderId,
      partNo: line.partNo,
      description: line.description ?? null,
      qty: line.qty,
      price: line.price,
      createdBy: session.user.id,
    })),
  )
  await touch(tx, input.workOrderId, session.user.id)
  await recalculateWorkOrderTax(tx, input.workOrderId)
  await auditWorkOrder(tx, session, 'workorder.capture_parts', input.workOrderId, {
    summary: `Added ${input.lines.length} parts line(s).`,
    after: { lines: input.lines },
  })
  await captureRevision(tx, input.workOrderId, 'capture', session.user.id)
  return { inserted: input.lines.length }
}

export async function captureSpecialPartsCore(
  tx: Tx,
  input: CaptureSpecialPartsInput,
  session: AuthSessionView,
): Promise<{ inserted: number }> {
  await beginCapture(tx, session, input.workOrderId)
  await tx.insert(workOrderSpecialParts).values(
    input.lines.map((line) => ({
      workOrderId: input.workOrderId,
      name: line.name,
      qty: line.qty,
      price: line.price,
      isEmergencyLighting: line.isEmergencyLighting ?? false,
      createdBy: session.user.id,
    })),
  )
  await touch(tx, input.workOrderId, session.user.id)
  await recalculateWorkOrderTax(tx, input.workOrderId)
  await auditWorkOrder(tx, session, 'workorder.capture_special_parts', input.workOrderId, {
    summary: `Added ${input.lines.length} special-order line(s).`,
    after: { lines: input.lines },
  })
  await captureRevision(tx, input.workOrderId, 'capture', session.user.id)
  return { inserted: input.lines.length }
}

export async function captureReportCore(
  tx: Tx,
  input: CaptureReportInput,
  session: AuthSessionView,
): Promise<{ saved: true }> {
  await beginCapture(tx, session, input.workOrderId)
  await tx
    .insert(workOrderReports)
    .values({
      workOrderId: input.workOrderId,
      report: input.report,
      updatedBy: session.user.id,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: workOrderReports.workOrderId,
      set: { report: input.report, updatedBy: session.user.id, updatedAt: new Date() },
    })
  await touch(tx, input.workOrderId, session.user.id)
  await auditWorkOrder(tx, session, 'workorder.capture_report', input.workOrderId, {
    summary: 'Service report saved.',
    after: { length: input.report.length },
  })
  await captureRevision(tx, input.workOrderId, 'capture', session.user.id)
  return { saved: true }
}

export async function captureLocalHoursCore(
  tx: Tx,
  input: CaptureLocalHoursInput,
  session: AuthSessionView,
): Promise<{ inserted: number }> {
  await beginCapture(tx, session, input.workOrderId)
  const row = await tx
    .select({ isLocal: workOrders.isLocal })
    .from(workOrders)
    .where(eq(workOrders.id, input.workOrderId))
  if (!row[0]?.isLocal) {
    throw new ValidationError('Local time can only be captured on a local work order.')
  }

  await tx.insert(localWorkOrderHours).values(
    input.lines.map((line) => ({
      workOrderId: input.workOrderId,
      lineDate: line.lineDate,
      timeIn: line.timeIn ?? null,
      timeOut: line.timeOut ?? null,
      hours: line.hours,
      headcount: line.headcount,
      techUserId: line.techUserId ?? null,
      createdBy: session.user.id,
    })),
  )

  const techIds = [...new Set(input.lines.map((line) => line.techUserId).filter(Boolean))] as string[]
  for (const techUserId of techIds) {
    await tx
      .insert(localWorkOrderTechs)
      .values({
        workOrderId: input.workOrderId,
        techUserId,
        assignedBy: session.user.id,
      })
      .onConflictDoNothing()
  }

  await touch(tx, input.workOrderId, session.user.id)
  await recalculateWorkOrderTax(tx, input.workOrderId)
  await auditWorkOrder(tx, session, 'workorder.capture_local_hours', input.workOrderId, {
    summary: `Added ${input.lines.length} local time line(s).`,
    after: { lines: input.lines },
  })
  await captureRevision(tx, input.workOrderId, 'capture', session.user.id)
  return { inserted: input.lines.length }
}

function transactional<TInput, TOutput>(
  core: (tx: Tx, input: TInput, session: AuthSessionView) => Promise<TOutput>,
) {
  return async function run(
    input: TInput,
    session: AuthSessionView,
    executor?: Db,
  ): Promise<TOutput> {
    const db = executor ?? getDb()
    return db.transaction((tx) => core(tx, input, session))
  }
}

export const captureHours = transactional(captureHoursCore)
export const captureParts = transactional(capturePartsCore)
export const captureSpecialParts = transactional(captureSpecialPartsCore)
export const captureReport = transactional(captureReportCore)
export const captureLocalHours = transactional(captureLocalHoursCore)

/** Notes are written directly by the detail screen; kept small and audited. */
export async function addNote(
  input: { workOrderId: number; notes: string; isPublic: boolean },
  session: AuthSessionView,
  executor?: Db,
): Promise<{ id: number }> {
  const db = executor ?? getDb()
  return db.transaction(async (tx) => {
    assertPermission(session, 'workorder:write')
    await loadAccessibleWorkOrder(session, input.workOrderId, tx)
    const [row] = await tx
      .insert(workOrderNotes)
      .values({
        workOrderId: input.workOrderId,
        userId: session.user.id,
        title: 'Note',
        notes: input.notes,
        notesType: 'note',
        isPublic: input.isPublic,
      })
      .returning({ id: workOrderNotes.id })
    await auditWorkOrder(tx, session, 'workorder.note', input.workOrderId, {
      summary: 'Note added.',
    })
    return { id: row!.id }
  })
}
