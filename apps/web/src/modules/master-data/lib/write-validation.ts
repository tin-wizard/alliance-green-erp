import { z } from 'zod'

/** Master Data write contracts. Shared by the form and the server. */

export const recordIdSchema = z
  .number()
  .int()
  .refine((value) => value !== 0, 'Id must be a non-zero integer.')

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value && value.length > 0 ? value : null))

const requiredName = z.string().trim().min(1, 'A name is required.').max(200)

const phone = z
  .string()
  .trim()
  .max(40)
  .nullish()
  .transform((value) => (value && value.length > 0 ? value : null))

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine((value) => value === '' || z.email().safeParse(value).success, 'Use a valid email.')
  .nullish()
  .transform((value) => (value && value.length > 0 ? value : null))

const province = z
  .string()
  .trim()
  .toUpperCase()
  .max(25)
  .nullish()
  .transform((value) => (value && value.length > 0 ? value : null))

const postal = z
  .string()
  .trim()
  .toUpperCase()
  .max(25)
  .nullish()
  .transform((value) => (value && value.length > 0 ? value : null))

const dateOnly = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')
  .refine((value) => !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime()), 'Use a real date.')

const money = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, 'Use a positive amount with at most 2 decimals.')
  .refine((value) => Number(value) <= 999_999.99, 'Amount is too large.')

const override = z
  .object({
    reason: z.string().trim().min(10, 'Give at least 10 characters of reason.').max(500),
  })
  .strict()
  .nullish()

export const customerWriteSchema = z
  .object({
    name: requiredName,
    street: optionalText(200),
    city: optionalText(100),
    province,
    postalCode: postal,
    contactName: optionalText(250),
    contactNumber: phone,
    contactEmail: email,
    salesperson: optionalText(100),
    isActive: z.boolean().default(true),
    duplicateOverride: override,
  })
  .strict()

export const customerCreateSchema = customerWriteSchema.extend({
  idempotencyKey: z.uuid(),
})

export const customerUpdateSchema = customerWriteSchema.extend({
  id: recordIdSchema,
  updatedAt: z.string().datetime(),
})

export const siteWriteSchema = z
  .object({
    billingParent: z.enum(['existing', 'orphan']),
    customerId: recordIdSchema.nullish(),
    name: requiredName,
    street: optionalText(200),
    street2: optionalText(200),
    city: optionalText(100),
    province,
    postalCode: postal,
    contactName: optionalText(200),
    contactNumber: phone,
    warranty: z.boolean().default(false),
    warrantyExpiresOn: dateOnly.nullish(),
    warrantyNotes: optionalText(4_000),
    notes: optionalText(4_000),
    dns: optionalText(100),
    lift: optionalText(100),
    mall: optionalText(100),
    isActive: z.boolean().default(true),
    duplicateOverride: override,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.billingParent === 'existing' && !value.customerId) {
      ctx.addIssue({ code: 'custom', path: ['customerId'], message: 'Choose the billing customer.' })
    }
    if (value.billingParent === 'orphan' && value.customerId) {
      ctx.addIssue({
        code: 'custom',
        path: ['customerId'],
        message: 'An orphan site cannot carry a billing customer.',
      })
    }
    if (!value.street && !value.city) {
      ctx.addIssue({ code: 'custom', path: ['street'], message: 'Enter a street or a city.' })
    }
    if (value.warranty && !value.warrantyExpiresOn) {
      ctx.addIssue({
        code: 'custom',
        path: ['warrantyExpiresOn'],
        message: 'A warranty needs an expiry date.',
      })
    }
  })

export const siteCreateSchema = siteWriteSchema.extend({
  idempotencyKey: z.uuid(),
})

export const siteUpdateSchema = siteWriteSchema.extend({
  id: recordIdSchema,
  updatedAt: z.string().datetime(),
})

const contactSchema = z
  .object({
    contactName: optionalText(250),
    phone: phone,
    phoneExt: optionalText(20),
    email,
  })
  .strict()

export const subcontractorWriteSchema = z
  .object({
    name: requiredName,
    street: optionalText(200),
    city: optionalText(100),
    province,
    postalCode: postal,
    contactName: optionalText(250),
    contactNumber: phone,
    contactEmail: email,
    email2: email,
    email3: email,
    rateInterior: money.nullish(),
    rateExterior: money.nullish(),
    rateOther: money.nullish(),
    isActive: z.boolean().default(true),
    contacts: z.array(contactSchema).max(10).default([]),
    duplicateOverride: override,
  })
  .strict()

export const subcontractorCreateSchema = subcontractorWriteSchema.extend({
  idempotencyKey: z.uuid(),
})

export const subcontractorUpdateSchema = subcontractorWriteSchema.extend({
  id: recordIdSchema,
  updatedAt: z.string().datetime(),
})

export const supplierWriteSchema = z
  .object({
    name: requiredName,
    address: optionalText(200),
    city: optionalText(100),
    province,
    postalCode: postal,
    contactPerson: optionalText(100),
    contactNumber: phone,
    additionalEmails: optionalText(2_000),
    additionalEmailsAccounting: optionalText(2_000),
    isUnderCls: z.boolean().default(false),
    isOnlineVendor: z.boolean().default(false),
    bypassPoApproval: z.boolean().default(false),
    poNotes: optionalText(4_000),
    isActive: z.boolean().default(true),
    contacts: z.array(contactSchema).max(10).default([]),
    duplicateOverride: override,
  })
  .strict()

