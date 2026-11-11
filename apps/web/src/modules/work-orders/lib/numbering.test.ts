import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  counterAfterInsert,
  numberingPolicyFromEnv,
  planWorkOrderNumber,
  WorkOrderNumberingError,
  type NumberUsageChecker,
} from './numbering'

interface NumberingCase {
  id: string
  note: string
  input: {
    'wo_next_pid.next_id': number
    existing_workorder_ids: number[]
    sage_tcustr_sSource: string[]
    sage_tProject_sName: string[]
    db_selected_before_call: boolean
  }
  expected: { allocated: string | null; counter_after: string }
  intended_behaviour?: string
  defect?: string
}

function loadCases(): NumberingCase[] {
  const parsed = JSON.parse(
    readFileSync(new URL('./fixtures/wo-numbering.json', import.meta.url), 'utf8'),
  ) as { cases: NumberingCase[] }
  return parsed.cases
}

function makeUsage(raw: NumberingCase): NumberUsageChecker {
  const appIds = new Set(raw.input.existing_workorder_ids.map(Number))
  const sage = new Set([
    ...raw.input.sage_tcustr_sSource.map(Number),
    ...raw.input.sage_tProject_sName.map(Number),
  ])
  return {
    appHas: (id) => appIds.has(id),
    sageHas: (id) => sage.has(id),
  }
}

describe('wo-numbering fixture pack (intended behaviour, strict mode)', () => {
  const cases = loadCases().filter((raw) => raw.id !== 'woid-collision-missed-without-db-select')

  test.each(cases)('wo-numbering / $id — $note', async (raw) => {
    const plan = await planWorkOrderNumber({
      series: 1,
      counter: raw.input['wo_next_pid.next_id'],
      usage: makeUsage(raw),
      enforceAppCollisions: true,
    })
    expect(String(plan.number)).toBe(raw.expected.allocated)
    expect(String(plan.counterAfter)).toBe(raw.expected.counter_after)
    expect(counterAfterInsert(plan)).toBe(plan.number + 1)
  })
})

describe('wo-numbering defect case', () => {
  const raw = loadCases().find((item) => item.id === 'woid-collision-missed-without-db-select')!

  test('wo-numbering / woid-collision-missed-without-db-select — intended behaviour allocates 900501', async () => {
    // The legacy function returned null because it queried the counter on a
    // connection with no schema selected. The allocator must never do that.
    const plan = await planWorkOrderNumber({
      series: 1,
      counter: raw.input['wo_next_pid.next_id'],
      usage: makeUsage(raw),
      enforceAppCollisions: true,
    })
    expect(String(plan.number)).toBe('900501')
    expect(plan.skipped).toEqual([900500])
  })

  test('wo-numbering / woid-collision-missed-without-db-select — legacy-permissive default refuses, never null', async () => {
    await expect(
      planWorkOrderNumber({
        series: 1,
        counter: raw.input['wo_next_pid.next_id'],
        usage: makeUsage(raw),
        enforceAppCollisions: false,
      }),
    ).rejects.toBeInstanceOf(WorkOrderNumberingError)
    expect(raw.expected.allocated).toBeNull()
  })
})

describe('numbering policy', () => {
  test('default is legacy-permissive (C4 fix off until sign-off)', () => {
    expect(numberingPolicyFromEnv({})).toEqual({
      enforceAppCollisions: false,
      refuseUnverifiedSage: false,
    })
  })

  test('WORKORDER_NUMBERING_STRICT=true turns the intended checks on', () => {
    expect(numberingPolicyFromEnv({ WORKORDER_NUMBERING_STRICT: 'true' })).toEqual({
      enforceAppCollisions: true,
      refuseUnverifiedSage: true,
    })
  })

  test('maintenance series uses the same rules on series 2', async () => {
    const plan = await planWorkOrderNumber({
      series: 2,
      counter: 5000,
      usage: { appHas: () => false, sageHas: () => false },
      enforceAppCollisions: true,
    })
    expect(plan.series).toBe(2)
    expect(plan.number).toBe(5000)
  })

  test('unverified Sage is a warning in permissive mode and a refusal in strict mode', async () => {
    const usage: NumberUsageChecker = { appHas: () => false, sageHas: () => null }
    const permissive = await planWorkOrderNumber({
      series: 1,
      counter: 900700,
      usage,
      enforceAppCollisions: false,
    })
    expect(permissive.number).toBe(900700)
    expect(permissive.warnings.length).toBe(1)
    expect(permissive.sageVerified).toBe(false)

    await expect(
      planWorkOrderNumber({
        series: 1,
        counter: 900700,
        usage,
        enforceAppCollisions: true,
      }),
    ).rejects.toThrow(/Cannot verify work order 900700 against Sage/)
  })
})
