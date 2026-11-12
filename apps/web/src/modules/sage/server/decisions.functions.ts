import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getDb } from '@cls/db'
import { permissionMiddleware } from '../../../server/middleware'

export const listReconciliationFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => z.object({}).parse(input ?? {}))
  .middleware([permissionMiddleware('sage:read')])
  .handler(async () => {
    const { listReconciliation } = await import('./decisions.server')
    return listReconciliation(getDb())
  })

export const decideFindingFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) =>
    z
      .object({
        findingId: z.number().int().positive(),
        decision: z.enum(['accepted', 'fixed_externally', 'excluded']),
        note: z.string().trim().min(3).max(500),
      })
      .parse(input),
  )
  .middleware([permissionMiddleware('sage:reconcile')])
  .handler(async ({ data, context }) => {
    const { decideFindingCore } = await import('./decisions.server')
    const finding = await getDb().transaction((tx) =>
      decideFindingCore(tx, data, context.session),
    )
    return { ok: true, finding }
  })
