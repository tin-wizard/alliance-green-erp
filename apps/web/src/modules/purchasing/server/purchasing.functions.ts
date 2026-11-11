import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { authMiddleware, permissionMiddleware } from '../../../server/middleware'
import {
  createPurchaseOrderSchema,
  updatePurchaseOrderSchema,
  transitionPurchaseOrderSchema,
  purchaseOrderIdSchema,
  listPurchaseOrdersSchema,
  receiptSchema,
  invoiceSchema,
  invoiceCloseSchema,
  preorderSchema,
  preorderActionSchema,
  preorderConvertSchema,
  rfqSchema,
  rfqQuoteSchema,
  rfqAwardSchema,
  supplierPortalListSchema,
} from '../lib/validation'
import type {
  PurchaseOrderCreateInput,
  PurchaseOrderInvoiceCloseInput,
  PurchaseOrderInvoiceInput,
  PurchaseOrderReceiptInput,
  PurchaseOrderTransitionInput,
  PurchaseOrderUpdateInput,
} from '../types'

export const listPurchaseOrdersFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => listPurchaseOrdersSchema.parse(input ?? {}))
  .middleware([permissionMiddleware('purchasing:read')])
  .handler(async ({ data, context }) => {
    const { listPurchaseOrders } = await import('./list.server')
    const { getDb } = await import('@cls/db')
    return listPurchaseOrders(context.session, data, getDb())
  })

export const getPurchaseOrderFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => purchaseOrderIdSchema.parse(input))
  .middleware([permissionMiddleware('purchasing:read')])
  .handler(async ({ data, context }) => {
    const { getPurchaseOrderDetail } = await import('./get.server')
    const { getDb } = await import('@cls/db')
    return getPurchaseOrderDetail(context.session, data.id, getDb())
  })

export const createPurchaseOrderFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => createPurchaseOrderSchema.parse(input))
  .middleware([permissionMiddleware('purchasing:write')])
  .handler(async ({ data, context }) => {
    const { createPurchaseOrder } = await import('./create.server')
    return createPurchaseOrder(data as PurchaseOrderCreateInput, context.session)
  })

export const updatePurchaseOrderFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => updatePurchaseOrderSchema.parse(input))
  .middleware([permissionMiddleware('purchasing:write')])
  .handler(async ({ data, context }) => {
    const { updatePurchaseOrder } = await import('./create.server')
    return updatePurchaseOrder(data as PurchaseOrderUpdateInput, context.session)
  })

export const transitionPurchaseOrderFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => transitionPurchaseOrderSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { transitionPurchaseOrder } = await import('./transition.server')
    return transitionPurchaseOrder(data as PurchaseOrderTransitionInput, context.session)
  })

export const receivePurchaseOrderFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => receiptSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { receivePurchaseOrder } = await import('./receipts.server')
    return receivePurchaseOrder(data as PurchaseOrderReceiptInput, context.session)
  })

export const createPurchaseOrderInvoiceFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => invoiceSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { createPurchaseOrderInvoice } = await import('./invoices.server')
    return createPurchaseOrderInvoice(data as PurchaseOrderInvoiceInput, context.session)
  })

export const closePurchaseOrderInvoiceFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => invoiceCloseSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { closePurchaseOrderInvoice } = await import('./invoices.server')
    return closePurchaseOrderInvoice(data as PurchaseOrderInvoiceCloseInput, context.session)
  })

export const createPreorderFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => preorderSchema.parse(input))
  .middleware([permissionMiddleware('purchasing:write')])
  .handler(async ({ data, context }) => {
    const { createPreorder } = await import('./sourcing.server')
    const { getDb } = await import('@cls/db')
    return createPreorder(data, context.session, getDb())
  })

export const respondToPreorderFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => preorderActionSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { respondToPreorder } = await import('./sourcing.server')
    const { getDb } = await import('@cls/db')
    return respondToPreorder(data, context.session, getDb())
  })

export const convertPreorderFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => preorderConvertSchema.parse(input))
  .middleware([permissionMiddleware('purchasing:write')])
  .handler(async ({ data, context }) => {
    const { convertPreorder } = await import('./sourcing.server')
    const { getDb } = await import('@cls/db')
    return convertPreorder(data, context.session, getDb())
  })

export const createRfqFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => rfqSchema.parse(input))
  .middleware([permissionMiddleware('purchasing:write')])
  .handler(async ({ data, context }) => {
    const { createRfq } = await import('./sourcing.server')
    const { getDb } = await import('@cls/db')
    return createRfq(data, context.session, getDb())
  })

export const listRfqsFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => z.object({}).parse(input ?? {}))
  .middleware([permissionMiddleware('purchasing:read')])
  .handler(async ({ context }) => {
    const { listRfqs } = await import('./sourcing.server')
    const { getDb } = await import('@cls/db')
    return listRfqs(context.session, getDb())
  })

export const submitSupplierQuoteFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => rfqQuoteSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { submitSupplierQuote } = await import('./sourcing.server')
    const { getDb } = await import('@cls/db')
    return submitSupplierQuote(data, context.session, getDb())
  })

export const awardRfqFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => rfqAwardSchema.parse(input))
  .middleware([permissionMiddleware('purchasing:write')])
  .handler(async ({ data, context }) => {
    const { awardRfq } = await import('./sourcing.server')
    const { getDb } = await import('@cls/db')
    return awardRfq(data, context.session, getDb())
  })

export const supplierPortalListFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => supplierPortalListSchema.parse(input ?? {}))
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { listSupplierPortal } = await import('./sourcing.server')
    const { getDb } = await import('@cls/db')
    return listSupplierPortal(context.session, getDb())
  })
