/**
 * Work-order list query.
 *
 * SERVER ONLY. Defaults to the open pipeline: the archive is ~42k rows and 95%
 * invoiced, so the invoiced view is opt-in and every query is keyset-paginated.
 */
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm'
import { getDb, type Db } from '@cls/db'
import {
  customers,
  sites,
  subcontractors,
  legacyWoCategories,
  legacyWoPriority,
  legacyWoServtype,
  workOrderTax,
  workOrders,
} from '@cls/db/schema'
import type {
  WorkOrderListFilters,
  WorkOrderListResult,
  WorkOrderListRow,
  WorkOrderViewCounts,
} from '../types'
import { businessToday } from '../lib/rules'
import { decodeCursor, encodeCursor } from '../lib/cursor'
import { isWorkOrderStatus, statusProjection } from '../lib/status'
import { triageFromColumns } from '../lib/rules'
import { scopeCondition, type Scope } from './access.server'

function cursorCondition(
  filters: WorkOrderListFilters,
): SQL | undefined {
  const cursor = decodeCursor(filters.cursor)
  if (!cursor || cursor.sort !== filters.sort) return undefined

  switch (filters.sort) {
    case 'newest':
      return sql`(
        ${workOrders.dateTaken} < ${cursor.value}
        or (${workOrders.dateTaken} = ${cursor.value} and ${workOrders.id} < ${cursor.id})
      )`
    case 'oldest':
      return sql`(
        ${workOrders.dateTaken} > ${cursor.value}
        or (${workOrders.dateTaken} = ${cursor.value} and ${workOrders.id} > ${cursor.id})
      )`
    case 'number':
      return sql`${workOrders.id} > ${cursor.id}`
    case 'expected':
      if (cursor.value === null) {
        return sql`(${workOrders.expectedCompletion} is null and ${workOrders.id} > ${cursor.id})`
      }
      return sql`(
        ${workOrders.expectedCompletion} > ${cursor.value}
        or (${workOrders.expectedCompletion} = ${cursor.value} and ${workOrders.id} > ${cursor.id})
        or ${workOrders.expectedCompletion} is null
      )`
  }
}

function searchCondition(search: string | undefined): SQL | undefined {
  const term = search?.trim()
  if (!term) return undefined
  const pattern = `%${term}%`
  return or(
    sql`cast(${workOrders.id} as text) ilike ${pattern}`,
    ilike(workOrders.customerPo, pattern),
    ilike(workOrders.serviceRequired, pattern),
    ilike(sites.name, pattern),
    ilike(sites.city, pattern),
    ilike(customers.name, pattern),
    ilike(subcontractors.name, pattern),
  )
}

const validWsibDocumentExists = sql`exists (
  select 1 from app.subcontractor_documents d
  where d.subcontractor_id = ${workOrders.subcontractorId}
    and d.kind in ('wsib', 'insurance')
    and not d.is_expired
    and d.expires_on >= current_date
)`

function viewConditions(
  filters: WorkOrderListFilters,
  today: string,
): SQL[] {
  const out: SQL[] = []
  switch (filters.view) {
    case 'open':
      out.push(inArray(workOrders.status, [1, 3, 5, 7, 8, 9, 12]))
      break
    case 'overdue':
      out.push(inArray(workOrders.status, [1, 3, 5, 7, 8, 9, 12]))
      out.push(isNotNull(workOrders.expectedCompletion))
      out.push(sql`${workOrders.expectedCompletion} < ${today}`)
      break
    case 'awaiting_approval':
      out.push(eq(workOrders.status, 3))
      break
    case 'scheduled':
      out.push(inArray(workOrders.status, [1, 5, 7, 8, 9, 12]))
      out.push(isNotNull(workOrders.expectedCompletion))
      break
    case 'completed':
      out.push(inArray(workOrders.status, [2, 4]))
      break
    case 'invoiced':
      out.push(eq(workOrders.status, 11))
      break
    case 'cancelled':
      out.push(eq(workOrders.status, 6))
      break
    case 'undispatched':
      out.push(eq(workOrders.status, 1))
      out.push(isNull(workOrders.subcontractorId))
      break
    case 'missing_wsib':
      out.push(inArray(workOrders.status, [1, 3, 5, 7, 8, 9, 12]))
      out.push(isNotNull(workOrders.subcontractorId))
      out.push(sql`not (${validWsibDocumentExists})`)
      break
    case 'all':
      break
  }
  return out
}

