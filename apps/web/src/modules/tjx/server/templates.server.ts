/**
 * TJX room templates.
 *
 * A template is an ordered list of room masters. It is copied into a quote at
 * creation; editing it later never changes an existing quote. Exactly one
 * template is the default, enforced by a partial unique index and by this core.
 */
import { and, asc, count, eq, ilike, inArray, ne, sql } from 'drizzle-orm'
import { NotFoundError, ValidationError } from '@cls/core'
import type { Executor, Tx } from '@cls/db'
import { tjxRoomTemplateRooms, tjxRoomTemplates, tjxRooms } from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import type { TjxTemplateDetail, TjxTemplateRow } from '../types'
import type { SaveTemplateInput } from '../lib/masters.validation'
import { assertTjxWrite, auditTjx } from './access.server'

function templateSnapshot(row: typeof tjxRoomTemplates.$inferSelect): Record<string, unknown> {
  return { name: row.name, isDefault: row.isDefault, notes: row.notes }
}

export async function listTemplates(
  executor: Executor,
  input: { search?: string },
): Promise<TjxTemplateRow[]> {
  const rows = await executor
    .select()
    .from(tjxRoomTemplates)
    .where(input.search ? ilike(tjxRoomTemplates.name, `%${input.search}%`) : undefined)
    .orderBy(sql`${tjxRoomTemplates.isDefault} desc`, asc(tjxRoomTemplates.name))

  const counts =
    rows.length === 0
      ? []
      : await executor
          .select({ templateId: tjxRoomTemplateRooms.templateId, roomCount: count() })
          .from(tjxRoomTemplateRooms)
          .where(inArray(tjxRoomTemplateRooms.templateId, rows.map((row) => row.id)))
          .groupBy(tjxRoomTemplateRooms.templateId)
  const byTemplate = new Map(counts.map((row) => [row.templateId, Number(row.roomCount)]))

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    isDefault: row.isDefault,
    notes: row.notes,
    roomCount: byTemplate.get(row.id) ?? 0,
    updatedAt: row.updatedAt.toISOString(),
  }))
}

export async function getTemplate(
  executor: Executor,
  id: number,
): Promise<TjxTemplateDetail | null> {
  const [template] = await executor
    .select()
    .from(tjxRoomTemplates)
    .where(eq(tjxRoomTemplates.id, id))
    .limit(1)
  if (!template) return null
  const rooms = await executor
    .select({
      roomId: tjxRoomTemplateRooms.roomId,
      roomName: tjxRooms.name,
      sortOrder: tjxRoomTemplateRooms.sortOrder,
    })
    .from(tjxRoomTemplateRooms)
    .innerJoin(tjxRooms, eq(tjxRooms.id, tjxRoomTemplateRooms.roomId))
    .where(eq(tjxRoomTemplateRooms.templateId, id))
    .orderBy(asc(tjxRoomTemplateRooms.sortOrder))
  return {
    id: template.id,
    name: template.name,
    isDefault: template.isDefault,
    notes: template.notes,
    roomCount: rooms.length,
    updatedAt: template.updatedAt.toISOString(),
    rooms,
  }
}

export async function getDefaultTemplate(
  executor: Executor,
): Promise<TjxTemplateDetail | null> {
  const [template] = await executor
    .select({ id: tjxRoomTemplates.id })
    .from(tjxRoomTemplates)
    .where(eq(tjxRoomTemplates.isDefault, true))
    .limit(1)
  return template ? getTemplate(executor, template.id) : null
}

