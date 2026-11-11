/**
 * Quote detail query.
 *
 * SERVER ONLY. A quote and all of its children load together; authorization is
 * checked before any row is returned.
 */
import { and, asc, eq, isNull, or } from 'drizzle-orm'
import { getDb, type Executor } from '@cls/db'
import {
  customers,
  quotePackingSlips,
  quotes,
  sites,
} from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import type { QuoteDetail, QuoteStatusCode } from '../types'
import { assertQuotePermission, loadQuoteRow } from './access.server'
import { loadLines, loadRejections } from './records.server'
import { quoteCapabilities, quoteTotals } from '../lib/rules'
import { quoteNumberLabel, quoteStatusView } from '../lib/status'

export async function getQuoteDetail(
  session: AuthSessionView,
  id: number,
  executor?: Executor,
): Promise<QuoteDetail> {
  assertQuotePermission(session, 'quote:read')
  const db = executor ?? getDb()
  const row = await loadQuoteRow(session, id, executor)
  const lines = await loadLines(db, id)

  const [siteRows, rejections, packingSlips, revisionRows] = await Promise.all([
    db
      .select({
        siteName: sites.name,
        customerId: customers.id,
        customerName: customers.name,
        siteProvince: sites.province,
      })
      .from(sites)
      .leftJoin(customers, eq(sites.customerId, customers.id))
      .where(eq(sites.id, row.siteId))
      .limit(1),
    loadRejections(db, id),
    db
      .select()
      .from(quotePackingSlips)
      .where(eq(quotePackingSlips.quoteId, id))
      .orderBy(asc(quotePackingSlips.dateCreated), asc(quotePackingSlips.id)),
    db
      .select({
        id: quotes.id,
        revisionId: quotes.revisionId,
        isRevision: quotes.isRevision,
        isLastRevision: quotes.isLastRevision,
        status: quotes.status,
        createdAt: quotes.createdAt,
      })
      .from(quotes)
      .where(
        or(
          eq(quotes.id, row.rootQuoteId ?? row.id),
          eq(quotes.rootQuoteId, row.rootQuoteId ?? row.id),
          and(isNull(quotes.rootQuoteId), eq(quotes.id, row.id)),
        ),
      )
      .orderBy(asc(quotes.revisionId), asc(quotes.id)),
  ])

  const totals = quoteTotals({
    taxCode: row.taxCode,
    appliedTaxRate: row.appliedTaxRate,
    manualTaxAmount: row.manualTaxAmount,
    ...lines,
  })
  const grants = new Set(session.user.grants.map((grant) => grant.key))
  const site = siteRows[0]

  const detail: QuoteDetail = {
    id: row.id,
    kind: row.kind,
    numberLabel: quoteNumberLabel(row.kind, row.id, row.workOrderNumber),
    workOrderNumber: row.workOrderNumber,
    status: row.status as QuoteStatusCode,
    statusView: quoteStatusView(row.status as QuoteStatusCode),
    siteId: row.siteId,
    siteName: site?.siteName ?? null,
    customerId: site?.customerId ?? null,
    customerName: site?.customerName ?? null,
    shipContact: row.shipContact,
    shipStreet1: row.shipStreet1,
    shipStreet2: row.shipStreet2,
    shipCity: row.shipCity,
    shipProvince: row.shipProvince ?? site?.siteProvince ?? null,
    shipPostalCode: row.shipPostalCode,
    isAddressUpdated: row.isAddressUpdated,
    report: row.report ?? '',
    notes: row.notes ?? '',
    pdfNotes: row.pdfNotes,
    paymentTermsId: row.paymentTermsId,
    taxCode: row.taxCode ?? site?.siteProvince ?? 'ON',
    appliedTaxRate: row.appliedTaxRate,
    manualTaxAmount: row.manualTaxAmount,
    dueDate: row.dueDate,
    isDueDateTbd: row.isDueDateTbd,
    dateApproved: row.dateApproved,
    dateCreated: row.dateCreated,
    isRevision: row.isRevision,
    revisionQuoteId: row.revisionQuoteId,
    rootQuoteId: row.rootQuoteId,
    revisionId: row.revisionId,
    isLastRevision: row.isLastRevision,
    isDeleted: row.isDeleted,
    createdFromLocal: row.createdFromLocal,
    referenceWoNumber: row.referenceWoNumber,
    convertedWorkOrderId: row.convertedWorkOrderId,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...lines,
    totals,
    rejections: rejections.map((rejection) => ({
      id: rejection.id,
      reason: rejection.reason,
      rejectedByDetail: rejection.rejectedByDetail,
      rejectedAt: rejection.rejectedAt.toISOString(),
    })),
    packingSlips: packingSlips.map((slip) => ({
      id: slip.id,
      dateCreated: slip.dateCreated,
      shipDate: slip.shipDate,
      packingSlipLevel: slip.packingSlipLevel,
      notes: slip.notes,
    })),
    revisions: revisionRows.map((revision) => ({
      id: revision.id,
      revisionId: revision.revisionId,
      isRevision: revision.isRevision,
      isLastRevision: revision.isLastRevision,
      status: revision.status as QuoteStatusCode,
      createdAt: revision.createdAt.toISOString(),
    })),
    capabilities: quoteCapabilities(
      { ...row, status: row.status as QuoteStatusCode },
      grants,
    ),
  }
  return detail
}
