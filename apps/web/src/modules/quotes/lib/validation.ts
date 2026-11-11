import { z } from 'zod'

const decimal = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d{1,2})?$/, 'Use a number with at most 2 decimal places.')

const optionalDecimal = decimal.nullish()

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish()

export const quoteIdSchema = z.object({ id: z.number().int().positive() })

export const quoteKindSchema = z.enum(['customer', 'standalone'])
export const quoteStatusSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
])

const hourLineSchema = z.object({
  lineDate: dateString,
  hours: decimal.default('0'),
  numTechs: z.number().int().min(1).max(100).default(1),
  rateCode: z.string().trim().max(40).nullish(),
  rate: decimal.default('0'),
  incurredHours: optionalDecimal,
  incurredRate: optionalDecimal,
  note: z.string().trim().max(500).nullish(),
})

const partLineSchema = z.object({
  partNo: z.string().trim().min(1).max(40),
  description: z.string().trim().max(500).nullish(),
  qty: z.number().int().min(-99999).max(999999),
  price: decimal,
  costPrice: optionalDecimal,
  isUnderWarranty: z.boolean().default(false),
})

const specialLineSchema = z.object({
  name: z.string().trim().min(1).max(250),
  qty: z.number().int().min(-99999).max(999999),
  price: decimal,
  costPrice: optionalDecimal,
  isEmergencyLighting: z.boolean().default(false),
})

const headerSchema = z.object({
  siteId: z.number().int().positive(),
  workOrderNumber: z.number().int().positive().nullish(),
  shipContact: z.string().trim().max(250).nullish(),
  shipStreet1: z.string().trim().max(250).nullish(),
  shipStreet2: z.string().trim().max(250).nullish(),
  shipCity: z.string().trim().max(100).nullish(),
  shipProvince: z.string().trim().max(25).nullish(),
  shipPostalCode: z.string().trim().max(25).nullish(),
  report: z.string().max(20000).default(''),
  notes: z.string().max(20000).default(''),
  pdfNotes: z.string().max(20000).nullish(),
  paymentTermsId: z.number().int().positive().nullish(),
  taxCode: z.string().trim().max(10).nullish(),
  appliedTaxRate: z
    .string()
    .trim()
    .regex(/^\d(\.\d{1,5})?$/, 'Use a decimal rate such as 0.13.')
    .nullish(),
  manualTaxAmount: optionalDecimal,
  dueDate: dateString,
  isDueDateTbd: z.boolean().default(false),
  referenceWoNumber: z.string().trim().max(25).nullish(),
  createdFromLocal: z.boolean().default(false),
})

export const createQuoteSchema = headerSchema.extend({
  kind: quoteKindSchema,
  saveAsSaved: z.boolean().default(false),
  hours: z.array(hourLineSchema).max(200).default([]),
  parts: z.array(partLineSchema).max(500).default([]),
  specialParts: z.array(specialLineSchema).max(200).default([]),
})

export const updateQuoteSchema = headerSchema.extend({
  id: z.number().int().positive(),
  version: z.number().int().positive(),
  hours: z.array(hourLineSchema).max(200).default([]),
  parts: z.array(partLineSchema).max(500).default([]),
  specialParts: z.array(specialLineSchema).max(200).default([]),
})

export const transitionQuoteSchema = z.object({
  id: z.number().int().positive(),
  version: z.number().int().positive(),
  to: quoteStatusSchema,
  note: z.string().trim().max(2000).nullish(),
})

export const rejectQuoteSchema = z.object({
  id: z.number().int().positive(),
  version: z.number().int().positive(),
  reason: z.string().trim().min(3).max(2000),
  rejectedByDetail: z.string().trim().max(250).nullish(),
})

export const reviseQuoteSchema = z.object({
  id: z.number().int().positive(),
  reason: z.string().trim().max(2000).nullish(),
})

export const packingSlipSchema = z.object({
  quoteId: z.number().int().positive(),
  shipDate: dateString,
  notes: z.string().trim().max(2000).nullish(),
  parts: z
    .array(
      z.object({
        quotePartId: z.number().int().positive().optional(),
        partNo: z.string().trim().min(1).max(40),
        actualQty: z.number().int().min(0),
        shippedQty: z.number().int().min(0),
        backorderQty: z.number().int().min(0),
      }),
    )
    .default([]),
  specialParts: z
    .array(
      z.object({
        quoteSpecialPartId: z.number().int().positive().optional(),
        name: z.string().trim().min(1).max(250),
        actualQty: z.number().int().min(0),
        shippedQty: z.number().int().min(0),
        backorderQty: z.number().int().min(0),
      }),
    )
    .default([]),
})

export const listQuoteFiltersSchema = z.object({
  kind: z.enum(['customer', 'standalone', 'all']).default('all'),
  status: quoteStatusSchema.optional(),
  search: z.string().trim().max(200).default(''),
  cursor: z.string().max(500).nullish(),
  size: z.number().int().min(10).max(100).default(25),
})

export type ValidatedCreateQuote = z.infer<typeof createQuoteSchema>
export type ValidatedUpdateQuote = z.infer<typeof updateQuoteSchema>
export type ValidatedPackingSlip = z.infer<typeof packingSlipSchema>
