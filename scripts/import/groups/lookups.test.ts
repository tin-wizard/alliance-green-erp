/**
 * Group 1 — lookups.
 *
 * The group maps no `app` table, so what is pinned here is the decision: a usable
 * vocabulary row is crosswalked to the mirror row the app actually reads, and a
 * row the code cannot use is an exception — never a silent dropdown gap.
 */
import { and, eq, like } from 'drizzle-orm'
import { afterAll, describe, expect, test, vi } from 'vitest'
import { getDb } from '@cls/db'
import { getConfig } from '@cls/core/env.server'
import { migrationExceptions, migrationRowMap } from '@cls/db/schema'
import { GROUPS } from '../manifest'
import { runTransformerRow } from '../testing'
import { transformer } from './lookups'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })

const configured = (() => {
  try {
    return Boolean(getConfig().databaseUrl)
  } catch {
    return false
  }
})()

const marker = `lk${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

async function crosswalkFor(sourceKey: string) {
  const [row] = await getDb()
    .select()
    .from(migrationRowMap)
    .where(
      and(
        eq(migrationRowMap.entity, sourceKey.split(':')[0]!),
        eq(migrationRowMap.sourceKey, sourceKey),
      ),
    )
    .limit(1)
  return row ?? null
}

async function exceptionFor(exceptionClass: string, entity: string, sourceKey: string) {
  const [row] = await getDb()
    .select()
    .from(migrationExceptions)
    .where(
      and(
        eq(migrationExceptions.exceptionClass, exceptionClass),
        eq(migrationExceptions.entity, entity),
        eq(migrationExceptions.sourceKey, sourceKey),
      ),
    )
    .limit(1)
  return row ?? null
}

afterAll(async () => {
  if (!configured) return
  const db = getDb()
  await db.delete(migrationRowMap).where(like(migrationRowMap.sourceKey, `%${marker}%`))
  await db.delete(migrationExceptions).where(like(migrationExceptions.sourceKey, `%${marker}%`))
})

describe.skipIf(!configured)('lookups group', () => {
  test('a known work-order status is crosswalked to the mirror row', async () => {
    const sourceKey = `wo_status:${marker}:1`
    await getDb().transaction(async (tx) => {
      await runTransformerRow(tx, transformer, {
        group: 'lookups',
        table: 'wo_status',
        sourceKey,
        row: { id: '1', name: 'Active' },
      })
    })

    const mapped = await crosswalkFor(sourceKey)
    expect(mapped?.targetTable).toBe('public.wo_status')
    expect(mapped?.targetKey).toBe('1')
    expect(await exceptionFor('unknown_enum', 'wo_status', sourceKey)).toBeNull()
  })

  test('a status code the app does not project is an exception, not a row', async () => {
    const sourceKey = `wo_status:${marker}:13`
    await getDb().transaction(async (tx) => {
      await runTransformerRow(tx, transformer, {
        group: 'lookups',
        table: 'wo_status',
        sourceKey,
        row: { id: '13', name: 'Archived' },
      })
    })

    const recorded = await exceptionFor('unknown_enum', 'wo_status', sourceKey)
    expect(recorded?.migrationAction).toContain('not projected')
    // The exception replaces the crosswalk: nothing claims a 13th status exists.
    expect(await crosswalkFor(sourceKey)).toBeNull()
  })

  test('a blank label on a vocabulary the adapter renders is an exception', async () => {
    const sourceKey = `wo_servtype:${marker}:4`
    await getDb().transaction(async (tx) => {
      await runTransformerRow(tx, transformer, {
        group: 'lookups',
        table: 'wo_servtype',
        sourceKey,
        row: { id: '4', name: '   ' },
      })
    })

    expect(await exceptionFor('unknown_enum', 'wo_servtype', sourceKey)).not.toBeNull()
    expect(await crosswalkFor(sourceKey)).toBeNull()
  })

  test('a priority row is crosswalked with its label kept in the mirror', async () => {
    const sourceKey = `wo_priority:${marker}:2`
    await getDb().transaction(async (tx) => {
      await runTransformerRow(tx, transformer, {
        group: 'lookups',
        table: 'wo_priority',
        sourceKey,
        row: { id: '2', name: 'High' },
      })
    })

    const mapped = await crosswalkFor(sourceKey)
    expect(mapped?.targetTable).toBe('public.wo_priority')
    expect(mapped?.targetKey).toBe('2')
  })

  test('every manifest table of the group has a parity anchor', () => {
    const group = GROUPS.find((entry) => entry.name === 'lookups')
    expect(group).toBeDefined()
    const labels = (transformer.parity ?? []).map((anchor) => anchor.label)
    for (const table of group!.tables) {
      expect(labels.some((label) => label.startsWith(`${table.table} rows`))).toBe(true)
    }
  })

  test('the unmapped record states that status labels come from code', () => {
    expect(transformer.unmapped?.['wo_status.name']).toContain('projected from code')
  })

  test('an unknown table fails instead of being silently ignored', async () => {
    await expect(
      getDb().transaction(async (tx) => {
        await runTransformerRow(tx, transformer, {
          group: 'lookups',
          table: 'not_a_lookup',
          sourceKey: `not_a_lookup:${marker}:1`,
          row: { id: '1', name: 'x' },
        })
      }),
    ).rejects.toThrow(/no mapping for table not_a_lookup/)
  })
})
