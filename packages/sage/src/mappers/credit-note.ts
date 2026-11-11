/**
 * Credit notes.
 *
 * A credit note is its own artefact, allocated against invoices with
 * `/contact_allocations`. It is never a negative invoice: a negative invoice
 * nets to the right total and leaves two open documents that no ageing report
 * can explain.
 *
 * Shapes (v3.1):
 *   POST /sales_credit_notes    { sales_credit_note:    { contact_id, date, reference, notes, invoice_lines[] } }
 *   POST /purchase_credit_notes { purchase_credit_note: { contact_id, date, reference, notes, invoice_lines[] } }
 *
 * Public names `mapSalesCreditNote` and `mapPurchaseCreditNote` are the contract
 * the RGA agent targets; do not rename them.
 */
import type { SageCreditNotePayload } from '../invoices'
import { mapLines, type DocumentMappingContext } from './common'
import type { MappedDocument } from './documents'

export function mapSalesCreditNote(
  payload: SageCreditNotePayload,
  context: DocumentMappingContext,
): MappedDocument {
  return mapCreditNote('sales', payload, context)
}

export function mapPurchaseCreditNote(
  payload: SageCreditNotePayload,
  context: DocumentMappingContext,
): MappedDocument {
  return mapCreditNote('purchase', payload, context)
}

function mapCreditNote(
  kind: 'sales' | 'purchase',
  payload: SageCreditNotePayload,
  context: DocumentMappingContext,
): MappedDocument {
  const mapped = mapLines({
    lines: payload.lines,
    context,
    subtotal: payload.subtotal,
    tax: payload.tax,
    total: payload.total,
  })
  const key = kind === 'sales' ? 'sales_credit_note' : 'purchase_credit_note'
  return {
    path: kind === 'sales' ? 'sales_credit_notes' : 'purchase_credit_notes',
    body: {
      [key]: {
        contact_id: context.contactId,
        date: payload.creditDate,
        reference: payload.externalRef,
        notes: payload.note ?? `Credit note for ${payload.workOrderNumber ?? payload.externalRef}`,
        invoice_lines: mapped.lines,
      },
    },
    reference: payload.externalRef,
    netCents: mapped.netCents,
    taxCents: mapped.taxCents,
    roundingAdded: mapped.roundingAdded,
  }
}
