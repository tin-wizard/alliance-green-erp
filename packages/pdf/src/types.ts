/**
 * Versioned document DTOs for `@cls/pdf` (ADR 0011).
 *
 * Modules map their own rows into these view models. The renderer only prints
 * what the DTO contains: money and quantities are decimal strings produced by
 * the module's authoritative calculator and are never recalculated here.
 */
import { z } from 'zod'

/** Version stamped on every document DTO. A breaking change bumps this. */
export const PDF_SCHEMA_VERSION = 1 as const

/** Version of the layout/renderer contract, recorded with generated documents. */
export const PDF_RENDERER_VERSION = '0.1.0' as const

export const DOCUMENT_KINDS = [
  'quote',
  'packing-slip',
  'invoice',
  'rga',
  'tjx-quote',
  'tjx-order-sheet',
] as const

export type DocumentKind = (typeof DOCUMENT_KINDS)[number]

/**
 * Fixed-point decimal string, e.g. `"0"`, `"-12.50"`, `"1234.5000"`.
 * No currency symbols, thousands separators, exponents or blank strings.
 */
const DECIMAL_STRING = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/

const nonEmptyText = (label: string) => z.string().trim().min(1, `${label} must not be blank`)

const optionalText = (label: string) => nonEmptyText(label).optional()

export const decimalStringSchema = z
  .string()
  .trim()
  .regex(DECIMAL_STRING, 'Expected a plain decimal string such as "1234.50"')

export const addressBlockDataSchema = z.strictObject({
  name: nonEmptyText('Address name'),
  contact: optionalText('Address contact'),
  street: optionalText('Street'),
  street2: optionalText('Street line 2'),
  city: optionalText('City'),
  province: optionalText('Province'),
  postalCode: optionalText('Postal code'),
  phone: optionalText('Phone'),
})

export type AddressBlockData = z.infer<typeof addressBlockDataSchema>

const noteListSchema = z.array(nonEmptyText('Note line')).optional()

export const quoteLineSchema = z.strictObject({
  position: z.number().int().positive(),
  partNumber: optionalText('Part number'),
  description: nonEmptyText('Description'),
  quantity: decimalStringSchema,
  unit: nonEmptyText('Unit'),
  unitPrice: decimalStringSchema,
  lineTotal: decimalStringSchema,
})

export const quoteTotalsSchema = z.strictObject({
  subtotal: decimalStringSchema,
  taxLabel: nonEmptyText('Tax label'),
  tax: decimalStringSchema,
  total: decimalStringSchema,
})

export const quoteDocumentDataSchema = z.strictObject({
  schemaVersion: z.literal(PDF_SCHEMA_VERSION),
  kind: z.literal('quote'),
  number: nonEmptyText('Quote number'),
  revision: optionalText('Revision'),
  issuedOn: z.iso.date(),
  validUntil: z.iso.date().optional(),
  customer: addressBlockDataSchema,
  shipTo: addressBlockDataSchema.optional(),
  lines: z.array(quoteLineSchema).min(1, 'A quote needs at least one line'),
  totals: quoteTotalsSchema,
  notes: noteListSchema,
  terms: noteListSchema,
})

export type QuoteLine = z.infer<typeof quoteLineSchema>
export type QuoteTotals = z.infer<typeof quoteTotalsSchema>
export type QuoteDocumentData = z.infer<typeof quoteDocumentDataSchema>

export const packingSlipLineSchema = z.strictObject({
  position: z.number().int().positive(),
  partNumber: optionalText('Part number'),
  description: nonEmptyText('Description'),
  quantity: decimalStringSchema,
  unit: nonEmptyText('Unit'),
  shipped: decimalStringSchema,
  backorder: decimalStringSchema,
})

export const packingSlipDocumentDataSchema = z.strictObject({
  schemaVersion: z.literal(PDF_SCHEMA_VERSION),
  kind: z.literal('packing-slip'),
  number: nonEmptyText('Packing slip number'),
  issuedOn: z.iso.date(),
  shipDate: z.iso.date().optional(),
  customer: addressBlockDataSchema,
  shipTo: addressBlockDataSchema.optional(),
  lines: z.array(packingSlipLineSchema).min(1, 'A packing slip needs at least one line'),
  notes: noteListSchema,
})

export type PackingSlipLine = z.infer<typeof packingSlipLineSchema>
export type PackingSlipDocumentData = z.infer<typeof packingSlipDocumentDataSchema>

export const invoiceDocumentDataSchema = z.strictObject({
  schemaVersion: z.literal(PDF_SCHEMA_VERSION),
  kind: z.literal('invoice'),
  number: nonEmptyText('Invoice number'),
  issuedOn: z.iso.date(),
  dueDate: z.iso.date().optional(),
  workOrderNumber: optionalText('Work order number'),
  customer: addressBlockDataSchema,
  shipTo: addressBlockDataSchema.optional(),
  lines: z.array(quoteLineSchema).min(1, 'An invoice needs at least one line'),
  totals: quoteTotalsSchema,
  notes: noteListSchema,
  terms: noteListSchema,
})

export type InvoiceDocumentData = z.infer<typeof invoiceDocumentDataSchema>

export const rgaLineSchema = z.strictObject({
  position: z.number().int().positive(),
  partNumber: optionalText('Part number'),
  description: nonEmptyText('Description'),
  quantity: decimalStringSchema,
  returnQuantity: decimalStringSchema,
  unitPrice: decimalStringSchema,
  reason: optionalText('Reason for return'),
})

