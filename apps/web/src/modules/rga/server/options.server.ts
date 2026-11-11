/** Lookups for the RGA form. Scoped by the same rules as the module reads. */
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm'
import type { Executor } from '@cls/db'
import { purchaseOrders, suppliers, workOrders } from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import { assertRgaRead, subcontractorScope } from './access.server'

export async function getRgaFormOptions(
  session: AuthSessionView,
  input: { search?: string },
  executor: Executor,
) {
  assertRgaRead(session)
  const term = (input.search ?? '').trim()
  const supplierWhere: SQL[] = [eq(suppliers.isActive, true)]
  if (term) {
    supplierWhere.push(
      sql`(${suppliers.name} ilike ${`%${term}%`} or cast(${suppliers.id} as text) ilike ${`%${term}%`})`,
    )
  }

  const scope = subcontractorScope(session)
  const workOrderWhere = scope === null ? undefined : eq(workOrders.subcontractorId, scope)

  const [supplierRows, workOrderRows, purchaseOrderRows] = await Promise.all([
    executor
      .select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers)
      .where(and(...supplierWhere))
      .orderBy(asc(suppliers.name))
      .limit(100),
    executor
      .select({
        id: workOrders.id,
        number: workOrders.id,
        siteId: workOrders.siteId,
        subcontractorId: workOrders.subcontractorId,
      })
      .from(workOrders)
      .where(workOrderWhere)
      .orderBy(desc(workOrders.createdAt))
      .limit(100),
    executor
      .select({
        id: purchaseOrders.id,
        displayNumber: purchaseOrders.displayNumber,
        supplierId: purchaseOrders.supplierId,
        status: purchaseOrders.status,
      })
      .from(purchaseOrders)
      .orderBy(desc(purchaseOrders.id))
      .limit(100),
  ])

  return { suppliers: supplierRows, workOrders: workOrderRows, purchaseOrders: purchaseOrderRows }
}
