import { createServerFn } from '@tanstack/react-start'
import {
  subInvoiceGateSchema,
  subInvoiceRejectSchema,
  subInvoiceReviewSchema,
  subInvoiceSaveSchema,
  subInvoiceTransitionSchema,
  subInvoiceWorkOrderSchema,
} from '../lib/quotes.validation'
import { authMiddleware, permissionMiddleware } from '../../../server/middleware'

export const getTjxSubInvoiceFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => subInvoiceWorkOrderSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { getOrCreateSubInvoiceCore } = await import('./subinvoices.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => getOrCreateSubInvoiceCore(tx, data.workOrderId, context.session))
  })

export const saveTjxSubInvoiceFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => subInvoiceSaveSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { saveSubInvoiceCore } = await import('./subinvoices.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => saveSubInvoiceCore(tx, data, context.session))
  })

export const setTjxSubInvoiceGateFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => subInvoiceGateSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { setSubInvoiceGateCore } = await import('./subinvoices.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => setSubInvoiceGateCore(tx, data, context.session))
  })

export const submitTjxSubInvoiceFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => subInvoiceTransitionSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { submitSubInvoiceCore } = await import('./subinvoices.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => submitSubInvoiceCore(tx, data, context.session))
  })

export const listTjxSubInvoicesFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { listSubInvoices } = await import('./subinvoices.server')
    const { getDb } = await import('@cls/db')
    return listSubInvoices(getDb(), context.session)
  })

export const listAssignedTjxWorkOrdersFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { listAssignedTjxWorkOrders } = await import('./subinvoices.server')
    const { getDb } = await import('@cls/db')
    return listAssignedTjxWorkOrders(getDb(), context.session)
  })

export const approveTjxSubInvoiceFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => subInvoiceReviewSchema.parse(input))
  .middleware([permissionMiddleware('tjx:read')])
  .handler(async ({ data, context }) => {
    const { approveSubInvoiceCore } = await import('./subinvoices.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => approveSubInvoiceCore(tx, data, context.session))
  })

export const rejectTjxSubInvoiceFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => subInvoiceRejectSchema.parse(input))
  .middleware([permissionMiddleware('tjx:read')])
  .handler(async ({ data, context }) => {
    const { rejectSubInvoiceCore } = await import('./subinvoices.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => rejectSubInvoiceCore(tx, data, context.session))
  })
