import { z } from 'zod'
import { LEGACY_PART_PLACEHOLDER, LEGACY_PART_PLACEHOLDER_MESSAGE } from '@cls/pricing'

const postablePartNo = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => value !== LEGACY_PART_PLACEHOLDER, LEGACY_PART_PLACEHOLDER_MESSAGE)

const signedDecimal = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d{1,2})?$/, 'Use a number with at most 2 decimal places.')
const money = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d{1,2})?$/, 'Use an amount with at most 2 decimal places.')
const optionalMoney = money.nullish()
const rate = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,5})?$/, 'Use a non-negative rate with at most 5 decimal places.')
  .nullish()

export const createInvoiceSchema = z.object({ workOrderId: z.number().int().positive() })

export const invoiceIdSchema = z.object({ invoiceId: z.number().int().positive() })

export const saveInvoiceSchema = z.object({
  invoiceId: z.number().int().positive(),
  version: z.number().int().positive(),
  invoiceDate: z.iso.date().optional(),
  dueDate: z.iso.date().nullish(),
  notes: z.string().trim().max(4000).nullish(),
  taxProvince: z.string().trim().max(10).default('ON'),
  appliedTaxRate: rate,
  appliedTaxRatePst: rate,
  manualTaxAmount: optionalMoney,
  manualSubtotalAmount: optionalMoney,
  labour: z
    .array(
      z.object({
        date: z.iso.date(),
        hours: signedDecimal,
        rateCode: z.number().int().min(1).max(3).default(1),
        hourlyRate: z
          .string()
          .trim()
          .regex(/^\d+(\.\d{1,2})?$/, 'Hourly rate must be zero or greater.'),
        description: z.string().trim().max(500).nullish(),
      }),
    )
    .min(1, 'Enter labour before saving an invoice.'),
  parts: z
    .array(
      z.object({
        partNo: postablePartNo,
        description: z.string().trim().max(500).nullish(),
        qty: signedDecimal,
        price: money,
        isLocalPart: z.boolean().default(false),
      }),
    )
    .default([]),
  specialParts: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(500),
        qty: signedDecimal,
        price: money,
        isEmergencyLighting: z.boolean().default(false),
        isLocalPart: z.boolean().default(false),
        warrantyYears: z.string().trim().max(50).nullish(),
        laborWarrantyYears: z.string().trim().max(50).nullish(),
      }),
    )
    .default([]),
  totals: z.object({
    labour: money,
    material: money,
    subtotal: money,
    tax: money,
    total: money,
  }),
})

export const previewInvoiceSchema = z.object({
  taxProvince: z.string().trim().max(10).default('ON'),
  appliedTaxRate: rate,
  workOrderId: z.number().int().positive().nullish(),
  manualTaxAmount: optionalMoney,
  manualSubtotalAmount: optionalMoney,
  labour: z
    .array(
      z.object({
        hours: signedDecimal,
        rate: z.string().trim().regex(/^\d+(\.\d{1,2})?$/),
      }),
    )
    .min(1, 'Enter labour before calculating.'),
  parts: z
    .array(
      z.object({
        partNo: z
          .string()
          .trim()
          .max(100)
          .nullish()
          .refine(
            (value) => (value ?? '') !== LEGACY_PART_PLACEHOLDER,
            LEGACY_PART_PLACEHOLDER_MESSAGE,
          ),
        qty: signedDecimal,
        price: money,
      }),
    )
    .default([]),
  specialParts: z
    .array(
      z.object({
        name: z.string().trim().min(1, 'Enter a value for special part name.'),
        qty: signedDecimal,
        price: money,
      }),
    )
    .default([]),
})

export const issueInvoiceSchema = z.object({
  invoiceId: z.number().int().positive(),
  version: z.number().int().positive(),
})

export const rejectInvoiceSchema = z.object({
  invoiceId: z.number().int().positive(),
  reason: z.string().trim().min(1).max(4000),
  rejectedByDetail: z.string().trim().max(200).nullish(),
})

export const resubmitInvoiceSchema = z.object({ invoiceId: z.number().int().positive() })

export const recordPaymentSchema = z.object({
  invoiceId: z.number().int().positive(),
  amount: money.refine((value) => Number(value) > 0, 'Payment must be greater than zero.'),
  paidOn: z.iso.date().optional(),
  method: z.string().trim().max(50).nullish(),
  reference: z.string().trim().max(100).nullish(),
  notes: z.string().trim().max(1000).nullish(),
  idempotencyKey: z.string().trim().min(8).max(100),
})

export const documentIdSchema = z.object({ documentId: z.uuid() })

export const submitSubcontractorInvoiceSchema = z.object({
  workOrderId: z.number().int().positive(),
  invoiceNumber: z.string().trim().min(1).max(100),
  invoiceDate: z.iso.date(),
  taxProvince: z.string().trim().max(10).default('ON'),
  appliedTaxRate: rate,
  notes: z.string().trim().max(4000).nullish(),
  lines: z
    .array(
      z.object({
        kind: z.enum(['labour', 'part', 'special']),
        description: z.string().trim().max(500).nullish(),
        qty: signedDecimal,
        rate: money,
        sourceLineId: z.number().int().positive().nullish(),
      }),
    )
    .min(1),
})

export const approveSubcontractorInvoiceSchema = z.object({
  invoiceId: z.number().int().positive(),
  version: z.number().int().positive(),
})

export const rejectSubcontractorInvoiceSchema = z.object({
  invoiceId: z.number().int().positive(),
  reason: z.string().trim().min(1).max(4000),
})

export const recordSubcontractorPaymentSchema = z.object({
  invoiceId: z.number().int().positive(),
  amount: money.refine((value) => Number(value) > 0, 'Payment must be greater than zero.'),
  paidOn: z.iso.date().optional(),
  method: z.string().trim().max(50).nullish(),
  reference: z.string().trim().max(100).nullish(),
  notes: z.string().trim().max(1000).nullish(),
  idempotencyKey: z.string().trim().min(8).max(100),
})
