import { describe, expect, it } from 'vitest'
import { createHelpers } from './helpers'
import type { TransformContext } from './types'

function helpersFor(row: Record<string, string | null>) {
  const zeroDates: string[] = []
  const context = { tx: null as never, dumpId: 'd', group: 'g', table: 't', sourceKey: 'k', row }
  const helpers = createHelpers(context as Omit<TransformContext, 'helpers'>, {
    onZeroDate: (column) => zeroDates.push(column),
  })
  return { helpers, zeroDates }
}

describe('date helpers', () => {
  it('keeps a real date', () => {
    const { helpers, zeroDates } = helpersFor({ d: '2024-02-29', t: '2024-02-29 10:30:00' })
    expect(helpers.date('d')).toBe('2024-02-29')
    expect(helpers.timestamp('t')).toBe('2024-02-29 10:30:00')
    expect(zeroDates).toEqual([])
  })

  it.each(['0000-00-00', '0000-00-00 00:00:00', '2020-03-00', '2020-00-15', '2021-02-31', '2023-02-29'])(
    'treats %s as an unusable date: null, and recorded',
    (value) => {
      const { helpers, zeroDates } = helpersFor({ d: value, t: value })
      expect(helpers.date('d')).toBeNull()
      expect(helpers.timestamp('t')).toBeNull()
      expect(zeroDates).toEqual(['d', 't'])
    },
  )

  it('leaves non-dates alone: null, but not a zero-date exception', () => {
    const { helpers, zeroDates } = helpersFor({ d: 'soon', e: '', n: null })
    expect(helpers.date('d')).toBeNull()
    expect(helpers.date('e')).toBeNull()
    expect(helpers.date('n')).toBeNull()
    expect(zeroDates).toEqual([])
  })
})
