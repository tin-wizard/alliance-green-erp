import { z } from 'zod'
import { RGA_REPLACEMENT_TYPES, RGA_TYPES } from './lifecycle'

const signedDecimal = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d{1,2})?$/, 'Use a number with at most 2 decimal places.')
const quantity = signedDecimal.refine((value) => Number(value) > 0, 'Quantity must be greater than zero.')
const price = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, 'Use a non-negative price with at most 2 decimal places.')
const rate = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,5})?$/, 'Use a non-negative rate with at most 5 decimal places.')
  .nullish()
const optionalText = z.string().trim().max(4000).nullish()

const partSchema = z.object({
  partNo: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullish(),
  qty: quantity,
  returnQty: quantity,
  price,
  reasonForReturn: optionalText,
  underWarranty: z.boolean().default(false),
  purchaseType: z.string().trim().max(50).nullish(),
  purchaseTypeNumber: z.string().trim().max(50).nullish(),
  poNumber: z.string().trim().max(50).nullish(),
  poPartId: z.number().int().positive().nullish(),
  modelNumber: z.string().trim().max(150).nullish(),
  originalInvoiceNumber: z.string().trim().max(100).nullish(),
  originalInvoiceDate: z.iso.date().nullish(),
})

const specialPartSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).nullish(),
  qty: quantity,
  returnQty: quantity,
  price,
  reasonForReturn: optionalText,
  purchaseType: z.string().trim().max(50).nullish(),
  purchaseTypeNumber: z.string().trim().max(50).nullish(),
  poNumber: z.string().trim().max(50).nullish(),
  poSpecialPartId: z.number().int().positive().nullish(),
  modelNumber: z.string().trim().max(150).nullish(),
  originalInvoiceNumber: z.string().trim().max(100).nullish(),
  originalInvoiceDate: z.iso.date().nullish(),
})

const lines = {
  parts: z.array(partSchema).default([]),
  specialParts: z.array(specialPartSchema).default([]),
}

function hasLines(value: { parts: unknown[]; specialParts: unknown[] }): boolean {
  return value.parts.length + value.specialParts.length > 0
}

export const createRgaSchema = z
  .object({
    supplierId: z.number().int().positive().nullish(),
    poId: z.number().int().nullish(),
    workOrderId: z.number().int().positive().nullish(),
    siteId: z.number().int().positive().nullish(),
    rgaType: z.enum(RGA_TYPES).default('rga'),
    replacementType: z.enum(RGA_REPLACEMENT_TYPES).nullish(),
    requestDate: z.iso.date().optional(),
    rgaNotes: optionalText,
    internalNotes: optionalText,
    shippingAddress: z.string().trim().max(2000).nullish(),
    ...lines,
  })
  .refine(hasLines, { message: 'Add at least one part or special-part line.', path: ['parts'] })

export const updateRgaSchema = z
  .object({
    rgaId: z.number().int().positive(),
    version: z.number().int().positive(),
    supplierId: z.number().int().positive().nullish(),
    poId: z.number().int().nullish(),
    workOrderId: z.number().int().positive().nullish(),
    siteId: z.number().int().positive().nullish(),
    rgaType: z.enum(RGA_TYPES),
    replacementType: z.enum(RGA_REPLACEMENT_TYPES).nullish(),
    requestDate: z.iso.date().optional(),
    rgaNotes: optionalText,
    internalNotes: optionalText,
    shippingAddress: z.string().trim().max(2000).nullish(),
    ...lines,
  })
  .refine(hasLines, { message: 'Add at least one part or special-part line.', path: ['parts'] })

export const rgaIdSchema = z.object({ rgaId: z.number().int().positive() })

export const approveRgaSchema = z.object({
  rgaId: z.number().int().positive(),
  version: z.number().int().positive(),
  note: optionalText,
})

export const transitionRgaSchema = z.object({
  rgaId: z.number().int().positive(),
  version: z.number().int().positive(),
  toStatus: z.union([z.literal(3), z.literal(4), z.literal(6), z.literal(7), z.literal(10)]),
  note: optionalText,
})

export const recordRgaCreditSchema = z.object({
  rgaId: z.number().int().positive(),
  version: z.number().int().positive(),
  creditNumber: z.string().trim().min(1).max(100).optional(),
  creditDate: z.iso.date().optional(),
  taxProvince: z.string().trim().max(10).default('ON'),
  appliedTaxRate: rate,
})

export const listRgaSchema = z.object({
  status: z.coerce.number().int().optional(),
  type: z.enum(RGA_TYPES).optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.number().int().positive().max(200).optional(),
})

export const queueRgaNotificationSchema = z.object({
  rgaId: z.number().int().positive(),
  notifyType: z.string().trim().min(1).max(50).default('Reminder'),
  dueAt: z.iso.datetime().optional(),
})

export const createWarrantySchema = z.object({
  siteId: z.number().int().positive(),
  description: z.string().trim().min(1).max(1000),
  expiresOn: z.iso.date(),
  documentKey: z.string().trim().max(500).nullish(),
  workOrderId: z.number().int().positive().nullish(),
})

export const warrantyIdSchema = z.object({ warrantyId: z.uuid() })

export const listWarrantySchema = z.object({
  filter: z.enum(['all', 'expiring', 'expired', 'active']).default('all'),
  search: z.string().trim().max(100).optional(),
})

export type CreateRgaInput = z.infer<typeof createRgaSchema>
export type UpdateRgaInput = z.infer<typeof updateRgaSchema>
export type CreateWarrantyInput = z.infer<typeof createWarrantySchema>
