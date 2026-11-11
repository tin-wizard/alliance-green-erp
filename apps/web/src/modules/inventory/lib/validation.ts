import { z } from 'zod'

const signedDecimal = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d{1,2})?$/, 'Use a number with at most 2 decimal places.')
const money = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, 'Use a price with at most 2 decimal places.')
  .nullish()

export const adjustmentSchema = z.object({
  partNo: z.string().trim().min(1).max(100),
  qty: signedDecimal,
  adjustmentType: z
    .enum(['global', 'alliance', 'subcontractor', 'customer', 'contractor'])
    .default('global'),
  notes: z.string().trim().max(2000).nullish(),
  price: money,
  workOrderNumber: z.number().int().positive().nullish(),
  siteId: z.number().int().positive().nullish(),
  subcontractorId: z.number().int().positive().nullish(),
  massAdjustmentNumber: z.number().int().positive().nullish(),
  onFieldCountedQty: z.string().trim().max(50).nullish(),
  idempotencyKey: z.string().trim().min(8).max(100),
})

export const stockListSchema = z.object({
  search: z.string().trim().max(100).default(''),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
})

export const movementReportSchema = z.object({
  kind: z.enum(['purchased', 'sold', 'complete']).default('complete'),
  search: z.string().trim().max(100).default(''),
  limit: z.number().int().min(1).max(500).default(200),
})

export const priceLockSchema = z.object({
  takeOver: z.boolean().default(false),
  reason: z.string().trim().max(1000).nullish(),
})

const priceFields = z.object({
  cost: money,
  sellPrice: money,
  installPrice: money,
  recyclePrice: money,
})

const rateFields = z.object({
  id: z.uuid(),
  costPrice: money,
  sellPrice: money,
  installPrice: money,
  recyclePrice: money,
  markup: money,
})

export const savePricesSchema = z.object({
  partId: z.number().int(),
  sectionName: z.string().trim().max(100).nullish(),
  fields: priceFields.optional(),
  supplierRates: z.array(rateFields).max(50).default([]),
  sellingRates: z.array(rateFields).max(50).default([]),
})

export const partPriceEditorSchema = z.object({ partId: z.number().int() })

export const subStockListSchema = z.object({
  search: z.string().trim().max(100).default(''),
})

export const markMessageReadSchema = z.object({ id: z.number().int().positive() })

export const subStockSubscriptionSchema = z.object({
  containStock: z.boolean(),
  notificationCode: z.string().trim().max(50).optional(),
})

export const sendSubStockMessageSchema = z.object({
  subcontractorId: z.number().int().positive(),
  subject: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(5000),
})
