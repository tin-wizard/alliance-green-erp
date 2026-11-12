import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { permissionMiddleware } from '../../../server/middleware'

export const getComplianceOverviewFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => z.object({}).parse(input ?? {}))
  .middleware([permissionMiddleware('compliance:read')])
  .handler(async () => {
    const { getComplianceOverview } = await import('./compliance.server')
    return getComplianceOverview()
  })