export const supplierCreateSchema = supplierWriteSchema.extend({
  idempotencyKey: z.uuid(),
})

export const supplierUpdateSchema = supplierWriteSchema.extend({
  id: recordIdSchema,
  updatedAt: z.string().datetime(),
})

/**
 * Price fields are never part of a Master Data write. The check runs before
 * schema parsing so an attempted price edit gets a specific rejection rather
 * than a generic "unknown key".
 */
export const PRICE_FIELD_KEYS = [
  'cost',
  'sellPrice',
  'sell_price',
  'installPrice',
  'install_price',
  'recyclePrice',
  'recycle_price',
  'installCostPerUnit',
  'install_cost_per_unit',
  'lastCostPrice',
  'lastSellPrice',
  'oldSellPrice',
  'increasePercentage',
  'markup',
  'supplierRates',
  'supplier_rates',
  'sellingRates',
  'selling_rates',
  'priceHistory',
] as const

export function findPriceFields(value: unknown, path = ''): string[] {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findPriceFields(item, `${path}[${index}]`))
  }
  const found: string[] = []
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key
    if ((PRICE_FIELD_KEYS as readonly string[]).includes(key)) {
      found.push(childPath)
      continue
    }
    found.push(...findPriceFields(child, childPath))
  }
  return found
}

export const partWriteSchema = z
  .object({
    partNumber: z
      .string()
      .trim()
      .toUpperCase()
      .min(1, 'A part number is required.')
      .max(80)
      .regex(/^[A-Z0-9._/-]+$/, 'Use letters, numbers, dot, underscore, slash or dash.'),
    name: optionalText(300),
    partGroupId: z.number().int().positive().nullish(),
    parentPartNumber: optionalText(80),
    clsLinkedPartCode: optionalText(80),
    warranty: optionalText(75),
    labourWarranty: optionalText(75),
    installProfitFormula: optionalText(50),
    recycleProfitFormula: optionalText(50),
    notes: optionalText(4_000),
    subignore: z.boolean().default(false),
    duplicateOverride: override,
  })
  .strict()

export const partCreateSchema = partWriteSchema.extend({
  idempotencyKey: z.uuid(),
})

export const partUpdateSchema = partWriteSchema.extend({
  id: recordIdSchema,
  updatedAt: z.string().datetime(),
})

export const duplicateCheckSchema = z
  .object({
    entity: z.enum(['customer', 'site', 'subcontractor', 'supplier', 'part']),
    name: z.string().trim().max(300).optional(),
    partNumber: z.string().trim().max(80).optional(),
    city: z.string().trim().max(100).optional(),
    postalCode: z.string().trim().max(25).optional(),
    phone: z.string().trim().max(40).optional(),
    email: z.string().trim().max(254).optional(),
    customerId: recordIdSchema.nullish(),
    partGroupId: z.number().int().positive().nullish(),
    excludeId: recordIdSchema.nullish(),
  })
  .strict()

export const documentUploadSchema = z
  .object({
    subcontractorId: recordIdSchema,
    kind: z.enum(['wsib', 'insurance', 'other']),
    documentType: optionalText(100),
    documentName: optionalText(250),
    expiresOn: dateOnly.nullish(),
    replacesDocumentId: z.uuid().nullish(),
    fileName: z.string().trim().min(1).max(200),
    contentType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
    /** Base64 without a data: prefix. Capped by the decoded byte check. */
    data: z.string().min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.kind === 'wsib' || value.kind === 'insurance') && !value.expiresOn) {
      ctx.addIssue({ code: 'custom', path: ['expiresOn'], message: 'An expiry date is required.' })
    }
  })

export const documentIdSchema = z.object({ id: z.uuid() })

export const documentViewSchema = z.object({ id: z.uuid(), download: z.boolean().default(false) })

export const importRunSchema = z.object({
  apply: z.boolean().default(false),
  entities: z
    .array(z.enum(['customers', 'sites', 'subcontractors', 'suppliers', 'parts']))
    .min(1)
    .default(['customers', 'sites', 'subcontractors', 'suppliers', 'parts']),
})

export type CustomerCreateInput = z.infer<typeof customerCreateSchema>
export type CustomerUpdateInput = z.infer<typeof customerUpdateSchema>
export type SiteCreateInput = z.infer<typeof siteCreateSchema>
export type SiteUpdateInput = z.infer<typeof siteUpdateSchema>
export type SubcontractorCreateInput = z.infer<typeof subcontractorCreateSchema>
export type SubcontractorUpdateInput = z.infer<typeof subcontractorUpdateSchema>
export type SupplierCreateInput = z.infer<typeof supplierCreateSchema>
export type SupplierUpdateInput = z.infer<typeof supplierUpdateSchema>
export type PartCreateInput = z.infer<typeof partCreateSchema>
export type PartUpdateInput = z.infer<typeof partUpdateSchema>
export type DocumentUploadInput = z.infer<typeof documentUploadSchema>
export type DuplicateCheckInput = z.infer<typeof duplicateCheckSchema>
export type ImportRunInput = z.infer<typeof importRunSchema>
