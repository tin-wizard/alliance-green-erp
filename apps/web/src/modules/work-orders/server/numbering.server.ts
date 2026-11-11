/**
 * Database-backed work-order number allocation.
 *
 * SERVER ONLY. Runs inside the caller's transaction and locks the series row
 * with `SELECT … FOR UPDATE`, so two concurrent creates cannot receive the same
 * number. The caller writes `number + 1` back after the insert succeeds
 * (`commitWorkOrderNumber`), matching the legacy contract while removing the
 * read-then-write race.
 */
import { eq, sql } from 'drizzle-orm'
import { ServiceUnavailableError } from '@cls/core'
import { logger } from '@cls/core/logger'
import { workOrderNumberSeries, workOrders } from '@cls/db/schema'
import type { Tx } from '@cls/db'
import {
  counterAfterInsert,
  numberingPolicyFromEnv,
  planWorkOrderNumber,
  WorkOrderNumberingError,
  type NumberingPlan,
  type WorkOrderSeriesNumber,
} from '../lib/numbering'
import { getSageNumberCollisionSource } from './sage-collisions.server'

export interface AllocateOptions {
  enforceAppCollisions?: boolean
  refuseUnverifiedSage?: boolean
}

export async function allocateWorkOrderNumber(
  tx: Tx,
  series: WorkOrderSeriesNumber,
  options: AllocateOptions = {},
): Promise<NumberingPlan> {
  const policy = numberingPolicyFromEnv()
  const enforce = options.enforceAppCollisions ?? policy.enforceAppCollisions

  const seriesRows = await tx
    .select({ nextId: workOrderNumberSeries.nextId })
    .from(workOrderNumberSeries)
    .where(eq(workOrderNumberSeries.id, series))
    .for('update')
    .limit(1)

  const counter = seriesRows[0]?.nextId
  if (counter === undefined) {
    throw new ServiceUnavailableError(
      'Work-order numbering',
      `The ${series === 2 ? 'maintenance' : 'main'} number series is not initialised. Run migrations.`,
    )
  }

  const sage = getSageNumberCollisionSource()

  const plan = await planWorkOrderNumber({
    series,
    counter,
    enforceAppCollisions: enforce,
    usage: {
      appHas: async (id) => {
        const rows = await tx
          .select({ id: workOrders.id })
          .from(workOrders)
          .where(eq(workOrders.id, id))
          .limit(1)
        return rows.length > 0
      },
      sageHas: (id) => sage.has(id),
    },
  })

  // Legacy persists every skip inside the loop; persist the reached counter.
  if (plan.skipped.length > 0) {
    await tx
      .update(workOrderNumberSeries)
      .set({ nextId: plan.counterAfter, updatedAt: new Date() })
      .where(eq(workOrderNumberSeries.id, series))
  }

  if (plan.warnings.length > 0) {
    // An operational warning, never a silent success claim.
    logger.warn('work-order numbering: ' + plan.warnings.join(' '))
  }

  return plan
}

/** Call after the work order insert, in the same transaction. */
export async function commitWorkOrderNumber(tx: Tx, plan: NumberingPlan): Promise<void> {
  await tx
    .update(workOrderNumberSeries)
    .set({ nextId: counterAfterInsert(plan), updatedAt: sql`now()` })
    .where(eq(workOrderNumberSeries.id, plan.series))
}

export { WorkOrderNumberingError }
