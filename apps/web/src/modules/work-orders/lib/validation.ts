/**
 * Request validation for the module's server functions.
 *
 * CLIENT SAFE. Every `.functions.ts` wrapper parses its input with one of these
 * before the handler runs. The server re-validates business preconditions;
 * these schemas only reject malformed shapes.
 */
import { z } from 'zod'

export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in YYYY-MM-DD form.')

export const optionalDate = dateString.nullish()

export const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d{1,2})?$/, 'Use a number with at most 2 decimal places.')

export const positiveInt = z.number().int().positive()
export const nonNegativeInt = z.number().int().min(0)

const base64 = z
  .string()
  .min(1, 'The file is empty.')
  .max(24_000_000, 'Files are limited to 18 MB.')

export const workOrderStatusCodeSchema = z.number().int().min(1).max(12)
export const seriesSchema = z.union([z.literal(1), z.literal(2)])
export const triageFlagSchema = z.enum(['red', 'green', 'critical'])

export const savedViewSchema = z.enum([
  'open',
  'overdue',
  'awaiting_approval',
  'scheduled',
  'completed',
  'invoiced',
  'cancelled',
  'undispatched',
  'missing_wsib',
  'all',
])

export const listFiltersSchema = z.object({
  view: savedViewSchema.default('open'),
  search: z.string().trim().max(100).optional(),
  series: seriesSchema.optional(),
  status: workOrderStatusCodeSchema.optional(),
  priorityId: z.number().int().min(1).max(20).optional(),
  subcontractorId: positiveInt.optional(),
  siteId: positiveInt.optional(),
  sort: z.enum(['newest', 'oldest', 'expected', 'number']).default('newest'),
  pageSize: z.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
})

export const createWorkOrderSchema = z.object({
  series: seriesSchema.default(1),
  siteId: positiveInt,
  serviceTypeId: z.number().int().min(1).max(99),
  priorityId: z.number().int().min(1).max(20),
  categoryId: z.number().int().min(1).max(99).nullish(),
  expectedCompletion: optionalDate,
  serviceRequired: z.string().trim().min(3).max(4000),
  notes: z.string().trim().max(8000).nullish(),
  subcontractorId: positiveInt.nullish(),
  securityCode: z.string().trim().max(100).nullish(),
  customerPo: z.string().trim().max(100).nullish(),
  isLocal: z.boolean().default(false),
  isProject: z.boolean().default(false),
  isTjxQuote: z.boolean().default(false),
  isPmaOrder: z.boolean().default(false),
  dateTaken: optionalDate,
  wsibOverride: z.boolean().default(false),
})

export const updateWorkOrderSchema = z.object({
  id: positiveInt,
  version: z.number().int().min(1),
  siteId: positiveInt.optional(),
  serviceTypeId: z.number().int().min(1).max(99).optional(),
  priorityId: z.number().int().min(1).max(20).optional(),
  categoryId: z.number().int().min(1).max(99).nullish(),
  expectedCompletion: optionalDate,
  serviceRequired: z.string().trim().min(3).max(4000).optional(),
  notes: z.string().trim().max(8000).nullish(),
  subcontractorId: positiveInt.nullish(),
  securityCode: z.string().trim().max(100).nullish(),
  customerPo: z.string().trim().max(100).nullish(),
  isLocal: z.boolean().optional(),
  isProject: z.boolean().optional(),
  isTjxQuote: z.boolean().optional(),
  isPmaOrder: z.boolean().optional(),
  dateTaken: dateString.optional(),
  wsibOverride: z.boolean().default(false),
})

export const transitionSchema = z.object({
  id: positiveInt,
  version: z.number().int().min(1),
  to: workOrderStatusCodeSchema,
  note: z.string().trim().max(2000).nullish(),
  subcontractorId: positiveInt.nullish(),
  wsibOverride: z.boolean().default(false),
})

export const captureHoursSchema = z.object({
  workOrderId: positiveInt,
  lines: z
    .array(
      z.object({
        lineDate: dateString,
        hours: decimalString,
        rateCode: z.number().int().min(1).max(3).default(1),
        hourlyRate: decimalString,
        techUserId: z.string().uuid().nullish(),
        note: z.string().trim().max(1000).nullish(),
      }),
    )
    .min(1, 'Enter at least one labour line.')
    .max(200),
})

export const capturePartsSchema = z.object({
  workOrderId: positiveInt,
  lines: z
    .array(
      z.object({
        partNo: z.string().trim().min(1).max(50),
        description: z.string().trim().max(1000).nullish(),
        qty: decimalString,
        price: decimalString,
      }),
    )
    .min(1)
    .max(200),
})

export const captureSpecialPartsSchema = z.object({
  workOrderId: positiveInt,
  lines: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(250),
        qty: decimalString,
        price: decimalString,
        isEmergencyLighting: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(200),
})

export const captureReportSchema = z.object({
  workOrderId: positiveInt,
  report: z.string().max(20_000),
})

export const captureLocalHoursSchema = z.object({
  workOrderId: positiveInt,
  lines: z
    .array(
      z.object({
        lineDate: dateString,
        timeIn: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullish(),
        timeOut: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullish(),
        hours: decimalString,
        headcount: z.number().int().min(1).max(50),
        techUserId: z.string().uuid().nullish(),
      }),
    )
    .min(1)
    .max(100),
})

export const signatureSchema = z.object({
  workOrderId: positiveInt,
  signerName: z.string().trim().min(2).max(100),
  note: z.string().trim().max(500).nullish(),
  dataBase64: base64,
  contentType: z.enum(['image/png', 'image/jpeg', 'image/svg+xml']),
})

export const documentUploadSchema = z.object({
  workOrderId: positiveInt,
  kind: z.enum(['photo', 'document', 'service_report', 'other']),
  filename: z.string().trim().min(1).max(200),
  contentType: z.string().trim().min(3).max(120),
  caption: z.string().trim().max(500).nullish(),
  dataBase64: base64,
})

export const triageSchema = z.object({
  id: positiveInt,
  version: z.number().int().min(1),
  flags: z.array(triageFlagSchema).max(3),
})

export const bulkUpdateSchema = z.object({
  ids: z.array(positiveInt).min(1).max(100),
  change: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('priority'), priorityId: z.number().int().min(1).max(20) }),
    z.object({
      kind: z.literal('assign_subcontractor'),
      subcontractorId: positiveInt.nullable(),
      wsibOverride: z.boolean().default(false),
    }),
    z.object({
      kind: z.literal('status'),
      to: workOrderStatusCodeSchema,
      note: z.string().trim().max(2000).nullish(),
    }),
  ]),
})

export const workOrderIdSchema = z.object({ id: positiveInt })

export const addNoteSchema = z.object({
  workOrderId: positiveInt,
  notes: z.string().trim().min(1).max(8000),
  isPublic: z.boolean().default(false),
})

export const documentRefSchema = z.object({
  workOrderId: positiveInt,
  documentId: z.string().uuid(),
})

export const revisionIdSchema = z.object({
  workOrderId: positiveInt,
  revisionId: z.number().int().positive(),
})

export const lookupSitesSchema = z.object({
  search: z.string().trim().max(100).default(''),
  limit: z.number().int().min(1).max(50).default(20),
})

export const lookupSubcontractorsSchema = lookupSitesSchema

export const lookupPartsSchema = z.object({
  search: z.string().trim().max(100).default(''),
  limit: z.number().int().min(1).max(50).default(20),
})

export const emptySchema = z.object({}).default({})
