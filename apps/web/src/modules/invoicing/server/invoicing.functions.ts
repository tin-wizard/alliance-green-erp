import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { authMiddleware, permissionMiddleware } from '../../../server/middleware'
import {
  approveSubcontractorInvoiceSchema,
  createInvoiceSchema,
  documentIdSchema,
  invoiceIdSchema,
  issueInvoiceSchema,
  previewInvoiceSchema,
  recordPaymentSchema,
  recordSubcontractorPaymentSchema,
  rejectInvoiceSchema,
  rejectSubcontractorInvoiceSchema,
  resubmitInvoiceSchema,
  saveInvoiceSchema,
  submitSubcontractorInvoiceSchema,
} from '../lib/validation'

export const listInvoicesFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) =>
    z
      .object({
        status: z.string().optional(),
        search: z.string().optional(),
        limit: z.number().int().positive().max(200).optional(),
      })
      .parse(input ?? {}),
  )
  .middleware([permissionMiddleware('invoice:read')])
  .handler(async ({ data, context }) => {
    const { listInvoices } = await import('./get.server')
    const { getDb } = await import('@cls/db')
    return listInvoices(context.session, data, getDb())
  })

export const getInvoiceFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => invoiceIdSchema.parse(input))
  .middleware([permissionMiddleware('invoice:read')])
  .handler(async ({ data, context }) => {
    const { getInvoiceDetail } = await import('./get.server')
    const { getDb } = await import('@cls/db')
    return getInvoiceDetail(context.session, data.invoiceId, getDb())
  })

export const findInvoiceForWorkOrderFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => z.object({ workOrderId: z.number().int().positive() }).parse(input))
  .middleware([permissionMiddleware('invoice:read')])
  .handler(async ({ data, context }) => {
    const { findInvoiceForWorkOrder } = await import('./get.server')
    const { getDb } = await import('@cls/db')
    return findInvoiceForWorkOrder(context.session, data.workOrderId, getDb())
  })

/** Preview totals are the calculator; D13 keeps it admin-only. */
export const previewInvoiceFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => previewInvoiceSchema.parse(input))
  .middleware([permissionMiddleware('invoice.calculate')])
  .handler(async ({ data }) => {
    const { previewInvoiceTotals } = await import('../lib/money')
    return previewInvoiceTotals(data as never)
  })

export const createInvoiceFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => createInvoiceSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { createInvoiceFromSnapshotCore } = await import('./sales.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => createInvoiceFromSnapshotCore(tx, data, context.session))
  })

export const saveInvoiceFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => saveInvoiceSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { saveInvoiceDraftCore } = await import('./sales.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => saveInvoiceDraftCore(tx, data as never, context.session))
  })

export const issueInvoiceFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => issueInvoiceSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { issueInvoiceCore } = await import('./sales.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => issueInvoiceCore(tx, data, context.session))
  })

export const rejectInvoiceFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => rejectInvoiceSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { rejectInvoiceCore } = await import('./sales.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => rejectInvoiceCore(tx, data, context.session))
  })

export const resubmitInvoiceFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => resubmitInvoiceSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { resubmitInvoiceCore } = await import('./sales.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => resubmitInvoiceCore(tx, data, context.session))
  })

export const recordInvoicePaymentFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => recordPaymentSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { recordInvoicePaymentCore } = await import('./sales.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => recordInvoicePaymentCore(tx, data as never, context.session))
  })

export const regenerateInvoiceDocumentFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => documentIdSchema.parse(input))
  .middleware([permissionMiddleware('invoice:read')])
  .handler(async ({ data, context }) => {
    const { regenerateInvoiceDocument } = await import('./pdf.server')
    return regenerateInvoiceDocument(data.documentId, context.session)
  })

export const processSagePostingFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => z.object({ postingId: z.number().int().positive() }).parse(input))
  .middleware([permissionMiddleware('invoice.post_sage')])
  .handler(async ({ data, context }) => {
    const { processSagePostingCore } = await import('./posting.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => processSagePostingCore(tx, data.postingId, context.session))
  })

export const listSubcontractorInvoicesFn = createServerFn({ method: 'GET' })
  .middleware([permissionMiddleware('invoice:read')])
  .handler(async ({ context }) => {
    const { listSubcontractorInvoices } = await import('./subcontractor.server')
    return listSubcontractorInvoices(context.session, (await import('@cls/db')).getDb())
  })

export const getSubcontractorInvoiceFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => invoiceIdSchema.parse(input))
  .middleware([permissionMiddleware('invoice:read')])
  .handler(async ({ data, context }) => {
    const { getSubcontractorInvoiceDetail } = await import('./subcontractor.server')
    return getSubcontractorInvoiceDetail(context.session, data.invoiceId, (await import('@cls/db')).getDb())
  })

export const submitSubcontractorInvoiceFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => submitSubcontractorInvoiceSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { createSubcontractorInvoiceCore } = await import('./subcontractor.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) =>
      createSubcontractorInvoiceCore(tx, data as never, context.session),
    )
  })

export const approveSubcontractorInvoiceFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => approveSubcontractorInvoiceSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { approveSubcontractorInvoiceCore } = await import('./subcontractor.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) =>
      approveSubcontractorInvoiceCore(tx, data, context.session),
    )
  })

export const rejectSubcontractorInvoiceFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => rejectSubcontractorInvoiceSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { rejectSubcontractorInvoiceCore } = await import('./subcontractor.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => rejectSubcontractorInvoiceCore(tx, data, context.session))
  })

export const recordSubcontractorPaymentFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => recordSubcontractorPaymentSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { recordSubcontractorPaymentCore } = await import('./subcontractor.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) =>
      recordSubcontractorPaymentCore(tx, data as never, context.session),
    )
  })
