import { createServerFn } from '@tanstack/react-start'
import { permissionMiddleware } from '../../../server/middleware'
import {
  createQuoteSchema,
  quoteIdSchema,
  quoteListSchema,
  saveQuoteSchema,
  searchSitesSchema,
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
