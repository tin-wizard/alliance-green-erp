import { createServerFn } from '@tanstack/react-start'
import { permissionMiddleware } from '../../../server/middleware'
import { listRateSchema, saveRatesSchema } from '../lib/masters.validation'

export const listTjxRatesFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => listRateSchema.parse(input))
  .middleware([permissionMiddleware('report.download_rates')])
  .handler(async ({ data }) => {
    const { listRates } = await import('./rates.server')
    const { getDb } = await import('@cls/db')
    return listRates(getDb(), data)
  })

export const saveTjxRatesFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => saveRatesSchema.parse(input))
  .middleware([
    permissionMiddleware('report.download_rates'),
    permissionMiddleware('tjx:write'),
  ])
  .handler(async ({ data, context }) => {
    const { saveRatesCore } = await import('./rates.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => saveRatesCore(tx, data, context.session))
  })
