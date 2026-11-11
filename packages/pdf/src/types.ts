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

export const DOCUMENT_KINDS = ['quote', 'packing-slip'] as const

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

export type DocumentData = QuoteDocumentData | PackingSlipDocumentData

/** The DTO a given document kind accepts, e.g. `DocumentDataFor<'quote'>`. */
export type DocumentDataFor<TKind extends DocumentKind> = Extract<
  DocumentData,
  { kind: TKind }
>
