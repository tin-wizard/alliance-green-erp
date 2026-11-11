import { eq } from 'drizzle-orm'
import { ForbiddenError, NotFoundError } from '@cls/core'
import type { Executor } from '@cls/db'
import { rgas } from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import { assertPermission } from '../../../server/middleware'

export type RgaRow = typeof rgas.$inferSelect

export function assertRgaRead(session: AuthSessionView): void {
  assertPermission(session, 'rga:read')
}

export function assertRgaWrite(session: AuthSessionView): void {
  assertPermission(session, 'rga:write')
}

export function assertRgaApprove(session: AuthSessionView): void {
  assertPermission(session, 'rga:approve')
}

export function assertRgaCredit(session: AuthSessionView): void {
  assertPermission(session, 'rga:credit')
}

/** Subcontractor accounts only ever see their own company's RGAs. */
export function subcontractorScope(session: AuthSessionView): number | null {
  return session.user.role === 'subcontractor' ? session.user.subcontractorId : null
}

export function assertOwnedRga(session: AuthSessionView, row: RgaRow): void {
  const scope = subcontractorScope(session)
  if (scope !== null && row.subcontractorId !== scope) {
    throw new ForbiddenError('This RGA belongs to another subcontractor.')
  }
}

export async function loadRga(
  session: AuthSessionView,
  id: number,
  executor: Executor,
): Promise<RgaRow> {
  assertRgaRead(session)
  const [row] = await executor.select().from(rgas).where(eq(rgas.id, id)).limit(1)
  if (!row) throw new NotFoundError('RGA')
  assertOwnedRga(session, row)
  return row
}
