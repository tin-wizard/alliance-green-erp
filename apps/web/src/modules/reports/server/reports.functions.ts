import { createServerFn } from '@tanstack/react-start'
import { permissionMiddleware } from '../../../server/middleware'
import { reportExportSchema, reportRequestSchema } from '../types'

export const runReportFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => reportRequestSchema.parse(input ?? {}))
  .middleware([permissionMiddleware('reports:read')])
  .handler(async ({ data }) => {
    const { runReport } = await import('./reports.server')
    return runReport(data)
  })

export const exportReportFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => reportExportSchema.parse(input))
  .middleware([permissionMiddleware('reports:read')])
  .handler(async ({ data, context }) => {
    const { exportReport } = await import('./reports.server')
    return exportReport(data, context.session.user.id)
  })
