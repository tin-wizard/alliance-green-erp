import { createServerFn } from '@tanstack/react-start'
import { permissionMiddleware } from '../../../server/middleware'
import {
  convertQuoteSchema,
  createQuoteSchema,
  documentIdSchema,
  linkWorkOrderSchema,
  quoteIdSchema,
  quoteListSchema,
  revisionSchema,
  saveQuoteSchema,
  searchSitesSchema,
  transitionSchema,
} from '../lib/quotes.validation'
import type { SiteLookupOption } from '../../work-orders/types'

export const listTjxQuotesFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => quoteListSchema.parse(input ?? {}))
  .middleware([permissionMiddleware('tjx:read')])
  .handler(async ({ data }) => {
    const { listQuotes } = await import('./quotes.server')
    const { getDb } = await import('@cls/db')
    return listQuotes(getDb(), data)
  })

export const getTjxQuoteFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => quoteIdSchema.parse(input))
  .middleware([permissionMiddleware('tjx:read')])
  .handler(async ({ data }) => {
    const { getQuoteDetail } = await import('./quotes.server')
    const { getDb } = await import('@cls/db')
    return getQuoteDetail(getDb(), data.id)
  })

export const createTjxQuoteFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => createQuoteSchema.parse(input))
  .middleware([permissionMiddleware('tjx:write')])
  .handler(async ({ data, context }) => {
    const { createQuoteCore } = await import('./quotes.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => createQuoteCore(tx, data, context.session))
  })

export const saveTjxQuoteFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => saveQuoteSchema.parse(input))
  .middleware([permissionMiddleware('tjx:write')])
  .handler(async ({ data, context }) => {
    const { warnUnknownSalesProvince } = await import('../../../server/province.server')
    warnUnknownSalesProvince(data.taxProvince, 'tjx.quote.save')
    const { saveQuoteCore } = await import('./quotes.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => saveQuoteCore(tx, data, context.session))
  })

export const searchTjxSitesFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => searchSitesSchema.parse(input ?? {}))
  .middleware([permissionMiddleware('tjx:read')])
  .handler(async ({ data }): Promise<SiteLookupOption[]> => {
    const { searchSites } = await import('../../work-orders/lib/lookups')
    return searchSites(data.search ?? '', data.limit)
  })

export const submitTjxQuoteFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => transitionSchema.parse(input))
  .middleware([permissionMiddleware('tjx:write')])
  .handler(async ({ data, context }) => {
    const { submitQuoteCore } = await import('./lifecycle.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => submitQuoteCore(tx, data, context.session))
  })

export const returnTjxQuoteFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => transitionSchema.parse(input))
  .middleware([permissionMiddleware('tjx:write')])
  .handler(async ({ data, context }) => {
    const { returnQuoteCore } = await import('./lifecycle.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => returnQuoteCore(tx, data, context.session))
  })

export const approveTjxQuoteFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => transitionSchema.parse(input))
  .middleware([permissionMiddleware('quote:approve'), permissionMiddleware('tjx:write')])
  .handler(async ({ data, context }) => {
    const { approveQuoteCore } = await import('./lifecycle.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => approveQuoteCore(tx, data, context.session))
  })

export const cancelTjxQuoteFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => transitionSchema.parse(input))
  .middleware([permissionMiddleware('tjx:write')])
  .handler(async ({ data, context }) => {
    const { cancelQuoteCore } = await import('./lifecycle.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => cancelQuoteCore(tx, data, context.session))
  })

export const saveTjxRevisionFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => revisionSchema.parse(input))
  .middleware([permissionMiddleware('tjx:write')])
  .handler(async ({ data, context }) => {
    const { saveRevisionCore } = await import('./lifecycle.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) =>
      saveRevisionCore(tx, { ...data, notes: data.notes ?? null }, context.session),
    )
  })

export const renderTjxQuotePdfFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => quoteIdSchema.parse(input))
  .middleware([permissionMiddleware('tjx:read')])
  .handler(async ({ data, context }) => {
    const { renderTjxDocument } = await import('./pdf.server')
    return renderTjxDocument(data.id, context.session, 'tjx-quote')
  })

export const renderTjxOrderSheetFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => quoteIdSchema.parse(input))
  .middleware([permissionMiddleware('tjx:read')])
  .handler(async ({ data, context }) => {
    const { renderTjxDocument } = await import('./pdf.server')
    return renderTjxDocument(data.id, context.session, 'tjx-order-sheet')
  })

export const listTjxDocumentsFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => quoteIdSchema.parse(input))
  .middleware([permissionMiddleware('tjx:read')])
  .handler(async ({ data, context }) => {
    const { listTjxDocuments } = await import('./pdf.server')
    return listTjxDocuments(data.id, context.session)
  })

export const regenerateTjxDocumentFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => documentIdSchema.parse(input))
  .middleware([permissionMiddleware('tjx:read')])
  .handler(async ({ data, context }) => {
    const { regenerateTjxDocument } = await import('./pdf.server')
    return regenerateTjxDocument(data.documentId, context.session)
  })

export const listTjxWorkOrderLookupsFn = createServerFn({ method: 'GET' })
  .middleware([permissionMiddleware('tjx:read')])
  .handler(async () => {
    const { listWorkOrderLookups } = await import('./workorders.server')
    const { getDb } = await import('@cls/db')
    return listWorkOrderLookups(getDb())
  })

export const convertTjxQuoteFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => convertQuoteSchema.parse(input))
  .middleware([permissionMiddleware('tjx:write')])
  .handler(async ({ data, context }) => {
    const { convertQuoteCore } = await import('./workorders.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => convertQuoteCore(tx, data, context.session))
  })

export const linkTjxWorkOrderFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => linkWorkOrderSchema.parse(input))
  .middleware([permissionMiddleware('tjx:write')])
  .handler(async ({ data, context }) => {
    const { linkWorkOrderCore } = await import('./workorders.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => linkWorkOrderCore(tx, data, context.session))
  })

export const unlinkTjxWorkOrderFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => linkWorkOrderSchema.parse(input))
  .middleware([permissionMiddleware('tjx:write')])
  .handler(async ({ data, context }) => {
    const { unlinkWorkOrderCore } = await import('./workorders.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => unlinkWorkOrderCore(tx, data, context.session))
  })