export const rgaDocumentDataSchema = z.strictObject({
  schemaVersion: z.literal(PDF_SCHEMA_VERSION),
  kind: z.literal('rga'),
  number: nonEmptyText('RGA number'),
  issuedOn: z.iso.date(),
  typeLabel: nonEmptyText('RGA type'),
  statusLabel: nonEmptyText('RGA status'),
  supplier: addressBlockDataSchema.optional(),
  site: addressBlockDataSchema.optional(),
  workOrderNumber: optionalText('Work order number'),
  purchaseOrderNumber: optionalText('Purchase order number'),
  lines: z.array(rgaLineSchema).min(1, 'An RGA needs at least one line'),
  notes: noteListSchema,
})

export type RgaLine = z.infer<typeof rgaLineSchema>
export type RgaDocumentData = z.infer<typeof rgaDocumentDataSchema>

/* ---------------------------------- TJX ----------------------------------- */

export const tjxScopeFixtureSchema = z.strictObject({
  name: nonEmptyText('Fixture name'),
  quantity: decimalStringSchema,
})

export const tjxScopeRoomSchema = z.strictObject({
  name: nonEmptyText('Room name'),
  fixtures: z.array(tjxScopeFixtureSchema),
})

const tjxScopeSchema = z.array(tjxScopeRoomSchema)

export const tjxQuoteLineSchema = z.strictObject({
  position: z.number().int().positive(),
  partNumber: optionalText('Part number'),
  description: nonEmptyText('Description'),
  quantity: decimalStringSchema,
  unitPrice: decimalStringSchema,
  lineTotal: decimalStringSchema,
})

export const tjxSpecialLineSchema = z.strictObject({
  position: z.number().int().positive(),
  description: nonEmptyText('Special part name'),
  quantity: decimalStringSchema,
  unitPrice: decimalStringSchema,
  lineTotal: decimalStringSchema,
})

export const tjxQuoteDocumentDataSchema = z.strictObject({
  schemaVersion: z.literal(PDF_SCHEMA_VERSION),
  kind: z.literal('tjx-quote'),
  number: nonEmptyText('TJX quote number'),
  revision: optionalText('Revision'),
  issuedOn: z.iso.date(),
  dueDate: z.iso.date().optional(),
  customer: addressBlockDataSchema,
  shipTo: addressBlockDataSchema.optional(),
  quoteType: nonEmptyText('Quote type'),
  gridType: optionalText('Ceiling grid'),
  paymentTerms: optionalText('Payment terms'),
  rooms: tjxScopeSchema,
  lines: z.array(tjxQuoteLineSchema),
  specialParts: z.array(tjxSpecialLineSchema),
  totals: quoteTotalsSchema,
  notes: noteListSchema,
}).superRefine((data, ctx) => {
  if (data.lines.length === 0 && data.specialParts.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['lines'],
      message: 'A TJX quote needs at least one part or special-part line',
    })
  }
})

export type TjxQuoteDocumentData = z.infer<typeof tjxQuoteDocumentDataSchema>

export const tjxOrderSheetLineSchema = z.strictObject({
  position: z.number().int().positive(),
  partNumber: optionalText('Part number'),
  description: nonEmptyText('Description'),
  qtyWithMarkup: decimalStringSchema,
  qtyWithoutMarkup: decimalStringSchema,
  unitPrice: decimalStringSchema,
  lineWithMarkup: decimalStringSchema,
  lineWithoutMarkup: decimalStringSchema,
})

export const tjxOrderSheetTotalsSchema = z.strictObject({
  withMarkup: quoteTotalsSchema,
  withoutMarkup: quoteTotalsSchema,
})

export const tjxOrderSheetDocumentDataSchema = z.strictObject({
  schemaVersion: z.literal(PDF_SCHEMA_VERSION),
  kind: z.literal('tjx-order-sheet'),
  number: nonEmptyText('TJX order-sheet number'),
  revision: optionalText('Revision'),
  issuedOn: z.iso.date(),
  dueDate: z.iso.date().optional(),
  customer: addressBlockDataSchema,
  shipTo: addressBlockDataSchema.optional(),
  quoteType: nonEmptyText('Quote type'),
  gridType: optionalText('Ceiling grid'),
  paymentTerms: optionalText('Payment terms'),
  rooms: tjxScopeSchema,
  lines: z.array(tjxOrderSheetLineSchema),
  specialParts: z.array(tjxSpecialLineSchema),
  totals: tjxOrderSheetTotalsSchema,
  workOrders: z.array(nonEmptyText('Work order')).optional(),
  notes: noteListSchema,
}).superRefine((data, ctx) => {
  if (data.lines.length === 0 && data.specialParts.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['lines'],
      message: 'An order sheet needs at least one part or special-part line',
    })
  }
})

export type TjxOrderSheetDocumentData = z.infer<typeof tjxOrderSheetDocumentDataSchema>

export type DocumentData =
  | QuoteDocumentData
  | PackingSlipDocumentData
  | InvoiceDocumentData
  | RgaDocumentData
  | TjxQuoteDocumentData
  | TjxOrderSheetDocumentData

/** The DTO a given document kind accepts, e.g. `DocumentDataFor<'quote'>`. */
export type DocumentDataFor<TKind extends DocumentKind> = Extract<
  DocumentData,
  { kind: TKind }
>
