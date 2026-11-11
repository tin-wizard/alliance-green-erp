import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { authMiddleware, permissionMiddleware } from '../../../server/middleware'
import {
  adjustmentSchema,
  markMessageReadSchema,
  movementReportSchema,
  partPriceEditorSchema,
  priceLockSchema,
  savePricesSchema,
  sendSubStockMessageSchema,
  stockListSchema,
  subStockListSchema,
  subStockSubscriptionSchema,
} from '../lib/validation'

export const listStockFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => stockListSchema.parse(input ?? {}))
  .middleware([permissionMiddleware('inventory:read')])
  .handler(async ({ data, context }) => {
    const { listStockParts } = await import('./reports.server')
    const { getDb } = await import('@cls/db')
    return listStockParts(context.session, data, getDb())
  })

export const movementReportFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => movementReportSchema.parse(input ?? {}))
  .middleware([permissionMiddleware('inventory:read')])
  .handler(async ({ data, context }) => {
    const { movementReport } = await import('./reports.server')
    const { getDb } = await import('@cls/db')
    return movementReport(context.session, data, getDb())
  })

export const stockDisagreementsFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => z.object({}).parse(input ?? {}))
  .middleware([permissionMiddleware('inventory:read')])
  .handler(async ({ context }) => {
    const { stockCounterDisagreements } = await import('./reports.server')
    const { getDb } = await import('@cls/db')
    return stockCounterDisagreements(context.session, getDb())
  })

export const partPriceHistoryFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => partPriceEditorSchema.parse(input))
  .middleware([permissionMiddleware('inventory:read')])
  .handler(async ({ data, context }) => {
    const { partPriceHistory } = await import('./reports.server')
    const { getDb } = await import('@cls/db')
    return partPriceHistory(context.session, data.partId, getDb())
  })

export const adjustStockFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => adjustmentSchema.parse(input))
  .middleware([permissionMiddleware('inventory:adjust')])
  .handler(async ({ data, context }) => {
    const { adjustPartStockCore } = await import('./stock.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => adjustPartStockCore(tx, data, context.session))
  })

export const getPriceLockStateFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => z.object({}).parse(input ?? {}))
  .middleware([permissionMiddleware('inventory:read')])
  .handler(async ({ context }) => {
    const { getPriceLockState } = await import('./price.server')
    const { getDb } = await import('@cls/db')
    return getPriceLockState(context.session, getDb())
  })

export const acquirePriceLockFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => priceLockSchema.parse(input ?? {}))
  .middleware([permissionMiddleware('inventory:edit_price')])
  .handler(async ({ data, context }) => {
    const { acquirePriceLockCore } = await import('./price.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => acquirePriceLockCore(tx, context.session, data))
  })

export const refreshPriceLockFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => z.object({}).parse(input ?? {}))
  .middleware([permissionMiddleware('inventory:edit_price')])
  .handler(async ({ context }) => {
    const { refreshPriceLockCore } = await import('./price.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => refreshPriceLockCore(tx, context.session))
  })

export const releasePriceLockFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => z.object({}).parse(input ?? {}))
  .middleware([permissionMiddleware('inventory:edit_price')])
  .handler(async ({ context }) => {
    const { releasePriceLockCore } = await import('./price.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => releasePriceLockCore(tx, context.session))
  })

export const searchPricePartsFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) =>
    z.object({ search: z.string().trim().max(100).default('') }).parse(input ?? {}),
  )
  .middleware([permissionMiddleware('inventory:read')])
  .handler(async ({ data, context }) => {
    const { searchPriceParts } = await import('./price.server')
    const { getDb } = await import('@cls/db')
    return searchPriceParts(context.session, data, getDb())
  })

export const getPartPriceEditorFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => partPriceEditorSchema.parse(input))
  .middleware([permissionMiddleware('inventory:read')])
  .handler(async ({ data, context }) => {
    const { getPartPriceEditor } = await import('./price.server')
    const { getDb } = await import('@cls/db')
    return getPartPriceEditor(context.session, data.partId, getDb())
  })

export const savePricesFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => savePricesSchema.parse(input))
  .middleware([permissionMiddleware('inventory:edit_price')])
  .handler(async ({ data, context }) => {
    const { savePartPricesCore } = await import('./price.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => savePartPricesCore(tx, data, context.session))
  })

export const listSubStockFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => subStockListSchema.parse(input ?? {}))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { listSubStockPortal } = await import('./substock.server')
    const { getDb } = await import('@cls/db')
    return listSubStockPortal(context.session, data, getDb())
  })

export const markSubStockMessageReadFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => markMessageReadSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { markSubStockMessageReadCore } = await import('./substock.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => markSubStockMessageReadCore(tx, data, context.session))
  })

export const setSubStockSubscriptionFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => subStockSubscriptionSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { setSubStockSubscriptionCore } = await import('./substock.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => setSubStockSubscriptionCore(tx, data, context.session))
  })

export const sendSubStockMessageFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => sendSubStockMessageSchema.parse(input))
  .middleware([permissionMiddleware('inventory:adjust')])
  .handler(async ({ data, context }) => {
    const { sendSubStockMessageCore } = await import('./substock.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => sendSubStockMessageCore(tx, data, context.session))
  })
