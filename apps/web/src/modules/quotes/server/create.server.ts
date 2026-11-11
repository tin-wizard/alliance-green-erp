/**
 * Create a quote.
 *
 * SERVER ONLY. One transaction: number reservation (customer quotes share the
 * Work Orders series), header, lines, audit. A quote never owns a counter of its
 * own (BUSINESS-RULES H4).
 */
import { eq } from 'drizzle-orm'
import { ValidationError } from '@cls/core'
import type { Tx } from '@cls/db'
import { quotes, workOrders } from '@cls/db/schema'
import { calculateQuoteTotals } from '@cls/pricing'
import type { AuthSessionView } from '../../../server/auth.types'
import type { QuoteCreateInput, QuoteKind } from '../types'
import { getSite } from '../../work-orders/lib/lookups'
import {
  allocateWorkOrderNumber,
  commitWorkOrderNumber,
} from '../../work-orders/server/numbering.server'
import { assertQuoteWrite } from './access.server'
import { auditQuote, replaceLines } from './records.server'

export interface CreateQuoteResult {
  id: number
  kind: QuoteKind
  workOrderNumber: number | null
  numberLabel: string
  warnings: string[]
}

export async function createQuoteCore(
  tx: Tx,
  input: QuoteCreateInput,
  session: AuthSessionView,
): Promise<CreateQuoteResult> {
  assertQuoteWrite(session)

  const site = await getSite(input.siteId, tx)
  if (!site) throw new ValidationError('Choose a valid site for this quote.')

  const taxCode = (input.taxCode || site.province || 'ON').toUpperCase()
  const dueDate = input.isDueDateTbd ? null : (input.dueDate ?? null)

  // Fail before reserving a number if the lines cannot be priced.
  calculateQuoteTotals({
    taxProvince: taxCode,
    appliedTaxRate: input.appliedTaxRate,
    manualTaxAmount: input.manualTaxAmount,
    labour: input.hours.map((line) => ({
      hours: line.hours ?? '0',
      numTechs: line.numTechs ?? 1,
      rate: line.rate ?? '0',
      incurredHours: line.incurredHours,
      incurredRate: line.incurredRate,
    })),
    parts: input.parts.map((line) => ({
      qty: line.qty,
      price: line.price,
      costPrice: line.costPrice,
    })),
    specialParts: input.specialParts.map((line) => ({
      name: line.name,
      qty: line.qty,
      price: line.price,
      costPrice: line.costPrice,
    })),
  })

  let workOrderNumber = input.workOrderNumber ?? null
  const warnings: string[] = []

  if (workOrderNumber !== null) {
    const [existing] = await tx
      .select({ id: workOrders.id })
      .from(workOrders)
      .where(eq(workOrders.id, workOrderNumber))
      .limit(1)
    if (!existing) {
      throw new ValidationError(`Work order ${workOrderNumber} does not exist.`)
    }
  } else if (input.kind === 'customer') {
    const plan = await allocateWorkOrderNumber(tx, 1)
    await commitWorkOrderNumber(tx, plan)
    workOrderNumber = plan.number
    warnings.push(...plan.warnings)
  }

  const status = input.kind === 'standalone' && input.saveAsSaved ? 2 : 1

  const [row] = await tx
    .insert(quotes)
    .values({
      kind: input.kind,
      workOrderNumber,
      siteId: input.siteId,
      shipContact: input.shipContact || null,
      shipStreet1: input.shipStreet1 || site.street || null,
      shipStreet2: input.shipStreet2 || null,
      shipCity: input.shipCity || site.city || null,
      shipProvince: input.shipProvince || site.province || null,
      shipPostalCode: input.shipPostalCode || site.postalCode || null,
      isAddressUpdated: Boolean(
        input.shipStreet1 ||
          input.shipCity ||
          input.shipProvince ||
          input.shipPostalCode ||
          input.shipContact,
      ),
      report: input.report ?? '',
      notes: input.notes ?? '',
      pdfNotes: input.pdfNotes ?? null,
      status,
      paymentTermsId: input.paymentTermsId ?? null,
      taxCode,
      appliedTaxRate: input.appliedTaxRate || null,
      manualTaxAmount: input.manualTaxAmount || null,
      dueDate,
      isDueDateTbd: Boolean(input.isDueDateTbd),
      referenceWoNumber: input.referenceWoNumber ?? null,
      createdFromLocal: input.kind === 'standalone' ? Boolean(input.createdFromLocal) : false,
      revisionId: '0',
      isLastRevision: true,
      createdBy: session.user.id,
      updatedBy: session.user.id,
    })
    .returning()

  if (!row) throw new ValidationError('The quote could not be created.')

  await replaceLines(tx, row.id, input)

  await auditQuote(tx, session, 'quote.create', row.id, {
    summary: `Created ${input.kind} quote ${row.id}${workOrderNumber ? ` for work order ${workOrderNumber}` : ''}.`,
    after: row as unknown as Record<string, unknown>,
  })

  return {
    id: row.id,
    kind: input.kind,
    workOrderNumber,
    numberLabel: input.kind === 'customer' ? String(workOrderNumber) : String(row.id),
    warnings,
  }
}
