import { z } from 'zod'

const name = z.string().trim().min(1, 'Enter a name.').max(120, 'Use 120 characters or fewer.')
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null))

const money = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, 'Use a non-negative amount with at most 2 decimal places.')

const quantity = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,3})?$/, 'Use a quantity with at most 3 decimal places.')
  .refine((value) => Number(value) > 0, 'Quantity must be greater than zero.')

const factor = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,4})?$/, 'Use a number with at most 4 decimal places.')

const markup = factor.refine((value) => Number(value) > 0, 'Markup must be greater than zero.')
const ratio = factor

const partNo = z
  .string()
  .trim()
  .min(1, 'Enter a part number.')
  .max(50, 'Use 50 characters or fewer.')
  .transform((value) => value.toUpperCase())

const partType = z.enum(['Ballast', 'Lamp', '']).default('')
const optionalDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in YYYY-MM-DD form.')
  .nullish()
  .transform((value) => (value ? value : null))

const quoteType = z.enum(['Gen 1', 'Gen 2'])
const gridType = z
  .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
  .nullish()
  .transform((value) => value ?? null)
const paymentTerms = z
  .union([z.literal(1), z.literal(3), z.literal(4), z.literal(5)])
  .nullish()
  .transform((value) => value ?? null)

const appliedTaxRate = z
  .string()
  .trim()
  .max(20)
  .nullish()
  .transform((value) => (value ? value : null))
  .refine(
    (value) => value === null || (/^\d+(\.\d{1,5})?$/.test(value) && Number(value) <= 1),
    'Enter a tax rate between 0 and 1.',
  )

export const quoteListSchema = z.object({
  status: z.union([z.literal(1), z.literal(3), z.literal(4), z.literal(5)]).optional(),
  search: z.string().trim().max(100).optional(),
})

export const quoteIdSchema = z.object({ id: z.number().int().positive() })

export const headerSchema = z.object({
  siteId: z.number().int().positive(),
  quoteType,
  ceilingGridType: gridType,
  isTypeMaintenance: z.boolean().default(false),
  paymentTermsCode: paymentTerms,
  dueDate: optionalDate,
  taxProvince: optionalText(40),
  appliedTaxRate,
  shipToType: optionalText(40),
  shipContactName: optionalText(120),
  shipCompany: optionalText(160),
  shipStreet1: optionalText(200),
  shipStreet2: optionalText(200),
  shipCity: optionalText(120),
  shipProvince: optionalText(40),
  shipPostalCode: optionalText(30),
  shipPhone: optionalText(40),
  shippingAddress: optionalText(2000),
  notes: optionalText(4000),
  pdfNotes: optionalText(4000),
})

export const createQuoteSchema = headerSchema

const fixturePartSchema = z.object({
  partNo,
  partType,
  markup,
  ratioPerFixture: ratio,
})

const fixtureSchema = z.object({
  fixtureId: z.number().int().positive().nullable(),
  fixtureName: name,
  quantity,
  parts: z.array(fixturePartSchema).max(200),
})

const roomSchema = z.object({
  roomId: z.number().int().positive().nullable(),
  roomName: name,
  fixtures: z.array(fixtureSchema).max(500),
})

const specialPartSchema = z.object({
  name,
  quantity,
  unitPrice: money,
})

const priceOverrideSchema = z.object({
  partNo,
  price: money,
})

export const saveQuoteSchema = headerSchema.extend({
  id: z.number().int().positive(),
  version: z.number().int().positive(),
  revisionNotes: optionalText(2000),
  rooms: z.array(roomSchema).max(500),
  specialParts: z.array(specialPartSchema).max(500),
  priceOverrides: z.array(priceOverrideSchema).max(2000),
})

export const searchSitesSchema = z.object({
  search: z.string().trim().max(100).optional(),
  limit: z.number().int().min(1).max(50).default(10),
})

export const transitionSchema = z.object({
  id: z.number().int().positive(),
  version: z.number().int().positive(),
})

export const revisionSchema = transitionSchema.extend({
  notes: optionalText(2000),
})

export const documentIdSchema = z.object({
  documentId: z.string().uuid(),
})

export const convertQuoteSchema = z.object({
  quoteId: z.number().int().positive(),
  version: z.number().int().positive(),
  serviceTypeId: z.number().int().positive(),
  priorityId: z.number().int().positive(),
  categoryId: z.number().int().positive().nullish().transform((value) => value ?? null),
  serviceRequired: z.string().trim().min(1, 'Enter the service required.').max(4000),
})

export const linkWorkOrderSchema = z.object({
  quoteId: z.number().int().positive(),
  version: z.number().int().positive(),
  workOrderId: z.number().int().positive(),
})

export type CreateQuoteInput = z.infer<typeof createQuoteSchema>
export type SaveQuoteInput = z.infer<typeof saveQuoteSchema>
export type QuoteListInput = z.infer<typeof quoteListSchema>