function orderBy(filters: WorkOrderListFilters) {
  switch (filters.sort) {
    case 'newest':
      return [desc(workOrders.dateTaken), desc(workOrders.id)]
    case 'oldest':
      return [asc(workOrders.dateTaken), asc(workOrders.id)]
    case 'number':
      return [asc(workOrders.id)]
    case 'expected':
      return [sql`${workOrders.expectedCompletion} asc nulls last`, asc(workOrders.id)]
  }
}

/**
 * One grouped scan powers the saved-view tab counts. It is scoped exactly like
 * the list, so a subcontractor sees its own counts.
 */
export async function queryViewCounts(
  scope: Scope,
  series?: 1 | 2,
  executor?: Db,
): Promise<WorkOrderViewCounts> {
  const db = executor ?? getDb()
  const today = businessToday()
  const where = and(
    series ? eq(workOrders.series, series) : undefined,
    scopeCondition(scope),
  )
  const [row] = await db
    .select({
      open: sql<number>`count(*) filter (where ${workOrders.status} in (1,3,5,7,8,9,12))::int`,
      overdue: sql<number>`count(*) filter (where ${workOrders.status} in (1,3,5,7,8,9,12) and ${workOrders.expectedCompletion} is not null and ${workOrders.expectedCompletion} < ${today})::int`,
      awaiting_approval: sql<number>`count(*) filter (where ${workOrders.status} = 3)::int`,
      scheduled: sql<number>`count(*) filter (where ${workOrders.status} in (1,5,7,8,9,12) and ${workOrders.expectedCompletion} is not null)::int`,
      completed: sql<number>`count(*) filter (where ${workOrders.status} in (2,4))::int`,
      invoiced: sql<number>`count(*) filter (where ${workOrders.status} = 11)::int`,
      cancelled: sql<number>`count(*) filter (where ${workOrders.status} = 6)::int`,
      undispatched: sql<number>`count(*) filter (where ${workOrders.status} = 1 and ${workOrders.subcontractorId} is null)::int`,
      missing_wsib: sql<number>`count(*) filter (where ${workOrders.status} in (1,3,5,7,8,9,12) and ${workOrders.subcontractorId} is not null and not (${validWsibDocumentExists}))::int`,
      all: sql<number>`count(*)::int`,
    })
    .from(workOrders)
    .where(where)
  return {
    open: row?.open ?? 0,
    overdue: row?.overdue ?? 0,
    awaiting_approval: row?.awaiting_approval ?? 0,
    scheduled: row?.scheduled ?? 0,
    completed: row?.completed ?? 0,
    invoiced: row?.invoiced ?? 0,
    cancelled: row?.cancelled ?? 0,
    undispatched: row?.undispatched ?? 0,
    missing_wsib: row?.missing_wsib ?? 0,
    all: row?.all ?? 0,
  }
}

