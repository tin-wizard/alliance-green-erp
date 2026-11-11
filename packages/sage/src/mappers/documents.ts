/**
 * Sales invoice, purchase invoice and credit-note mappings against the
 * documented Sage Accounting v3.1 shapes.
 *
 * Shapes (v3.1):
 *   POST /sales_invoices        { sales_invoice:       { contact_id, date, reference, notes, invoice_lines[] } }
 *   POST /purchase_invoices     { purchase_invoice:    { contact_id, date, reference, notes, invoice_lines[] } }
 *   POST /sales_credit_notes    { sales_credit_note:   { contact_id, date, reference, notes, invoice_lines[] } }
 *   POST /purchase_credit_notes { purchase_credit_note:{ contact_id, date, reference, notes, invoice_lines[] } }
 *
 * A credit note is its own artefact, allocated against invoices with
 * `/contact_allocations`; it is never posted as a negative invoice.
 */
import type { SagePurchaseInvoicePayload, SageSalesInvoicePayload } from '../invoices'
import { mapLines, type DocumentMappingContext, type MappedLines } from './common'

export interface MappedDocument {
  path: string
  body: Record<string, unknown>
  reference: string
  netCents: number
  taxCents: number
  roundingAdded: boolean
}

function mapInvoice(input: {
  key: string
  path: string
  payload: SageSalesInvoicePayload | SagePurchaseInvoicePayload
  context: DocumentMappingContext
  notes: string
}): MappedDocument {
  const mapped: MappedLines = mapLines({
    lines: input.payload.lines,
    context: input.context,
    subtotal: input.payload.subtotal,
    tax: input.payload.tax,
    total: input.payload.total,
  })
  const body: Record<string, unknown> = {
    [input.key]: {
      contact_id: input.context.contactId,
      date: input.payload.invoiceDate,
      reference: input.payload.externalRef,
      notes: input.notes,
      invoice_lines: mapped.lines,
    },
  }
  return {
    path: input.path,
    body,
    reference: input.payload.externalRef,
    netCents: mapped.netCents,
    taxCents: mapped.taxCents,
    roundingAdded: mapped.roundingAdded,
  }
}

export function mapSalesInvoice(
  payload: SageSalesInvoicePayload,
  context: DocumentMappingContext,
): MappedDocument {
  return mapInvoice({
    key: 'sales_invoice',
    path: 'sales_invoices',
    payload,
    context,
    notes: `Work order ${payload.workOrderNumber} · invoice ${payload.invoiceNumber}`,
  })
}

export function mapPurchaseInvoice(
  payload: SagePurchaseInvoicePayload,
  context: DocumentMappingContext,
): MappedDocument {
  return mapInvoice({
    key: 'purchase_invoice',
    path: 'purchase_invoices',
    payload,
    context,
    notes: `Work order ${payload.workOrderNumber} · supplier invoice ${payload.invoiceNumber}`,
  })
}

// Credit notes live in `credit-note.ts` so their public names stay stable for
// the RGA agent: `mapSalesCreditNote`, `mapPurchaseCreditNote`.
