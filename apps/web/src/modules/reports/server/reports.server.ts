/**
 * Report queries. Each report is one paged query over `app` data; the legacy
 * per-client PHP pages are a customer pattern on the same query.
 *
 * Money: invoice figures are the posted invoice totals, and summary totals are
 * accumulated through `@cls/pricing` fixed-point helpers. Parts valuation is
 * `qty x unit price` through the same helpers.
 */
import { and, asc, desc, eq, ilike, inArray, lt, lte, or, sql, type SQL } from 'drizzle-orm'
import { format, money, multiply, parseDecimal, add, type Decimal } from '@cls/pricing'
import { getDb, type Db } from '@cls/db'
import {
  auditLog,
  customers,
  invoiceLabourLines,
  parts,
  salesInvoices,
  sites,
  workOrders,
} from '@cls/db/schema'
import { businessToday } from '../../master-data/lib/compliance'
import {
  REPORT_EXPORT_ROW_LIMIT,
  REPORT_PAGE_SIZE_DEFAULT,
  REPORT_PAGE_SIZE_MAX,
  REPORT_TITLES,
  clientPreset,
  type ReportColumn,
  type ReportExportRequest,
  type ReportExportResult,
  type ReportRequest,
  type ReportResult,
} from '../types'

type Executor = Db

interface BuiltReport {
  result: ReportResult
  exportRows: Record<string, string>[]
  columns: ReportColumn[]
  filters: string[]
  generatedOn: string
  subtitle: string
}

const INVOICE_COLUMNS: ReportColumn[] = [
  { key: 'date', label: 'Date', format: 'date', align: 'left' },
  { key: 'customerPo', label: 'Customer PO', format: 'text', align: 'left' },
  { key: 'workOrder', label: 'WO', format: 'text', align: 'left' },
  { key: 'invoiceNumber', label: 'Invoice', format: 'text', align: 'left' },
  { key: 'site', label: 'Store #', format: 'text', align: 'left' },
  { key: 'address', label: 'Address', format: 'text', align: 'left' },
  { key: 'serviceRequired', label: 'Service required', format: 'text', align: 'left' },
  { key: 'labour', label: 'Labour', format: 'money', align: 'right' },
  { key: 'material', label: 'Material', format: 'money', align: 'right' },
  { key: 'subtotal', label: 'Subtotal', format: 'money', align: 'right' },
  { key: 'tax', label: 'Tax', format: 'money', align: 'right' },
  { key: 'total', label: 'Total', format: 'money', align: 'right' },
  { key: 'status', label: 'Status', format: 'text', align: 'left' },
]

const OUTSTANDING_COLUMNS: ReportColumn[] = [
  { key: 'site', label: 'Store', format: 'text', align: 'left' },
  { key: 'customerPo', label: 'Customer PO', format: 'text', align: 'left' },
  { key: 'workOrder', label: 'WO', format: 'text', align: 'left' },
  { key: 'status', label: 'Status', format: 'text', align: 'left' },
  { key: 'dateTaken', label: 'Date taken', format: 'date', align: 'left' },
  { key: 'serviceType', label: 'Service', format: 'text', align: 'left' },
  { key: 'address', label: 'Address', format: 'text', align: 'left' },
]

const WORK_ORDER_COLUMNS: ReportColumn[] = [
  { key: 'customer', label: 'Client', format: 'text', align: 'left' },
  { key: 'interior', label: 'Interior', format: 'number', align: 'right' },
  { key: 'exterior', label: 'Exterior', format: 'number', align: 'right' },
  { key: 'maintenance', label: 'Maintenance', format: 'number', align: 'right' },
  { key: 'other', label: 'Other', format: 'number', align: 'right' },
  { key: 'cancelled', label: 'Cancelled', format: 'number', align: 'right' },
  { key: 'total', label: 'Total', format: 'number', align: 'right' },
]

const SITE_VISIT_COLUMNS: ReportColumn[] = [
  { key: 'site', label: 'Site', format: 'text', align: 'left' },
  { key: 'customer', label: 'Client', format: 'text', align: 'left' },
  { key: 'city', label: 'City', format: 'text', align: 'left' },
  { key: 'province', label: 'Province', format: 'text', align: 'left' },
  { key: 'visits', label: 'Visits', format: 'number', align: 'right' },
  { key: 'lastVisit', label: 'Last visit', format: 'date', align: 'left' },
]

