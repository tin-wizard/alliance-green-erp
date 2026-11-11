/**
 * Work Orders server functions — the data boundary.
 *
 * CLIENT SAFE: server-only work is imported inside each handler, never at module
 * scope, so `@cls/db` and `packages/storage` never enter the browser bundle.
 * Every function declares `authMiddleware` or `permissionMiddleware`, and the
 * scoping checks live in `*.server.ts`.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { permissionMiddleware } from '../../../server/middleware'
import type {
  BulkUpdateInput,
  BulkUpdateResult,
  CaptureHoursInput,
  CaptureLocalHoursInput,
  CapturePartsInput,
  CaptureReportInput,
  CaptureSpecialPartsInput,
  DocumentUploadInput,
  InvoiceReadySnapshot,
  LookupOption,
  PartLookupOption,
  SiteLookupOption,
  SignatureInput,
  SubcontractorLookupOption,
  TechnicianLookupOption,
  TriageInput,
  WorkOrderCreateInput,
  WorkOrderDetail,
  WorkOrderListFilters,
  WorkOrderListResult,
  WorkOrderRevisionDetail,
  WorkOrderTransitionInput,
  WorkOrderUpdateInput,
  WorkOrderViewCounts,
} from '../types'
import {
  addNoteSchema,
  bulkUpdateSchema,
  captureHoursSchema,
  captureLocalHoursSchema,
  capturePartsSchema,
  captureReportSchema,
  captureSpecialPartsSchema,
  createWorkOrderSchema,
  documentRefSchema,
  documentUploadSchema,
  listFiltersSchema,
  lookupPartsSchema,
  lookupSitesSchema,
  lookupSubcontractorsSchema,
  revisionIdSchema,
  signatureSchema,
  transitionSchema,
  triageSchema,
  updateWorkOrderSchema,
  workOrderIdSchema,
} from '../lib/validation'
import { authMiddleware } from '../../../server/middleware'

/* ------------------------------- reads ------------------------------- */

export const listWorkOrdersFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => listFiltersSchema.parse(input ?? {}))
  .middleware([permissionMiddleware('workorder:read')])
  .handler(async ({ data, context }): Promise<WorkOrderListResult> => {
    const { queryWorkOrders } = await import('./list.server')
    const { resolveScope } = await import('./access.server')
    return queryWorkOrders(data as WorkOrderListFilters, resolveScope(context.session))
  })

export const getWorkOrderViewCountsFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => z.object({ series: z.union([z.literal(1), z.literal(2)]).optional() }).parse(input ?? {}))
  .middleware([permissionMiddleware('workorder:read')])
  .handler(async ({ data, context }): Promise<WorkOrderViewCounts> => {
    const { queryViewCounts } = await import('./list.server')
    const { resolveScope } = await import('./access.server')
    return queryViewCounts(resolveScope(context.session), data.series)
  })

export const getWorkOrderFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => workOrderIdSchema.parse(input))
  .middleware([permissionMiddleware('workorder:read')])
  .handler(async ({ data, context }): Promise<WorkOrderDetail> => {
    const { getWorkOrderDetail } = await import('./get.server')
    return getWorkOrderDetail(context.session, data.id)
  })

export const getRevisionFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => revisionIdSchema.parse(input))
  .middleware([permissionMiddleware('workorder:read')])
  .handler(async ({ data, context }): Promise<WorkOrderRevisionDetail | null> => {
    const { getRevision } = await import('./records.server')
    const { loadAccessibleWorkOrder } = await import('./access.server')
    await loadAccessibleWorkOrder(context.session, data.workOrderId)
    return getRevision(data.workOrderId, data.revisionId, (await import('@cls/db')).getDb())
  })

export const getInvoiceReadySnapshotFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => workOrderIdSchema.parse(input))
  .middleware([permissionMiddleware('workorder:read')])
  .handler(async ({ data, context }): Promise<InvoiceReadySnapshot> => {
    const { buildInvoiceReadySnapshot } = await import('./snapshot.server')
    return buildInvoiceReadySnapshot(context.session, data.id)
  })

/* ------------------------------ lookups ------------------------------ */

export const searchSitesFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => lookupSitesSchema.parse(input ?? {}))
  .middleware([permissionMiddleware('workorder:read')])
  .handler(async ({ data }): Promise<SiteLookupOption[]> => {
    const { searchSites } = await import('../lib/lookups')
    return searchSites(data.search, data.limit)
  })

export const searchSubcontractorsFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => lookupSubcontractorsSchema.parse(input ?? {}))
  .middleware([permissionMiddleware('workorder:read')])
  .handler(async ({ data }): Promise<SubcontractorLookupOption[]> => {
    const { searchSubcontractors } = await import('../lib/lookups')
    return searchSubcontractors(data.search, data.limit)
  })

export const searchPartsFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => lookupPartsSchema.parse(input ?? {}))
  .middleware([permissionMiddleware('workorder:read')])
  .handler(async ({ data }): Promise<PartLookupOption[]> => {
    const { partsLookup } = await import('../lib/lookups')
    return partsLookup(data.search, data.limit)
  })

