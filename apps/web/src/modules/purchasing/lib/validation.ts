import { z } from 'zod'
import { PO_INVOICE_STATUSES } from '../types'

const decimal = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d{1,2})?$/, 'Use a number with at most 2 decimal places.')
const optionalDecimal = decimal.nullish()
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish()

const partLine = z.object({
  partNo: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).nullish(),
  qty: decimal,
  price: decimal,
  itemPurchaseType: z.string().trim().max(30).nullish(),
  itemPurchaseTypeNumber: z.string().trim().max(50).nullish(),
})

const specialLine = z.object({
  name: z.string().trim().min(1).max(250),
  qty: decimal,
  price: decimal,
  itemPurchaseType: z.string().trim().max(30).nullish(),
  itemPurchaseTypeNumber: z.string().trim().max(50).nullish(),
})

const header = z.object({
  supplierId: z.number().int().positive(),
  subSupplierId: z.number().int().positive().nullish(),
  priorityId: z.number().int().positive().nullish(),
  shipmentType: z.string().trim().max(40).default('alliance'),
  shipContact: z.string().trim().max(250).nullish(),
  shipCompany: z.string().trim().max(250).nullish(),
  shipStreet1: z.string().trim().max(250).nullish(),
  shipStreet2: z.string().trim().max(250).nullish(),
  shipCity: z.string().trim().max(100).nullish(),
  shipProvince: z.string().trim().max(25).nullish(),
  shipPostalCode: z.string().trim().max(25).nullish(),
  shipPhone: z.string().trim().max(50).nullish(),
  expectedDelivery: dateString,
  supplierNotes: z.string().max(20000).nullish(),
  notes: z.string().max(20000).nullish(),
  fob: z.string().trim().max(100).nullish(),
  payTerms: z.string().trim().max(100).nullish(),
  shipVia: z.string().trim().max(100).nullish(),
  taxCode: z.string().trim().max(10).nullish(),
  appliedTaxRate: z
    .string()
    .trim()
    .regex(/^\d(\.\d{1,5})?$/, 'Use a decimal rate such as 0.13.')
    .nullish(),
  isTransfer: z.boolean().default(false),
  transferFromPoId: z.number().int().positive().nullish(),
  parts: z.array(partLine).max(500).default([]),
  specialParts: z.array(specialLine).max(200).default([]),
})

export const createPurchaseOrderSchema = header
export const updatePurchaseOrderSchema = header.extend({
  id: z.number().int().positive(),
  version: z.number().int().positive(),
})

export const transitionPurchaseOrderSchema = z.object({
  id: z.number().int().positive(),
  version: z.number().int().positive(),
  to: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
    z.literal(7),
    z.literal(8),
    z.literal(9),
    z.literal(10),
    z.literal(11),
  ]),
  reason: z.string().trim().max(5000).nullish(),
})

export const purchaseOrderIdSchema = z.object({ id: z.number().int().positive() })

export const listPurchaseOrdersSchema = z.object({
  status: z.number().int().min(1).max(11).nullish(),
  search: z.string().trim().max(100).default(''),
  cursor: z.string().nullish(),
  size: z.number().int().min(1).max(100).default(25),
})

export const receiptLineSchema = z.object({
  partLineId: z.number().int().positive().nullish(),
  specialPartLineId: z.number().int().positive().nullish(),
  qty: decimal,
  note: z.string().trim().max(500).nullish(),
})

export const receiptSchema = z.object({
  id: z.number().int().positive(),
  version: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(8).max(100),
  receivedOn: dateString,
  carrier: z.string().trim().max(100).nullish(),
  trackingId: z.string().trim().max(100).nullish(),
  notes: z.string().max(5000).nullish(),
  allowOverReceipt: z.boolean().default(false),
  allowOverReceiptReason: z.string().trim().max(1000).nullish(),
  lines: z.array(receiptLineSchema).min(1).max(500),
})

export const invoiceLineSchema = z.object({
  partLineId: z.number().int().positive().nullish(),
  specialPartLineId: z.number().int().positive().nullish(),
  qty: decimal,
  unitPrice: decimal,
  taxAmount: optionalDecimal,
})

export const invoiceSchema = z.object({
  id: z.number().int().positive(),
  supplierInvoiceNumber: z.string().trim().min(1).max(100),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  taxCode: z.string().trim().max(10).nullish(),
  appliedTaxRate: z.string().trim().regex(/^\d(\.\d{1,5})?$/).nullish(),
  taxHst: optionalDecimal,
  taxGst: optionalDecimal,
  taxPst: optionalDecimal,
  taxTvp: optionalDecimal,
  freight: optionalDecimal,
  lines: z.array(invoiceLineSchema).min(1).max(500),
})

export const invoiceCloseSchema = z.object({
  id: z.number().int().positive(),
  invoiceId: z.number().int().positive(),
  acceptVarianceReason: z.string().trim().max(1000).nullish(),
})

export const invoiceStatusSchema = z.enum(PO_INVOICE_STATUSES)

export const preorderSchema = z.object({
  sourceQuoteId: z.number().int().positive().nullish(),
  report: z.string().max(20000).nullish(),
  priorityId: z.number().int().positive().nullish(),
  notes: z.string().max(20000).nullish(),
  isWithoutQuote: z.boolean().default(false),
  workOrderNumber: z.number().int().positive().nullish(),
  parts: z.array(partLine).max(500).default([]),
  specialParts: z.array(specialLine).max(200).default([]),
  supplierIds: z.array(z.number().int().positive()).max(100).default([]),
})

export const preorderActionSchema = z.object({
  id: z.number().int().positive(),
  supplierId: z.number().int().positive(),
  action: z.enum(['accept', 'decline', 'waiting']),
  notes: z.string().trim().max(2000).nullish(),
})

export const preorderConvertSchema = z.object({
  id: z.number().int().positive(),
  supplierId: z.number().int().positive(),
})

export const rfqSchema = z.object({
  sourceQuoteId: z.number().int().positive().nullish(),
  report: z.string().max(20000).nullish(),
  priorityId: z.number().int().positive().nullish(),
  notes: z.string().max(20000).nullish(),
  supplierIds: z.array(z.number().int().positive()).min(1).max(100),
  lines: z.array(partLine).min(1).max(500),
})

export const rfqQuoteSchema = z.object({
  rfqId: z.number().int().positive(),
  expectedDelivery: dateString,
  notes: z.string().max(5000).nullish(),
  lines: z.array(z.object({
    rfqLineId: z.number().int().positive(),
    price: decimal,
    note: z.string().trim().max(500).nullish(),
  })).min(1).max(500),
})

export const rfqAwardSchema = z.object({
  rfqId: z.number().int().positive(),
  supplierQuoteId: z.number().int().positive(),
  lineIds: z.array(z.number().int().positive()).min(1).max(500),
})

export const supplierPortalListSchema = z.object({
  status: z.number().int().min(1).max(11).nullish(),
})
