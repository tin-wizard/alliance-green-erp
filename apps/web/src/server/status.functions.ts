import { createServerFn } from '@tanstack/react-start'
import type { HealthReport } from './health.types'
import { authMiddleware } from './middleware'

/** Auth-protected system status for the dashboard. */
export const getSystemStatusFn = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async (): Promise<HealthReport> => {
    const { buildHealthReport } = await import('./health.server')
    return buildHealthReport()
  })
