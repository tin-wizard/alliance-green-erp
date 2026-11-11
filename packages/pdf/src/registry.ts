/**
 * The only place a document kind maps to its DTO schema and component.
 * Adding a document is one component plus one entry here (ADR 0011).
 */
import type { ComponentType } from 'react'
import type { z } from 'zod'
import { InvoiceDocument } from './documents/invoice'
import { PackingSlipDocument } from './documents/packing-slip'
import { QuoteDocument } from './documents/quote'
import { RgaDocument } from './documents/rga'
import { LETTER_PAGE, type PageSpec } from './theme'
import {
  invoiceDocumentDataSchema,
  packingSlipDocumentDataSchema,
  quoteDocumentDataSchema,
  rgaDocumentDataSchema,
  type DocumentData,
  type InvoiceDocumentData,
  type PackingSlipDocumentData,
  type QuoteDocumentData,
  type RgaDocumentData,
} from './types'

export interface PdfDocumentDefinition<TData extends DocumentData = DocumentData> {
  readonly kind: TData['kind']
  /** Used in PDF metadata and the shell header. */
  readonly title: string
  readonly schema: z.ZodType<TData>
  readonly component: ComponentType<{ readonly data: TData }>
  readonly page: PageSpec
}

export interface PdfDocumentRegistry {
  readonly quote: PdfDocumentDefinition<QuoteDocumentData>
  readonly 'packing-slip': PdfDocumentDefinition<PackingSlipDocumentData>
  readonly invoice: PdfDocumentDefinition<InvoiceDocumentData>
  readonly rga: PdfDocumentDefinition<RgaDocumentData>
}

export const PDF_REGISTRY: PdfDocumentRegistry = {
  quote: {
    kind: 'quote',
    title: 'Quotation',
    schema: quoteDocumentDataSchema,
    component: QuoteDocument,
    page: LETTER_PAGE,
  },
  'packing-slip': {
    kind: 'packing-slip',
    title: 'Packing slip',
    schema: packingSlipDocumentDataSchema,
    component: PackingSlipDocument,
    page: LETTER_PAGE,
  },
  invoice: {
    kind: 'invoice',
    title: 'Invoice',
    schema: invoiceDocumentDataSchema,
    component: InvoiceDocument,
    page: LETTER_PAGE,
  },
  rga: {
    kind: 'rga',
    title: 'Return goods authorization',
    schema: rgaDocumentDataSchema,
    component: RgaDocument,
    page: LETTER_PAGE,
  },
}
