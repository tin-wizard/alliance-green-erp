/**
 * TJX room and fixture masters.
 *
 * SERVER ONLY. These cores never calculate a quote and never write a part
 * price. They own only the definitions a quote copies from.
 */
import { and, asc, count, eq, ilike, inArray, ne, or, sql, type SQL } from 'drizzle-orm'
import { NotFoundError, ValidationError } from '@cls/core'
import type { Executor, Tx } from '@cls/db'
import {
  parts,
  subcontractors,
  tjxFixtureParts,
  tjxFixtures,
  tjxRoomTemplateRooms,
  tjxRoomTemplates,
  tjxRooms,
} from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import type {
  TjxFixtureDetail,
  TjxFixtureRow,
  TjxPartOption,
  TjxRoomRow,
  TjxSubcontractorOption,
} from '../types'
import type { SaveFixtureInput, SaveRoomInput } from '../lib/masters.validation'
import { assertTjxWrite, auditTjx, normalizePartNo } from './access.server'

const FACTOR = /^\d+(\.\d{1,4})?$/

function validatePartFactor(partNo: string, label: string, value: string, allowZero: boolean) {
  if (!FACTOR.test(value) || Number(value) < 0 || (!allowZero && Number(value) === 0)) {
    throw new ValidationError(
      `Enter a valid ${label} for part ${partNo}${allowZero ? ' (zero or more)' : ' greater than zero'}.`,
    )
  }
}

function roomSnapshot(row: typeof tjxRooms.$inferSelect): Record<string, unknown> {
  return {
    name: row.name,
    description: row.description,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
  }
}

export async function listRooms(
  executor: Executor,
  input: { search?: string; active: 'all' | 'active' | 'inactive' },
): Promise<TjxRoomRow[]> {
  const where: SQL[] = []
  if (input.search) where.push(ilike(tjxRooms.name, `%${input.search}%`))
  if (input.active === 'active') where.push(eq(tjxRooms.isActive, true))
  if (input.active === 'inactive') where.push(eq(tjxRooms.isActive, false))

  const rows = await executor
    .select()
    .from(tjxRooms)
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(tjxRooms.sortOrder), asc(tjxRooms.name))

  const usage = await executor
    .select({ roomId: tjxRoomTemplateRooms.roomId, templateName: tjxRoomTemplates.name })
    .from(tjxRoomTemplateRooms)
    .innerJoin(tjxRoomTemplates, eq(tjxRoomTemplates.id, tjxRoomTemplateRooms.templateId))
    .orderBy(asc(tjxRoomTemplates.name))

  const byRoom = new Map<number, string[]>()
  for (const item of usage) {
    const list = byRoom.get(item.roomId) ?? []
    list.push(item.templateName)
    byRoom.set(item.roomId, list)
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    usedByTemplates: byRoom.get(row.id) ?? [],
  }))
}

export async function saveRoomCore(
  tx: Tx,
  input: SaveRoomInput,
  session: AuthSessionView,
): Promise<TjxRoomRow> {
  assertTjxWrite(session)
  const name = input.name.trim()
  if (!name) throw new ValidationError('Enter a room name.')

  const duplicate = await tx
    .select({ id: tjxRooms.id })
    .from(tjxRooms)
    .where(
      and(
        sql`lower(${tjxRooms.name}) = lower(${name})`,
        input.id ? ne(tjxRooms.id, input.id) : undefined,
      ),
    )
    .limit(1)
  if (duplicate.length) throw new ValidationError(`A room named "${name}" already exists.`)

  if (input.id) {
    const [before] = await tx.select().from(tjxRooms).where(eq(tjxRooms.id, input.id)).limit(1)
    if (!before) throw new NotFoundError('TJX room')
    const [after] = await tx
      .update(tjxRooms)
      .set({
        name,
        description: input.description ?? null,
        sortOrder: input.sortOrder,
        isActive: input.isActive,
        updatedBy: session.user.id,
        updatedAt: new Date(),
      })
      .where(eq(tjxRooms.id, input.id))
      .returning()
    await auditTjx(tx, session, 'tjx.room.update', 'tjx_room', input.id, {
      summary: `Updated TJX room ${name}.`,
      before: roomSnapshot(before),
      after: roomSnapshot(after!),
    })
    return {
      id: after!.id,
      name: after!.name,
      description: after!.description,
      sortOrder: after!.sortOrder,
      isActive: after!.isActive,
      usedByTemplates: [],
    }
  }

  const [created] = await tx
    .insert(tjxRooms)
    .values({
      name,
      description: input.description ?? null,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
      createdBy: session.user.id,
      updatedBy: session.user.id,
    })
    .returning()
  await auditTjx(tx, session, 'tjx.room.create', 'tjx_room', created!.id, {
    summary: `Created TJX room ${name}.`,
    after: roomSnapshot(created!),
  })
  return {
    id: created!.id,
    name: created!.name,
    description: created!.description,
    sortOrder: created!.sortOrder,
    isActive: created!.isActive,
    usedByTemplates: [],
  }
}

