import { createServerFn } from '@tanstack/react-start'
import { permissionMiddleware } from '../../../server/middleware'

export const exportTjxPartsOnApprovalFn = createServerFn({ method: 'POST' })
  .middleware([permissionMiddleware('tjx:read')])
  .handler(async ({ context }) => {
    const { exportPartsOnApprovalCore } = await import('./exports.server')
    const { getDb } = await import('@cls/db')
    return exportPartsOnApprovalCore(getDb(), context.session)
  })
