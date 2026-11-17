/**
 * Quote list query.
 *
 * SERVER ONLY. Keyset pagination on (created_at, id), newest first. Totals are
 * calculated from the page's lines with the same pure calculator the detail
 * screen uses, so a list total can never drift from the quote.
 */
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm'
import { getDb, type Executor } from '@cls/db'
import {
  customers,
  quoteHours,
  quoteParts,
  quoteSpecialParts,
  quotes,
  sites,
} from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import type { QuoteKind, QuoteListResult, QuoteListRow, QuoteStatusCode } from '../types'
import { assertQuotePermission } from './access.server'
import { QUOTE_STATUS_LABELS, quoteNumberLabel } from '../lib/status'
import { quoteTotals } from '../lib/rules'
import { decodeQuoteCursor, encodeQuoteCursor } from '../lib/list-search'

export interface QuoteListQuery {
  kind: QuoteKind | 'all'
  status?: QuoteStatusCode | null
  search?: string
  cursor?: string | null
  size?: number
}

export async function queryQuotes(
  session: AuthSessionView,
  query: QuoteListQuery,
  executor?: Executor,
): Promise<QuoteListResult> {
  assertQuotePermission(session, 'quote:read')
  const db = executor ?? getDb()
  const size = Math.min(Math.max(query.size ?? 25, 10), 100)

  const filters: SQL[] = [eq(quotes.isDeleted, false)]
  if (query.kind !== 'all') filters.push(eq(quotes.kind, query.kind))
  if (query.status) filters.push(eq(quotes.status, query.status))
  const search = (query.search ?? '').trim()
  if (search) {
    const pattern = `%${search.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
    const term = or(
      sql`cast(${quotes.id} as text) ilike ${pattern}`,
      sql`cast(${quotes.workOrderNumber} as text) ilike ${pattern}`,
      ilike(sites.name, pattern),
      ilike(customers.name, pattern),
      ilike(quotes.referenceWoNumber, pattern),
    )
    if (term) filters.push(term)
  }

  const cursor = decodeQuoteCursor(query.cursor ?? null)
  if (cursor) {
    filters.push(
      sql`(${quotes.dateCreated}, ${quotes.id}) < (${cursor.createdAt}::date, ${cursor.id})`,
    )
  }

  const rows = await db
    .select({
      id: quotes.id,
      kind: quotes.kind,
      workOrderNumber: quotes.workOrderNumber,
      status: quotes.status,
      siteId: quotes.siteId,
      siteName: sites.name,
      customerName: customers.name,
      province: sql<string | null>`coalesce(${quotes.shipProvince}, ${sites.province})`,
      revisionId: quotes.revisionId,
      isRevision: quotes.isRevision,
      isLastRevision: quotes.isLastRevision,
      isDeleted: quotes.isDeleted,
      dueDate: quotes.dueDate,
      isDueDateTbd: quotes.isDueDateTbd,
      dateApproved: quotes.dateApproved,
      // The business date, not the row's insert time: migrated quotes all share one insert time.
      createdAt: quotes.dateCreated,
      taxCode: quotes.taxCode,
      appliedTaxRate: quotes.appliedTaxRate,
      manualTaxAmount: quotes.manualTaxAmount,
    })
    .from(quotes)
    .leftJoin(sites, eq(quotes.siteId, sites.id))
    .leftJoin(customers, eq(sites.customerId, customers.id))
    .where(and(...filters))
    .orderBy(desc(quotes.dateCreated), desc(quotes.id))
    .limit(size + 1)

  const page = rows.slice(0, size)
  const ids = page.map((row) => row.id)

  const [hours, parts, specials] = ids.length
    ? await Promise.all([
        db.select().from(quoteHours).where(inArray(quoteHours.quoteId, ids)),
        db.select().from(quoteParts).where(inArray(quoteParts.quoteId, ids)),
        db
          .select()
          .from(quoteSpecialParts)
          .where(inArray(quoteSpecialParts.quoteId, ids)),
      ])
    : [[], [], []]

  const last = page[page.length - 1]
  const listRows: QuoteListRow[] = page.map((row) => {
    const totals = quoteTotals({
      taxCode: row.taxCode,
      appliedTaxRate: row.appliedTaxRate,
      manualTaxAmount: row.manualTaxAmount,
      hours: hours
        .filter((line) => line.quoteId === row.id)
        .map((line) => ({ ...line, id: line.id })),
      parts: parts.filter((line) => line.quoteId === row.id),
      specialParts: specials.filter((line) => line.quoteId === row.id),
    })
    return {
      id: row.id,
      kind: row.kind,
      numberLabel: quoteNumberLabel(row.kind, row.id, row.workOrderNumber),
      workOrderNumber: row.workOrderNumber,
      status: row.status as QuoteStatusCode,
      statusLabel: QUOTE_STATUS_LABELS[row.status as QuoteStatusCode],
      siteId: row.siteId,
      siteName: row.siteName,
      customerName: row.customerName,
      province: row.province,
      revisionId: row.revisionId,
      isRevision: row.isRevision,
      isLastRevision: row.isLastRevision,
      isDeleted: row.isDeleted,
      dueDate: row.dueDate,
      isDueDateTbd: row.isDueDateTbd,
      dateApproved: row.dateApproved,
      createdAt: row.createdAt,
      total: totals.total,
    }
  })

  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(quotes)
    .leftJoin(sites, eq(quotes.siteId, sites.id))
    .leftJoin(customers, eq(sites.customerId, customers.id))
    .where(and(...filters))

  return {
    rows: listRows,
    nextCursor:
      rows.length > size && last
        ? encodeQuoteCursor({
            createdAt: last.createdAt,
            id: last.id,
          })
        : null,
    total: countRows[0]?.count ?? 0,
  }
}