export async function setRoomActiveCore(
  tx: Tx,
  input: { id: number; isActive: boolean },
  session: AuthSessionView,
): Promise<{ id: number; isActive: boolean }> {
  assertTjxWrite(session)
  const [room] = await tx.select().from(tjxRooms).where(eq(tjxRooms.id, input.id)).limit(1)
  if (!room) throw new NotFoundError('TJX room')
  if (!input.isActive) {
    const [used] = await tx
      .select({ name: tjxRoomTemplates.name })
      .from(tjxRoomTemplateRooms)
      .innerJoin(tjxRoomTemplates, eq(tjxRoomTemplates.id, tjxRoomTemplateRooms.templateId))
      .where(eq(tjxRoomTemplateRooms.roomId, input.id))
      .limit(1)
    if (used) {
      throw new ValidationError(
        `This room is in template "${used.name}". Remove it from the template first.`,
      )
    }
  }
  const [updated] = await tx
    .update(tjxRooms)
    .set({ isActive: input.isActive, updatedBy: session.user.id, updatedAt: new Date() })
    .where(eq(tjxRooms.id, input.id))
    .returning()
  await auditTjx(tx, session, 'tjx.room.active', 'tjx_room', input.id, {
    summary: `${input.isActive ? 'Activated' : 'Deactivated'} TJX room ${room.name}.`,
    before: { isActive: room.isActive },
    after: { isActive: updated!.isActive },
  })
  return { id: updated!.id, isActive: updated!.isActive }
}

function fixtureSnapshot(row: typeof tjxFixtures.$inferSelect): Record<string, unknown> {
  return {
    name: row.name,
    description: row.description,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
  }
}

export async function listFixtures(
  executor: Executor,
  input: { search?: string; active: 'all' | 'active' | 'inactive' },
): Promise<TjxFixtureRow[]> {
  const where: SQL[] = []
  if (input.search) where.push(ilike(tjxFixtures.name, `%${input.search}%`))
  if (input.active === 'active') where.push(eq(tjxFixtures.isActive, true))
  if (input.active === 'inactive') where.push(eq(tjxFixtures.isActive, false))

  const rows = await executor
    .select()
    .from(tjxFixtures)
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(tjxFixtures.sortOrder), asc(tjxFixtures.name))

  const counts =
    rows.length === 0
      ? []
      : await executor
          .select({ fixtureId: tjxFixtureParts.fixtureId, partCount: count() })
          .from(tjxFixtureParts)
          .where(inArray(tjxFixtureParts.fixtureId, rows.map((row) => row.id)))
          .groupBy(tjxFixtureParts.fixtureId)
  const byFixture = new Map(counts.map((row) => [row.fixtureId, Number(row.partCount)]))
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    partCount: byFixture.get(row.id) ?? 0,
  }))
}

export async function getFixture(
  executor: Executor,
  id: number,
): Promise<TjxFixtureDetail | null> {
  const [fixture] = await executor.select().from(tjxFixtures).where(eq(tjxFixtures.id, id)).limit(1)
  if (!fixture) return null
  const parts = await executor
    .select()
    .from(tjxFixtureParts)
    .where(eq(tjxFixtureParts.fixtureId, id))
    .orderBy(asc(tjxFixtureParts.sortOrder), asc(tjxFixtureParts.partNo))
  return {
    id: fixture.id,
    name: fixture.name,
    description: fixture.description,
    sortOrder: fixture.sortOrder,
    isActive: fixture.isActive,
    partCount: parts.length,
    parts: parts.map((part) => ({
      id: part.id,
      partNo: part.partNo,
      partType: part.partType,
      markup: part.markup,
      ratioPerFixture: part.ratioPerFixture,
      sortOrder: part.sortOrder,
    })),
  }
}