export async function queryWorkOrders(
  filters: WorkOrderListFilters,
  scope: Scope,
  executor?: Db,
): Promise<WorkOrderListResult> {
  const db = executor ?? getDb()
  const today = businessToday()
  const baseConditions: (SQL | undefined)[] = [
    ...viewConditions(filters, today),
    searchCondition(filters.search),
    filters.series ? eq(workOrders.series, filters.series) : undefined,
    filters.status ? eq(workOrders.status, filters.status) : undefined,
    filters.priorityId ? eq(workOrders.priorityId, filters.priorityId) : undefined,
    filters.subcontractorId
      ? eq(workOrders.subcontractorId, filters.subcontractorId)
      : undefined,
    filters.siteId ? eq(workOrders.siteId, filters.siteId) : undefined,
    scopeCondition(scope),
  ]
  const where = and(...baseConditions, cursorCondition(filters))

  const rows = await db
    .select({
      id: workOrders.id,
      series: workOrders.series,
      status: workOrders.status,
      siteId: workOrders.siteId,
      siteName: sites.name,
      siteCity: sites.city,
      siteProvince: sites.province,
      customerId: customers.id,
      customerName: customers.name,
      serviceTypeId: workOrders.serviceTypeId,
      serviceTypeName: legacyWoServtype.name,
      priorityId: workOrders.priorityId,
      priorityName: legacyWoPriority.name,
      categoryId: workOrders.categoryId,
      categoryName: legacyWoCategories.name,
      subcontractorId: workOrders.subcontractorId,
      subcontractorName: subcontractors.name,
      dateTaken: workOrders.dateTaken,
      expectedCompletion: workOrders.expectedCompletion,
      customerPo: workOrders.customerPo,
      isLocal: workOrders.isLocal,
      isProject: workOrders.isProject,
      isTjxQuote: workOrders.isTjxQuote,
      isPmaOrder: workOrders.isPmaOrder,
      isMarkedRed: workOrders.isMarkedRed,
      isMarkedGreen: workOrders.isMarkedGreen,
      isMarkedCritical: workOrders.isMarkedCritical,
      totalAmount: workOrderTax.totalAmount,
      version: workOrders.version,
      techName: sql<string | null>`(
        select u.display_name
        from app.work_order_assignments a
        join app.users u on u.id = a.tech_user_id
        where a.work_order_id = ${workOrders.id}
        order by a.assigned_at
        limit 1
      )`,
    })
    .from(workOrders)
    .leftJoin(sites, eq(workOrders.siteId, sites.id))
    .leftJoin(customers, eq(sites.customerId, customers.id))
    .leftJoin(subcontractors, eq(workOrders.subcontractorId, subcontractors.id))
    .leftJoin(legacyWoServtype, eq(workOrders.serviceTypeId, legacyWoServtype.id))
    .leftJoin(legacyWoPriority, eq(workOrders.priorityId, legacyWoPriority.id))
    .leftJoin(legacyWoCategories, eq(workOrders.categoryId, legacyWoCategories.id))
    .leftJoin(workOrderTax, eq(workOrderTax.workOrderId, workOrders.id))
    .where(where)
    .orderBy(...orderBy(filters))
    .limit(filters.pageSize + 1)

  const hasMore = rows.length > filters.pageSize
  const page = rows.slice(0, filters.pageSize)

  const countRows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(workOrders)
    .leftJoin(sites, eq(workOrders.siteId, sites.id))
    .leftJoin(customers, eq(sites.customerId, customers.id))
    .leftJoin(subcontractors, eq(workOrders.subcontractorId, subcontractors.id))
    .where(and(...baseConditions))

  const last = page.at(-1)
  const nextCursor =
    hasMore && last
      ? encodeCursor({
          sort: filters.sort,
          value:
            filters.sort === 'expected'
              ? last.expectedCompletion
              : filters.sort === 'number'
                ? null
                : last.dateTaken,
          id: last.id,
        })
      : null

  return {
    rows: page.map<WorkOrderListRow>((row) => {
      const status = isWorkOrderStatus(row.status) ? row.status : 1
      const projection = statusProjection(status)
      return {
        id: row.id,
        series: (row.series === 2 ? 2 : 1) as 1 | 2,
        status,
        statusLabel: projection.legacyLabel,
        displayStatus: projection.display,
        displayLabel: projection.displayLabel,
        statusFlags: projection.flags,
        siteId: row.siteId,
        siteName: row.siteName ?? null,
        siteCity: row.siteCity ?? null,
        siteProvince: row.siteProvince ?? null,
        customerId: row.customerId ?? null,
        customerName: row.customerName ?? null,
        serviceTypeId: row.serviceTypeId,
        serviceTypeName: row.serviceTypeName ?? null,
        priorityId: row.priorityId,
        priorityName: row.priorityName ?? null,
        categoryId: row.categoryId ?? null,
        categoryName: row.categoryName ?? null,
        subcontractorId: row.subcontractorId ?? null,
        subcontractorName: row.subcontractorName ?? null,
        techName: row.techName ?? null,
        dateTaken: row.dateTaken,
        expectedCompletion: row.expectedCompletion ?? null,
        customerPo: row.customerPo ?? null,
        isLocal: row.isLocal,
        isProject: row.isProject,
        isTjxQuote: row.isTjxQuote,
        isPmaOrder: row.isPmaOrder,
        triage: triageFromColumns(row),
        totalAmount: row.totalAmount ?? null,
        version: row.version,
      }
    }),
    view: filters.view,
    pageSize: filters.pageSize,
    nextCursor,
    total: countRows[0]?.n ?? 0,
  }
}