export const listLookupsFn = createServerFn({ method: 'GET' })
  .middleware([permissionMiddleware('workorder:read')])
  .handler(
    async (): Promise<{
      serviceTypes: LookupOption[]
      priorities: LookupOption[]
      categories: LookupOption[]
      technicians: TechnicianLookupOption[]
    }> => {
      const lookups = await import('../lib/lookups')
      const [serviceTypes, priorities, categories, technicians] = await Promise.all([
        lookups.listServiceTypes(),
        lookups.listPriorities(),
        lookups.listCategories(),
        lookups.listTechnicians(),
      ])
      return { serviceTypes, priorities, categories, technicians }
    },
  )

/* ------------------------------ writes ------------------------------- */

export const createWorkOrderFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => createWorkOrderSchema.parse(input))
  .middleware([permissionMiddleware('workorder:create')])
  .handler(async ({ data, context }) => {
    const { createWorkOrder } = await import('./create.server')
    return createWorkOrder(data as WorkOrderCreateInput, context.session)
  })

export const updateWorkOrderFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => updateWorkOrderSchema.parse(input))
  .middleware([permissionMiddleware('workorder:write')])
  .handler(async ({ data, context }) => {
    const { updateWorkOrder } = await import('./update.server')
    return updateWorkOrder(data as WorkOrderUpdateInput, context.session)
  })

export const transitionWorkOrderFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => transitionSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { transitionWorkOrder } = await import('./transition.server')
    return transitionWorkOrder(data as WorkOrderTransitionInput, context.session)
  })

export const captureHoursFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => captureHoursSchema.parse(input))
  .middleware([permissionMiddleware('workorder:capture')])
  .handler(async ({ data, context }) => {
    const { captureHours } = await import('./capture.server')
    return captureHours(data as CaptureHoursInput, context.session)
  })

export const capturePartsFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => capturePartsSchema.parse(input))
  .middleware([permissionMiddleware('workorder:capture')])
  .handler(async ({ data, context }) => {
    const { captureParts } = await import('./capture.server')
    return captureParts(data as CapturePartsInput, context.session)
  })

export const captureSpecialPartsFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => captureSpecialPartsSchema.parse(input))
  .middleware([permissionMiddleware('workorder:capture')])
  .handler(async ({ data, context }) => {
    const { captureSpecialParts } = await import('./capture.server')
    return captureSpecialParts(data as CaptureSpecialPartsInput, context.session)
  })

export const captureReportFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => captureReportSchema.parse(input))
  .middleware([permissionMiddleware('workorder:capture')])
  .handler(async ({ data, context }) => {
    const { captureReport } = await import('./capture.server')
    return captureReport(data as CaptureReportInput, context.session)
  })

export const captureLocalHoursFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => captureLocalHoursSchema.parse(input))
  .middleware([permissionMiddleware('workorder:capture')])
  .handler(async ({ data, context }) => {
    const { captureLocalHours } = await import('./capture.server')
    return captureLocalHours(data as CaptureLocalHoursInput, context.session)
  })

export const addNoteFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => addNoteSchema.parse(input))
  .middleware([permissionMiddleware('workorder:write')])
  .handler(async ({ data, context }) => {
    const { addNote } = await import('./capture.server')
    return addNote(data, context.session)
  })

export const uploadDocumentFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => documentUploadSchema.parse(input))
  .middleware([permissionMiddleware('workorder:capture')])
  .handler(async ({ data, context }) => {
    const { runUploadDocument } = await import('./documents.server')
    return runUploadDocument(data as DocumentUploadInput, context.session)
  })

export const captureSignatureFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => signatureSchema.parse(input))
  .middleware([permissionMiddleware('workorder:capture')])
  .handler(async ({ data, context }) => {
    const { runCaptureSignature } = await import('./documents.server')
    return runCaptureSignature(data as SignatureInput, context.session)
  })

export const downloadDocumentFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => documentRefSchema.parse(input))
  .middleware([permissionMiddleware('workorder:read')])
  .handler(async ({ data, context }) => {
    const { downloadDocument } = await import('./documents.server')
    return downloadDocument(data, context.session)
  })

export const deleteDocumentFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => documentRefSchema.parse(input))
  .middleware([permissionMiddleware('workorder:capture')])
  .handler(async ({ data, context }) => {
    const { deleteDocument } = await import('./documents.server')
    return deleteDocument(data, context.session)
  })

export const setTriageFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => triageSchema.parse(input))
  .middleware([permissionMiddleware('workorder:write')])
  .handler(async ({ data, context }) => {
    const { setTriage } = await import('./bulk.server')
    return setTriage(data as TriageInput, context.session)
  })

export const bulkUpdateFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => bulkUpdateSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<BulkUpdateResult> => {
    const { bulkUpdate } = await import('./bulk.server')
    return bulkUpdate(data as BulkUpdateInput, context.session)
  })

export const saveRevisionFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => workOrderIdSchema.parse(input))
  .middleware([permissionMiddleware('workorder:write')])
  .handler(async ({ data, context }) => {
    const { saveManualRevision } = await import('./records.server')
    return saveManualRevision({ workOrderId: data.id }, context.session)
  })

export const queueReminderFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => workOrderIdSchema.parse(input))
  .middleware([permissionMiddleware('workorder:write')])
  .handler(async ({ data, context }) => {
    const { queueReminder } = await import('./notifications.server')
    return queueReminder(data.id, context.session)
  })