export async function saveFixtureCore(
  tx: Tx,
  input: SaveFixtureInput,
  session: AuthSessionView,
): Promise<TjxFixtureDetail> {
  assertTjxWrite(session)
  const name = input.name.trim()
  if (!name) throw new ValidationError('Enter a fixture name.')
  if (input.parts.length === 0) throw new ValidationError('Add at least one part.')

  const normalized = input.parts.map((part) => ({ ...part, partNo: normalizePartNo(part.partNo) }))
  const seen = new Set<string>()
  for (const part of normalized) {
    if (seen.has(part.partNo)) {
      throw new ValidationError(`Part ${part.partNo} appears more than once in this fixture.`)
    }
    if (!['Ballast', 'Lamp', ''].includes(part.partType)) {
      throw new ValidationError(`Choose Ballast, Lamp or blank for part ${part.partNo}.`)
    }
    validatePartFactor(part.partNo, 'markup', part.markup, false)
    validatePartFactor(part.partNo, 'ratio', part.ratioPerFixture, true)
    seen.add(part.partNo)
  }

  const existingParts = await tx
    .select({ partNumber: parts.partNumber })
    .from(parts)
    .where(inArray(parts.partNumber, [...seen]))
  const found = new Set(existingParts.map((row) => row.partNumber))
  const missing = [...seen].filter((partNo) => !found.has(partNo))
  if (missing.length) {
    throw new ValidationError(`Unknown part number: ${missing.join(', ')}.`)
  }

  const duplicate = await tx
    .select({ id: tjxFixtures.id })
    .from(tjxFixtures)
    .where(
      and(
        sql`lower(${tjxFixtures.name}) = lower(${name})`,
        input.id ? ne(tjxFixtures.id, input.id) : undefined,
      ),
    )
    .limit(1)
  if (duplicate.length) throw new ValidationError(`A fixture named "${name}" already exists.`)

  let fixtureId: number
  let before: typeof tjxFixtures.$inferSelect | undefined
  if (input.id) {
    ;[before] = await tx.select().from(tjxFixtures).where(eq(tjxFixtures.id, input.id)).limit(1)
    if (!before) throw new NotFoundError('TJX fixture')
    const [updated] = await tx
      .update(tjxFixtures)
      .set({
        name,
        description: input.description ?? null,
        sortOrder: input.sortOrder,
        isActive: input.isActive,
        updatedBy: session.user.id,
        updatedAt: new Date(),
      })
      .where(eq(tjxFixtures.id, input.id))
      .returning()
    fixtureId = updated!.id
    await tx.delete(tjxFixtureParts).where(eq(tjxFixtureParts.fixtureId, fixtureId))
  } else {
    const [created] = await tx
      .insert(tjxFixtures)
      .values({
        name,
        description: input.description ?? null,
        sortOrder: input.sortOrder,
        isActive: input.isActive,
        createdBy: session.user.id,
        updatedBy: session.user.id,
      })
      .returning()
    fixtureId = created!.id
  }

  await tx.insert(tjxFixtureParts).values(
    normalized.map((part) => ({
      fixtureId,
      partNo: part.partNo,
      partType: part.partType,
      markup: part.markup,
      ratioPerFixture: part.ratioPerFixture,
      sortOrder: part.sortOrder,
    })),
  )

  const detail = (await getFixture(tx, fixtureId))!
  await auditTjx(
    tx,
    session,
    input.id ? 'tjx.fixture.update' : 'tjx.fixture.create',
    'tjx_fixture',
    fixtureId,
    {
      summary: `${input.id ? 'Updated' : 'Created'} TJX fixture ${name}.`,
      before: before ? fixtureSnapshot(before) : null,
      after: detail as unknown as Record<string, unknown>,
    },
  )
  return detail
}

export async function setFixtureActiveCore(
  tx: Tx,
  input: { id: number; isActive: boolean },
  session: AuthSessionView,
): Promise<{ id: number; isActive: boolean }> {
  assertTjxWrite(session)
  const [fixture] = await tx.select().from(tjxFixtures).where(eq(tjxFixtures.id, input.id)).limit(1)
  if (!fixture) throw new NotFoundError('TJX fixture')
  const [updated] = await tx
    .update(tjxFixtures)
    .set({ isActive: input.isActive, updatedBy: session.user.id, updatedAt: new Date() })
    .where(eq(tjxFixtures.id, input.id))
    .returning()
  await auditTjx(tx, session, 'tjx.fixture.active', 'tjx_fixture', input.id, {
    summary: `${input.isActive ? 'Activated' : 'Deactivated'} TJX fixture ${fixture.name}.`,
    before: { isActive: fixture.isActive },
    after: { isActive: updated!.isActive },
  })
  return { id: updated!.id, isActive: updated!.isActive }
}

export async function searchParts(
  executor: Executor,
  input: { search?: string; limit: number },
): Promise<TjxPartOption[]> {
  const term = (input.search ?? '').trim()
  const where = term
    ? or(
        ilike(parts.partNumber, `%${term}%`),
        ilike(parts.name, `%${term}%`),
      )
    : undefined
  const rows = await executor
    .select({ partNumber: parts.partNumber, name: parts.name, sellPrice: parts.sellPrice })
    .from(parts)
    .where(where)
    .orderBy(asc(parts.partNumber))
    .limit(input.limit)
  return rows
}

export async function listSubcontractorOptions(
  executor: Executor,
): Promise<TjxSubcontractorOption[]> {
  return executor
    .select({ id: subcontractors.id, name: subcontractors.name })
    .from(subcontractors)
    .where(eq(subcontractors.isActive, true))
    .orderBy(asc(subcontractors.name))
    .limit(500)
}
