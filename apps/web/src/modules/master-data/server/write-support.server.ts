/**
 * Shared write plumbing: local ids, idempotency, audit.
 *
 * SERVER ONLY. Every helper takes the caller's transaction so the business row,
 * its idempotency record and its audit trail commit together.
 */
import { and, eq, sql } from 'drizzle-orm'
import { writeAudit } from '@cls/auth'
import { ValidationError, type PermissionKey } from '@cls/core'
import type { Executor, Tx } from '@cls/db'
import { localIdAllocations, masterDataRequests } from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'

export type LocalEntity = 'customer' | 'site' | 'subcontractor' | 'supplier' | 'part'

/**
 * New records take a negative id from a row-locked counter. The id is
 * permanent: linking the row to Sage fills `sage_*_id`, it never renumbers.
 */
export async function allocateLocalId(tx: Tx, entity: LocalEntity): Promise<number> {
  await tx
    .insert(localIdAllocations)
    .values({ entity, nextId: 0 })
    .onConflictDoNothing({ target: localIdAllocations.entity })
  const [row] = await tx
    .update(localIdAllocations)
    .set({ nextId: sql`${localIdAllocations.nextId} - 1` })
    .where(eq(localIdAllocations.entity, entity))
    .returning({ nextId: localIdAllocations.nextId })
  if (!row) throw new ValidationError('Could not allocate a local id.')
  return row.nextId
}

export async function idempotencyEntityId(
  tx: Tx,
  entity: LocalEntity,
  key: string,
): Promise<number | null> {
  const [existing] = await tx
    .select({ entityId: masterDataRequests.entityId })
    .from(masterDataRequests)
    .where(and(eq(masterDataRequests.key, key), eq(masterDataRequests.entity, entity)))
    .limit(1)
  return existing?.entityId ?? null
}

export async function recordIdempotency(
  tx: Tx,
  entity: LocalEntity,
  key: string,
  entityId: number,
): Promise<void> {
  await tx.insert(masterDataRequests).values({ key, entity, entityId })
}

export async function auditMasterData(
  executor: Executor,
  session: AuthSessionView,
  input: {
    action: string
    entityType: string
    entityId: number | string
    permission: PermissionKey
    summary: string
    before?: Record<string, unknown> | null
    after?: Record<string, unknown> | null
  },
): Promise<void> {
  await writeAudit(executor, {
    action: input.action,
    actorUserId: session.user.id,
    actorLabel: session.user.displayName,
    actorRole: session.user.role,
    entityType: input.entityType,
    entityId: String(input.entityId),
    summary: input.summary,
    permission: input.permission,
    before: input.before ?? null,
    after: input.after ?? null,
  })
}

export function localFlag(id: number): { isLocal: boolean; sageLinked: boolean } {
  return { isLocal: id < 0, sageLinked: id > 0 }
}

/**
 * Guard for the future Sage write path. Master Data itself never posts, but a
 * local record must never reach the outbound adapter silently.
 */
export function assertSagePostable(
  entity: string,
  id: number,
  sageId: number | null,
): asserts sageId is number {
  if (id < 0 || sageId === null) {
    throw new ValidationError(
      `${entity} ${id} is local and not linked in Sage. Create it in Sage first; posting is blocked until the import links it.`,
      { code: 'SAGE_LINK_REQUIRED', entity, id },
    )
  }
}