export async function saveTemplateCore(
  tx: Tx,
  input: SaveTemplateInput,
  session: AuthSessionView,
): Promise<TjxTemplateDetail> {
  assertTjxWrite(session)
  const name = input.name.trim()
  if (!name) throw new ValidationError('Enter a template name.')
  if (new Set(input.roomIds).size !== input.roomIds.length) {
    throw new ValidationError('A room can appear only once in a template.')
  }

  const duplicate = await tx
    .select({ id: tjxRoomTemplates.id })
    .from(tjxRoomTemplates)
    .where(
      and(
        sql`lower(${tjxRoomTemplates.name}) = lower(${name})`,
        input.id ? ne(tjxRoomTemplates.id, input.id) : undefined,
      ),
    )
    .limit(1)
  if (duplicate.length) throw new ValidationError(`A template named "${name}" already exists.`)

  if (input.roomIds.length) {
    const roomRows = await tx
      .select({ id: tjxRooms.id, name: tjxRooms.name, isActive: tjxRooms.isActive })
      .from(tjxRooms)
      .where(inArray(tjxRooms.id, input.roomIds))
    if (roomRows.length !== input.roomIds.length) {
      throw new ValidationError('One of the selected rooms no longer exists.')
    }
    const inactive = roomRows.filter((row) => !row.isActive)
    if (inactive.length) {
      throw new ValidationError(
        `Inactive room cannot be added to a template: ${inactive.map((row) => row.name).join(', ')}.`,
      )
    }
  }

  let before: typeof tjxRoomTemplates.$inferSelect | undefined
  let templateId: number
  if (input.id) {
    ;[before] = await tx
      .select()
      .from(tjxRoomTemplates)
      .where(eq(tjxRoomTemplates.id, input.id))
      .limit(1)
    if (!before) throw new NotFoundError('TJX room template')
    if (before.isDefault && !input.isDefault) {
      throw new ValidationError('Set another template as default before clearing this one.')
    }
  }

  if (input.isDefault) {
    await tx
      .update(tjxRoomTemplates)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(input.id ? ne(tjxRoomTemplates.id, input.id) : undefined)
  }

  if (input.id) {
    const [updated] = await tx
      .update(tjxRoomTemplates)
      .set({
        name,
        notes: input.notes ?? null,
        isDefault: input.isDefault,
        updatedBy: session.user.id,
        updatedAt: new Date(),
      })
      .where(eq(tjxRoomTemplates.id, input.id))
      .returning()
    templateId = updated!.id
  } else {
    const [created] = await tx
      .insert(tjxRoomTemplates)
      .values({
        name,
        notes: input.notes ?? null,
        isDefault: input.isDefault,
        createdBy: session.user.id,
        updatedBy: session.user.id,
      })
      .returning()
    templateId = created!.id
  }

  await tx.delete(tjxRoomTemplateRooms).where(eq(tjxRoomTemplateRooms.templateId, templateId))
  if (input.roomIds.length) {
    await tx.insert(tjxRoomTemplateRooms).values(
      input.roomIds.map((roomId, index) => ({
        templateId,
        roomId,
        sortOrder: index,
      })),
    )
  }

  const detail = (await getTemplate(tx, templateId))!
  await auditTjx(
    tx,
    session,
    input.id ? 'tjx.template.update' : 'tjx.template.create',
    'tjx_room_template',
    templateId,
    {
      summary: `${input.id ? 'Updated' : 'Created'} TJX room template ${name}.`,
      before: before ? templateSnapshot(before) : null,
      after: detail as unknown as Record<string, unknown>,
    },
  )
  return detail
}

export async function setDefaultTemplateCore(
  tx: Tx,
  id: number,
  session: AuthSessionView,
): Promise<TjxTemplateDetail> {
  assertTjxWrite(session)
  const [before] = await tx
    .select()
    .from(tjxRoomTemplates)
    .where(eq(tjxRoomTemplates.id, id))
    .limit(1)
  if (!before) throw new NotFoundError('TJX room template')
  await tx
    .update(tjxRoomTemplates)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(ne(tjxRoomTemplates.id, id))
  await tx
    .update(tjxRoomTemplates)
    .set({ isDefault: true, updatedBy: session.user.id, updatedAt: new Date() })
    .where(eq(tjxRoomTemplates.id, id))
  const detail = (await getTemplate(tx, id))!
  await auditTjx(tx, session, 'tjx.template.default', 'tjx_room_template', id, {
    summary: `Set TJX room template ${before.name} as default.`,
    before: { isDefault: before.isDefault },
    after: { isDefault: true },
  })
  return detail
}

export async function deleteTemplateCore(
  tx: Tx,
  id: number,
  session: AuthSessionView,
): Promise<void> {
  assertTjxWrite(session)
  const [template] = await tx
    .select()
    .from(tjxRoomTemplates)
    .where(eq(tjxRoomTemplates.id, id))
    .limit(1)
  if (!template) throw new NotFoundError('TJX room template')
  if (template.isDefault) throw new ValidationError('The default template cannot be deleted.')
  await tx.delete(tjxRoomTemplates).where(eq(tjxRoomTemplates.id, id))
  await auditTjx(tx, session, 'tjx.template.delete', 'tjx_room_template', id, {
    summary: `Deleted TJX room template ${template.name}.`,
    before: templateSnapshot(template),
    after: null,
  })
}
