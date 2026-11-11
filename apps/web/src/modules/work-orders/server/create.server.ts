/**
 * Create a work order.
 *
 * SERVER ONLY. Everything happens in one transaction: number allocation, the
 * header, tax/report rows, the subcontractor assignment, an initial note, the
 * audit row and the first revision snapshot.
 */
import { eq } from 'drizzle-orm'
import { ValidationError } from '@cls/core'
import { getDb, type Db, type Tx } from '@cls/db'
import {
  workOrderAssignments,
  workOrderNotes,
  workOrderNumberSeries,
  workOrderReports,
  workOrderTax,
  workOrders,
} from '@cls/db/schema'
import { SALES_TAX_TABLE } from '@cls/pricing'
import type { AuthSessionView } from '../../../server/auth.types'
import type { WorkOrderCreateInput, WorkOrderSeries } from '../types'
import {
  businessToday,
  evaluateWsibGate,
  type WsibGateResult,
} from '../lib/rules'
import {
  getSite,
  getSubcontractorWsibState,
  listCategories,
  listPriorities,
  listServiceTypes,
} from '../lib/lookups'
import { assertPermission, hasScopedGrant } from './access.server'
import { allocateWorkOrderNumber, commitWorkOrderNumber } from './numbering.server'
import { auditWorkOrder, captureRevision } from './records.server'

function taxProvinceForSite(province: string | null | undefined): string {
  const code = (province ?? '').trim().toUpperCase()
  return code in SALES_TAX_TABLE ? code : 'ON'
}

export interface CreateWorkOrderResult {
  id: number
  series: WorkOrderSeries
  warnings: string[]
}

export async function createWorkOrderCore(
  tx: Tx,
  input: WorkOrderCreateInput,
  session: AuthSessionView,
  options?: { workOrderNumber?: number },
): Promise<CreateWorkOrderResult> {
  assertPermission(session, 'workorder:create')

  const site = await getSite(input.siteId, tx)
  if (!site) throw new ValidationError('Choose a valid site for this work order.')

  const [serviceTypes, priorities, categories] = await Promise.all([
    listServiceTypes(tx),
    listPriorities(tx),
    listCategories(tx),
  ])
  if (!serviceTypes.some((option) => option.id === input.serviceTypeId)) {
    throw new ValidationError('Choose a valid service type.')
  }
  if (!priorities.some((option) => option.id === input.priorityId)) {
    throw new ValidationError('Choose a valid priority.')
  }
  if (input.categoryId && !categories.some((option) => option.id === input.categoryId)) {
    throw new ValidationError('Choose a valid category.')
  }

  const series: WorkOrderSeries = input.series === 2 ? 2 : 1

  let wsib: WsibGateResult = { allowed: true, overrideUsed: false, reason: null }
  if (input.subcontractorId) {
    const state = await getSubcontractorWsibState(input.subcontractorId, tx)
    wsib = evaluateWsibGate({
      subcontractorId: input.subcontractorId,
      wsibValid: state.valid,
      overrideRequested: Boolean(input.wsibOverride),
      hasOverridePermission: hasScopedGrant(
        session,
        'workorder:override_wsib_hold',
        input.subcontractorId,
      ),
    })
    if (!wsib.allowed) throw new ValidationError(wsib.reason ?? 'WSIB check failed.')
  }

  const reservedNumber = options?.workOrderNumber
  if (
    reservedNumber !== undefined &&
    (!Number.isInteger(reservedNumber) || reservedNumber <= 0)
  ) {
    throw new ValidationError('The reserved work-order number is not valid.')
  }

  const plan = reservedNumber === undefined
    ? await allocateWorkOrderNumber(tx, series)
    : null
  const workOrderNumber = reservedNumber ?? plan!.number

  if (reservedNumber !== undefined) {
    const existing = await tx
      .select({ id: workOrders.id })
      .from(workOrders)
      .where(eq(workOrders.id, reservedNumber))
      .limit(1)
    if (existing.length > 0) {
      throw new ValidationError(`Work order ${reservedNumber} already exists.`)
    }
  }

  const [row] = await tx
    .insert(workOrders)
    .values({
      id: workOrderNumber,
      series,
      siteId: input.siteId,
      serviceTypeId: input.serviceTypeId,
      priorityId: input.priorityId,
      categoryId: input.categoryId ?? null,
      status: 1,
      dateTaken: input.dateTaken ?? businessToday(),
      expectedCompletion: input.expectedCompletion ?? null,
      serviceRequired: input.serviceRequired,
      notes: input.notes ?? null,
      subcontractorId: input.subcontractorId ?? null,
      securityCode: input.securityCode ?? null,
      customerPo: input.customerPo ?? null,
      isLocal: input.isLocal ?? false,
      isProject: input.isProject ?? false,
      isTjxQuote: input.isTjxQuote ?? false,
      isPmaOrder: input.isPmaOrder ?? false,
      createdBy: session.user.id,
      updatedBy: session.user.id,
    })
    .returning()

  if (!row) throw new ValidationError('The work order could not be created.')

  await tx.insert(workOrderTax).values({
    workOrderId: row.id,
    taxProvince: taxProvinceForSite(site.province),
  })
  await tx.insert(workOrderReports).values({ workOrderId: row.id, report: '' })

  if (input.subcontractorId) {
    await tx.insert(workOrderAssignments).values({
      workOrderId: row.id,
      subcontractorId: input.subcontractorId,
      role: 'subcontractor',
      assignedBy: session.user.id,
    })
  }

  await tx.insert(workOrderNotes).values({
    workOrderId: row.id,
    userId: session.user.id,
    title: 'Work order created',
    notes: wsib.overrideUsed
      ? 'Created with a WSIB/insurance override.'
      : 'Created.',
    notesType: 'system',
    statusId: 1,
    createdAt: new Date(),
  })

  if (plan) await commitWorkOrderNumber(tx, plan)

  await auditWorkOrder(tx, session, 'workorder.create', row.id, {
    summary: `Created work order ${row.id} (${series === 2 ? 'maintenance' : 'main'} series).`,
    after: row as unknown as Record<string, unknown>,
  })
  await captureRevision(tx, row.id, 'create', session.user.id)

  return { id: row.id, series, warnings: plan?.warnings ?? [] }
}

export async function createWorkOrder(
  input: WorkOrderCreateInput,
  session: AuthSessionView,
  executor?: Db,
): Promise<CreateWorkOrderResult> {
  const db = executor ?? getDb()
  return db.transaction((tx) => createWorkOrderCore(tx, input, session))
}

/** Exposed for the numbering test seam: current counters. */
export async function readNumberSeries(
  db: Db,
): Promise<Array<{ id: number; nextId: number }>> {
  const rows = await db.select().from(workOrderNumberSeries)
  return rows.map((row) => ({ id: row.id, nextId: row.nextId }))
}