const PARTS_COLUMNS: ReportColumn[] = [
  { key: 'partNumber', label: 'Part code', format: 'text', align: 'left' },
  { key: 'name', label: 'Part name', format: 'text', align: 'left' },
  { key: 'quantity', label: 'Stock qty', format: 'number', align: 'right' },
  { key: 'cost', label: 'Unit cost', format: 'money', align: 'right' },
  { key: 'sellPrice', label: 'Unit sell', format: 'money', align: 'right' },
  { key: 'stockCost', label: 'Stock cost', format: 'money', align: 'right' },
  { key: 'stockValue', label: 'Stock value', format: 'money', align: 'right' },
  { key: 'note', label: 'Note', format: 'text', align: 'left' },
]

const STATUS_LABELS: Record<string, string> = {
  issued: 'Invoiced',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  draft: 'Draft',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

const SERVICE_LABELS: Record<number, string> = {
  1: 'Interior',
  2: 'Exterior',
  3: 'Maintenance',
}

function decimal(value: string | null | undefined): Decimal {
  return parseDecimal(value) ?? parseDecimal('0')!
}

function sumMoney(values: (string | null | undefined)[]): string {
  return money(values.reduce((total, value) => add(total, decimal(value)), parseDecimal('0')!))
}

function requestDates(request: ReportRequest): { startDate: string; endDate: string } {
  const today = businessToday()
  return {
    startDate: request.startDate ?? '1900-01-01',
    endDate: request.endDate ?? today,
  }
}

function customerConditions(request: ReportRequest): SQL[] {
  const conditions: SQL[] = []
  const preset = clientPreset(request.client)
  if (preset.patterns.length > 0) {
    const matches = preset.patterns.map((pattern) => ilike(customers.name, pattern))
    conditions.push(or(...matches)!)
  }
  if (request.province) conditions.push(eq(sites.province, request.province.toUpperCase()))
  return conditions
}

function workOrderCategoryConditions(request: ReportRequest): SQL[] {
  const conditions: SQL[] = []
  const preset = clientPreset(request.client)
  if (preset.workOrderFlag === 'isPmaOrder') conditions.push(eq(workOrders.isPmaOrder, true))
  if (preset.workOrderFlag === 'isProject') conditions.push(eq(workOrders.isProject, true))
  if (request.category === 'local') conditions.push(eq(workOrders.isLocal, true))
  if (request.category === 'project') conditions.push(eq(workOrders.isProject, true))
  return conditions
}

function serviceCondition(scope: ReportRequest['serviceScope']): SQL | undefined {
  if (scope === 'work') return sql`${workOrders.serviceTypeId} <> 3`
  if (scope === 'maintenance') return eq(workOrders.serviceTypeId, 3)
  return undefined
}

function lineDateConditions(request: ReportRequest): SQL[] {
  const { startDate, endDate } = requestDates(request)
  return [
    sql`exists (
      select 1 from ${invoiceLabourLines} line
      where line.invoice_id = ${salesInvoices.id}
        and line.line_date between ${startDate} and ${endDate}
    )`,
  ]
}

async function buildInvoiceReport(
  db: Executor,
  request: ReportRequest,
  exportMode: boolean,
): Promise<BuiltReport> {
  const preset = clientPreset(request.client)
  const filters = lineDateConditions(request)
  const service = serviceCondition(request.serviceScope)
  if (service) filters.push(service)
  filters.push(inArray(salesInvoices.status, ['issued', 'partially_paid', 'paid']))
  filters.push(...customerConditions(request), ...workOrderCategoryConditions(request))
  const where = and(...filters)

  const page = exportMode ? 1 : request.page
  const pageSize = exportMode ? REPORT_EXPORT_ROW_LIMIT : request.pageSize

  const lineDate = sql<string>`(
    select min(line.line_date)::text from ${invoiceLabourLines} line
    where line.invoice_id = ${salesInvoices.id}
  )`

  const rowsQuery = db
    .select({
      invoiceId: salesInvoices.id,
      date: lineDate,
      customerPo: workOrders.customerPo,
      workOrder: salesInvoices.workOrderNumber,
      invoiceNumber: salesInvoices.invoiceNumber,
      siteName: sites.name,
      street: sites.street,
      city: sites.city,
      province: sites.province,
      serviceRequired: workOrders.serviceRequired,
      labour: salesInvoices.labourAmount,
      material: salesInvoices.materialAmount,
      subtotal: salesInvoices.subtotalAmount,
      tax: salesInvoices.taxAmount,
      total: salesInvoices.totalAmount,
      status: salesInvoices.status,
    })
    .from(salesInvoices)
    .innerJoin(workOrders, eq(workOrders.id, salesInvoices.workOrderId))
    .innerJoin(sites, eq(sites.id, salesInvoices.siteId))
    .innerJoin(customers, eq(customers.id, sites.customerId))
    .where(where)
    .orderBy(desc(salesInvoices.invoiceDate), desc(salesInvoices.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  const countQuery = db
    .select({ count: sql<number>`count(*)::int` })
    .from(salesInvoices)
    .innerJoin(workOrders, eq(workOrders.id, salesInvoices.workOrderId))
    .innerJoin(sites, eq(sites.id, salesInvoices.siteId))
    .innerJoin(customers, eq(customers.id, sites.customerId))
    .where(where)

  const totalsQuery = db
    .select({
      labour: sql<string>`coalesce(sum(${salesInvoices.labourAmount}), 0)::text`,
      material: sql<string>`coalesce(sum(${salesInvoices.materialAmount}), 0)::text`,
      subtotal: sql<string>`coalesce(sum(${salesInvoices.subtotalAmount}), 0)::text`,
      tax: sql<string>`coalesce(sum(${salesInvoices.taxAmount}), 0)::text`,
      total: sql<string>`coalesce(sum(${salesInvoices.totalAmount}), 0)::text`,
    })
    .from(salesInvoices)
    .innerJoin(workOrders, eq(workOrders.id, salesInvoices.workOrderId))
    .innerJoin(sites, eq(sites.id, salesInvoices.siteId))
    .innerJoin(customers, eq(customers.id, sites.customerId))
    .where(where)

  const [rows, countRows, totalsRows] = await Promise.all([rowsQuery, countQuery, totalsQuery])
  const data = rows.map((row) => ({
    date: row.date ?? '',
    customerPo: row.customerPo ?? '',
    workOrder: String(row.workOrder),
    invoiceNumber: row.invoiceNumber,
    site: row.siteName,
    address: [row.street, row.city, row.province].filter(Boolean).join(', '),
    serviceRequired: row.serviceRequired.replace(/\s+/g, ' ').trim(),
    labour: money(decimal(row.labour)),
    material: money(decimal(row.material)),
    subtotal: money(decimal(row.subtotal)),
    tax: money(decimal(row.tax)),
    total: money(decimal(row.total)),
    status: STATUS_LABELS[row.status] ?? row.status,
  }))
  const totals = totalsRows[0]
  return {
    result: {
      key: request.key,
      title: REPORT_TITLES[request.key],
      subtitle: `${preset.label} · ${request.serviceScope === 'maintenance' ? 'Maintenance' : request.serviceScope === 'work' ? 'Interior and exterior' : 'All service types'}`,
      generatedOn: businessToday(),
      filters: describeFilters(request),
      columns: INVOICE_COLUMNS,
      rows: data,
      totals: {
        date: 'Totals',
        labour: sumMoney([totals?.labour]),
        material: sumMoney([totals?.material]),
        subtotal: sumMoney([totals?.subtotal]),
        tax: sumMoney([totals?.tax]),
        total: sumMoney([totals?.total]),
      },
      totalRows: countRows[0]?.count ?? 0,
      page,
      pageSize,
    },
    exportRows: data,
    columns: INVOICE_COLUMNS,
    filters: describeFilters(request),
    generatedOn: businessToday(),
    subtitle: preset.label,
  }
}

async function buildOutstandingReport(
  db: Executor,
  request: ReportRequest,
  exportMode: boolean,
): Promise<BuiltReport> {
  const conditions: SQL[] = [sql`${workOrders.status} <> 11`, ...customerConditions(request)]
  const service = serviceCondition(request.serviceScope)
  if (service) conditions.push(service)
  conditions.push(...workOrderCategoryConditions(request))
  if (request.search) {
    conditions.push(
      or(
        ilike(sites.name, `%${request.search}%`),
        ilike(sites.city, `%${request.search}%`),
        sql`${workOrders.customerPo} ilike ${`%${request.search}%`}`,
      )!,
    )
  }
  const where = and(...conditions)
  const page = exportMode ? 1 : request.page
  const pageSize = exportMode ? REPORT_EXPORT_ROW_LIMIT : request.pageSize

  const base = () =>
    db
      .select({
        workOrder: workOrders.id,
        site: sites.name,
        customerPo: workOrders.customerPo,
        status: workOrders.status,
        dateTaken: workOrders.dateTaken,
        serviceTypeId: workOrders.serviceTypeId,
        street: sites.street,
        city: sites.city,
        province: sites.province,
      })
      .from(workOrders)
      .innerJoin(sites, eq(sites.id, workOrders.siteId))
      .innerJoin(customers, eq(customers.id, sites.customerId))

  const rows = await base()
    .where(where)
    .orderBy(asc(workOrders.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workOrders)
    .innerJoin(sites, eq(sites.id, workOrders.siteId))
    .innerJoin(customers, eq(customers.id, sites.customerId))
    .where(where)

  const data = rows.map((row) => ({
    site: row.site,
    customerPo: row.customerPo ?? '',
    workOrder: String(row.workOrder),
    status: workOrderStatusLabel(row.status),
    dateTaken: row.dateTaken,
    serviceType: SERVICE_LABELS[row.serviceTypeId] ?? String(row.serviceTypeId),
    address: [row.street, row.city, row.province].filter(Boolean).join(', '),
  }))
  return {
    result: {
      key: request.key,
      title: REPORT_TITLES[request.key],
      subtitle: `${clientPreset(request.client).label} · open work orders`,
      generatedOn: businessToday(),
      filters: describeFilters(request),
      columns: OUTSTANDING_COLUMNS,
      rows: data,
      totals: { site: 'Open work orders', workOrder: String(countRows[0]?.count ?? 0) },
      totalRows: countRows[0]?.count ?? 0,
      page,
      pageSize,
    },
    exportRows: data,
    columns: OUTSTANDING_COLUMNS,
    filters: describeFilters(request),
    generatedOn: businessToday(),
    subtitle: clientPreset(request.client).label,
  }
}

async function buildWorkOrderReport(
  db: Executor,
  request: ReportRequest,
  exportMode: boolean,
): Promise<BuiltReport> {
  const { startDate, endDate } = requestDates(request)
  const conditions: SQL[] = [
    sql`${workOrders.dateTaken} between ${startDate} and ${endDate}`,
    ...customerConditions(request),
  ]
  const service = serviceCondition(request.serviceScope)
  if (service) conditions.push(service)
  conditions.push(...workOrderCategoryConditions(request))

  const page = exportMode ? 1 : request.page
  const pageSize = exportMode ? REPORT_EXPORT_ROW_LIMIT : request.pageSize
  const grouped = db
    .select({
      customerId: customers.id,
      customer: customers.name,
      interior: sql<number>`sum(case when ${workOrders.serviceTypeId} = 1 then 1 else 0 end)::int`,
      exterior: sql<number>`sum(case when ${workOrders.serviceTypeId} = 2 then 1 else 0 end)::int`,
      maintenance: sql<number>`sum(case when ${workOrders.serviceTypeId} = 3 then 1 else 0 end)::int`,
      other: sql<number>`sum(case when ${workOrders.serviceTypeId} not in (1,2,3) then 1 else 0 end)::int`,
      cancelled: sql<number>`sum(case when ${workOrders.status} = 6 then 1 else 0 end)::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(workOrders)
    .innerJoin(sites, eq(sites.id, workOrders.siteId))
    .innerJoin(customers, eq(customers.id, sites.customerId))
    .where(and(...conditions))
    .groupBy(customers.id, customers.name)
    .orderBy(asc(customers.name))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  const rows = await grouped
  const countRows = await db
    .select({ count: sql<number>`count(distinct ${customers.id})::int` })
    .from(workOrders)
    .innerJoin(sites, eq(sites.id, workOrders.siteId))
    .innerJoin(customers, eq(customers.id, sites.customerId))
    .where(and(...conditions))

  const totals = rows.reduce(
    (acc, row) => ({
      interior: acc.interior + row.interior,
      exterior: acc.exterior + row.exterior,
      maintenance: acc.maintenance + row.maintenance,
      other: acc.other + row.other,
      cancelled: acc.cancelled + row.cancelled,
      total: acc.total + row.total,
    }),
    { interior: 0, exterior: 0, maintenance: 0, other: 0, cancelled: 0, total: 0 },
  )
  const data = rows.map((row) => ({
    customer: row.customer,
    interior: String(row.interior),
    exterior: String(row.exterior),
    maintenance: String(row.maintenance),
    other: String(row.other),
    cancelled: String(row.cancelled),
    total: String(row.total),
  }))
  return {
    result: {
      key: request.key,
      title: REPORT_TITLES[request.key],
      subtitle: `${clientPreset(request.client).label} · ${startDate} to ${endDate}`,
      generatedOn: businessToday(),
      filters: describeFilters(request),
      columns: WORK_ORDER_COLUMNS,
      rows: data,
      totals: {
        customer: 'Totals',
        interior: String(totals.interior),
        exterior: String(totals.exterior),
        maintenance: String(totals.maintenance),
        other: String(totals.other),
        cancelled: String(totals.cancelled),
        total: String(totals.total),
      },
      totalRows: countRows[0]?.count ?? 0,
      page,
      pageSize,
    },
    exportRows: data,
    columns: WORK_ORDER_COLUMNS,
    filters: describeFilters(request),
    generatedOn: businessToday(),
    subtitle: clientPreset(request.client).label,
  }
}

async function buildSiteVisitReport(
  db: Executor,
  request: ReportRequest,
  exportMode: boolean,
): Promise<BuiltReport> {
  const startDate = request.startDate ?? '2017-01-01'
  const endDate = request.endDate ?? businessToday()
  const conditions: SQL[] = []
  const preset = clientPreset(request.client)
  if (preset.patterns.length > 0) {
    conditions.push(or(...preset.patterns.map((pattern) => ilike(customers.name, pattern)))!)
  }
  if (request.province) conditions.push(eq(sites.province, request.province.toUpperCase()))
  if (request.search) {
    conditions.push(
      or(ilike(sites.name, `%${request.search}%`), ilike(sites.city, `%${request.search}%`))!,
    )
  }

  const page = exportMode ? 1 : request.page
  const pageSize = exportMode ? REPORT_EXPORT_ROW_LIMIT : request.pageSize
  const rows = await db
    .select({
      site: sites.name,
      customer: customers.name,
      city: sites.city,
      province: sites.province,
      visits: sql<number>`count(${workOrders.id})::int`,
      lastVisit: sql<string | null>`max(${workOrders.dateTaken})::text`,
    })
    .from(sites)
    .leftJoin(customers, eq(customers.id, sites.customerId))
    .leftJoin(
      workOrders,
      and(
        eq(workOrders.siteId, sites.id),
        sql`${workOrders.dateTaken} between ${startDate} and ${endDate}`,
      ),
    )
    .where(conditions.length ? and(...conditions) : undefined)
    .groupBy(sites.id, sites.name, customers.name, sites.city, sites.province)
    .orderBy(asc(sites.name))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sites)
    .leftJoin(customers, eq(customers.id, sites.customerId))
    .where(conditions.length ? and(...conditions) : undefined)
  const data = rows.map((row) => ({
    site: row.site,
    customer: row.customer ?? '',
    city: row.city ?? '',
    province: row.province ?? '',
    visits: String(row.visits),
    lastVisit: row.lastVisit ?? '',
  }))
  const visitTotal = rows.reduce((total, row) => total + row.visits, 0)
  return {
    result: {
      key: request.key,
      title: REPORT_TITLES[request.key],
      subtitle: `${preset.label} · visits from ${startDate} to ${endDate}`,
      generatedOn: businessToday(),
      filters: describeFilters(request),
      columns: SITE_VISIT_COLUMNS,
      rows: data,
      totals: { site: 'Totals', visits: String(visitTotal) },
      totalRows: countRows[0]?.count ?? 0,
      page,
      pageSize,
    },
    exportRows: data,
    columns: SITE_VISIT_COLUMNS,
    filters: describeFilters(request),
    generatedOn: businessToday(),
    subtitle: preset.label,
  }
}

async function buildPartsReport(
  db: Executor,
  request: ReportRequest,
  exportMode: boolean,
): Promise<BuiltReport> {
  const conditions: SQL[] = []
  if (request.search) {
    conditions.push(
      or(ilike(parts.partNumber, `%${request.search}%`), ilike(parts.name, `%${request.search}%`))!,
    )
  }
  if (request.stockScope === 'out') conditions.push(lte(parts.currentQuantity, '0'))
  if (request.stockScope === 'low') conditions.push(lt(parts.currentQuantity, '10'))
  if (request.stockScope === 'in-stock') conditions.push(sql`${parts.currentQuantity} > 0`)
  const where = conditions.length ? and(...conditions) : undefined
  const page = exportMode ? 1 : request.page
  const pageSize = exportMode ? REPORT_EXPORT_ROW_LIMIT : request.pageSize

  const rows = await db
    .select({
      partNumber: parts.partNumber,
      name: parts.name,
      quantity: parts.currentQuantity,
      cost: parts.cost,
      sellPrice: parts.sellPrice,
      subignore: parts.subignore,
    })
    .from(parts)
    .where(where)
    .orderBy(asc(parts.partNumber))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(parts)
    .where(where)
  const totalsRows = await db
    .select({
      quantity: sql<string>`coalesce(sum(${parts.currentQuantity}), 0)::text`,
      stockCost: sql<string>`coalesce(sum(${parts.currentQuantity} * coalesce(${parts.cost}, 0)), 0)::text`,
      stockValue: sql<string>`coalesce(sum(${parts.currentQuantity} * coalesce(${parts.sellPrice}, 0)), 0)::text`,
    })
    .from(parts)
    .where(where)
  const totals = totalsRows[0]

  const data = rows.map((row) => {
    const quantity = decimal(row.quantity)
    const stockCost = multiply(quantity, decimal(row.cost))
    const stockValue = multiply(quantity, decimal(row.sellPrice))
    return {
      partNumber: row.partNumber,
      name: row.name ?? '',
      quantity: format(quantity, 2),
      cost: money(decimal(row.cost)),
      sellPrice: money(decimal(row.sellPrice)),
      stockCost: money(stockCost),
      stockValue: money(stockValue),
      note: row.subignore ? 'hidden from sub portal' : '',
    }
  })
  return {
    result: {
      key: request.key,
      title: REPORT_TITLES[request.key],
      subtitle: request.stockScope === 'all' ? 'All parts' : `Parts: ${request.stockScope}`,
      generatedOn: businessToday(),
      filters: describeFilters(request),
      columns: PARTS_COLUMNS,
      rows: data,
      totals: {
        partNumber: 'Totals',
        quantity: format(decimal(totals?.quantity), 2),
        stockCost: sumMoney([totals?.stockCost]),
        stockValue: sumMoney([totals?.stockValue]),
      },
      totalRows: countRows[0]?.count ?? 0,
      page,
      pageSize,
    },
    exportRows: data,
    columns: PARTS_COLUMNS,
    filters: describeFilters(request),
    generatedOn: businessToday(),
    subtitle: 'Parts stock',
  }
}

async function buildReport(
  db: Executor,
  request: ReportRequest,
  exportMode = false,
): Promise<BuiltReport> {
  switch (request.key) {
    case 'client-invoices':
      return buildInvoiceReport(db, request, exportMode)
    case 'client-outstanding':
      return buildOutstandingReport(db, request, exportMode)
    case 'work-orders':
      return buildWorkOrderReport(db, request, exportMode)
    case 'site-visits':
      return buildSiteVisitReport(db, request, exportMode)
    case 'parts-stock':
      return buildPartsReport(db, request, exportMode)
  }
}

export async function runReport(
  request: ReportRequest,
  executor?: Executor,
): Promise<ReportResult> {
  const db = executor ?? getDb()
  return (await buildReport(db, normalise(request))).result
}

function normalise(request: ReportRequest): ReportRequest {
  const pageSize = Math.min(
    Math.max(1, request.pageSize || REPORT_PAGE_SIZE_DEFAULT),
    REPORT_PAGE_SIZE_MAX,
  )
  return { ...request, page: Math.max(1, request.page), pageSize }
}

function describeFilters(request: ReportRequest): string[] {
  const filters: string[] = [clientPreset(request.client).label]
  const { startDate, endDate } = requestDates(request)
  if (request.key !== 'parts-stock' && request.key !== 'client-outstanding') {
    filters.push(`${startDate} to ${endDate}`)
  }
  if (request.serviceScope !== 'all') filters.push(`Service: ${request.serviceScope}`)
  if (request.province) filters.push(`Province: ${request.province}`)
  if (request.category !== 'all') filters.push(`Category: ${request.category}`)
  if (request.search) filters.push(`Search: ${request.search}`)
  if (request.key === 'parts-stock' && request.stockScope !== 'all') {
    filters.push(`Stock: ${request.stockScope}`)
  }
  return filters
}

function workOrderStatusLabel(status: number): string {
  const labels: Record<number, string> = {
    1: 'In progress',
    2: 'Complete',
    3: 'Pending approval',
    4: 'Pending invoice',
    5: 'Parts on order',
    6: 'Cancelled',
    7: 'Dispatched',
    8: 'Reschedule',
    9: 'Issues',
    10: 'Declined',
    12: 'Waiting for quote',
  }
  return labels[status] ?? String(status)
}

function reportFileName(request: ReportRequest, extension: string): string {
  const stamp = businessToday().replaceAll('-', '')
  return `${request.key}-${request.client}-${stamp}.${extension}`
}

export async function exportReport(
  request: ReportExportRequest,
  actorId: string,
  executor?: Executor,
): Promise<ReportExportResult> {
  const db = executor ?? getDb()
  const normalised = normalise(request)
  const built = await buildReport(db, normalised, true)
  const truncated = built.result.totalRows > built.exportRows.length
  let buffer: Buffer
  let contentType: string
  let extension: string

  if (request.format === 'pdf') {
    const { renderDocument } = await import('@cls/pdf')
    buffer = await renderDocument('report', {
      schemaVersion: 1,
      kind: 'report',
      title: built.result.title,
      subtitle: built.subtitle,
      generatedOn: built.generatedOn,
      filters: built.filters,
      columns: built.columns.map((column) => ({ label: column.label, align: column.align })),
      rows: built.exportRows.map((row) =>
        built.columns.map((column) => row[column.key] ?? ''),
      ),
      totals: built.result.totals
        ? built.columns.map((column) => built.result.totals?.[column.key] ?? '')
        : undefined,
    })
    contentType = 'application/pdf'
    extension = 'pdf'
  } else {
    const ExcelJS = (await import('exceljs')).default
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Alliance Lighting'
    workbook.created = new Date()
    const sheet = workbook.addWorksheet(built.result.title.slice(0, 31))
    sheet.addRow([built.result.title])
    sheet.getRow(1).font = { bold: true, size: 14 }
    sheet.addRow(built.filters.join(' · '))
    sheet.getRow(2).font = { italic: true, size: 9, color: { argb: 'FF5E5E5E' } }
    sheet.addRow([])
    const header = sheet.addRow(built.columns.map((column) => column.label))
    header.font = { bold: true }
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F2EE' } }
    for (const row of built.exportRows) {
      sheet.addRow(built.columns.map((column) => excelCell(row[column.key], column.format)))
    }
    if (built.result.totals) {
      const totalRow = sheet.addRow(
        built.columns.map((column) => excelCell(built.result.totals?.[column.key], column.format)),
      )
      totalRow.font = { bold: true }
    }
    sheet.views = [{ state: 'frozen', ySplit: 4 }]
    built.columns.forEach((column, index) => {
      const max = Math.max(
        column.label.length + 2,
        ...built.exportRows.map((row) => (row[column.key] ?? '').length + 2),
      )
      sheet.getColumn(index + 1).width = Math.min(48, Math.max(10, max))
    })
    const written = await workbook.xlsx.writeBuffer()
    buffer = Buffer.from(written as ArrayBuffer)
    contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    extension = 'xlsx'
  }

  await db.insert(auditLog).values({
    actorUserId: actorId,
    action: 'report.export',
    entityType: 'report',
    entityId: request.key,
    summary: `Exported ${request.key} (${request.client}) as ${request.format.toUpperCase()}.`,
    after: {
      filters: normalised,
      rowCount: built.exportRows.length,
      truncated,
      format: request.format,
    },
  })

  return {
    fileName: reportFileName(request, extension),
    contentType,
    base64: buffer.toString('base64'),
    rowCount: built.exportRows.length,
    truncated,
  }
}

function excelCell(value: string | undefined, formatKind: ReportColumn['format']): string | number {
  if (!value) return ''
  if (formatKind === 'money' || formatKind === 'number') {
    const parsed = Number(value.replaceAll(',', ''))
    return Number.isFinite(parsed) ? parsed : value
  }
  return value
}
