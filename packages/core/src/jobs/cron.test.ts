/**
 * Cron resolution, in America/Toronto, including the two 2026 daylight-saving
 * boundaries. Unit tests only: no database, no network, no clock.
 */
import { describe, expect, test } from 'vitest'
import {
  CronExpressionError,
  businessDateFor,
  isOccurrence,
  nextOccurrence,
  parseCron,
  previousOccurrence,
} from './cron'

const TORONTO = 'America/Toronto'

describe('parseCron', () => {
  test('expands steps, ranges and lists', () => {
    const fields = parseCron('*/15 8-10 1,15 * 1-5')
    expect(fields.minutes).toEqual([0, 15, 30, 45])
    expect(fields.hours).toEqual([8, 9, 10])
    expect(fields.daysOfMonth).toEqual([1, 15])
    expect(fields.months).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(fields.daysOfWeek).toEqual([1, 2, 3, 4, 5])
    expect(fields.dayOfMonthRestricted).toBe(true)
    expect(fields.dayOfWeekRestricted).toBe(true)
  })

  test('accepts 7 as Sunday', () => {
    expect(parseCron('0 0 * * 7').daysOfWeek).toEqual([0])
  })

  test('treats a bare star as unrestricted', () => {
    const fields = parseCron('0 7 * * 1-5')
    expect(fields.dayOfMonthRestricted).toBe(false)
    expect(fields.dayOfWeekRestricted).toBe(true)
  })

  test('rejects the wrong number of fields', () => {
    expect(() => parseCron('0 7 * *')).toThrow(CronExpressionError)
  })

  test('rejects out-of-range values', () => {
    expect(() => parseCron('60 * * * *')).toThrow(/outside 0-59/)
    expect(() => parseCron('* * * 13 *')).toThrow(/outside 1-12/)
  })

  test('rejects a backwards range and an empty item', () => {
    expect(() => parseCron('* 10-8 * * *')).toThrow(/backwards/)
    expect(() => parseCron('1,,2 * * * *')).toThrow(/empty item/)
  })
})

describe('nextOccurrence', () => {
  test('is strictly after the given instant', () => {
    const slot = new Date('2026-11-16T12:15:00Z')
    expect(nextOccurrence('15 7 * * *', TORONTO, slot).toISOString()).toBe(
      '2026-11-17T12:15:00.000Z',
    )
    expect(
      nextOccurrence('15 7 * * *', TORONTO, new Date('2026-11-16T12:14:59Z')).toISOString(),
    ).toBe('2026-11-16T12:15:00.000Z')
  })

  test('jumps to the next minute for a per-minute schedule', () => {
    expect(
      nextOccurrence('* * * * *', TORONTO, new Date('2026-11-16T12:00:30Z')).toISOString(),
    ).toBe('2026-11-16T12:01:00.000Z')
  })

  test('skips the weekend for a weekday schedule', () => {
    // Friday 2026-11-13 07:15 EST -> Monday 2026-11-16 07:15 EST.
    const friday = new Date('2026-11-13T12:15:00Z')
    expect(nextOccurrence('15 7 * * 1-5', TORONTO, friday).toISOString()).toBe(
      '2026-11-16T12:15:00.000Z',
    )
  })

  test('runs a Sunday schedule on Sunday only', () => {
    expect(
      nextOccurrence('0 2 * * 0', TORONTO, new Date('2026-11-13T15:00:00Z')).toISOString(),
    ).toBe('2026-11-15T07:00:00.000Z')
  })

  test('keeps 07:15 local across the spring-forward boundary', () => {
    // 2026-03-08 is the transition: 07:15 EST (12:15Z) becomes 07:15 EDT (11:15Z).
    expect(
      nextOccurrence('15 7 * * *', TORONTO, new Date('2026-03-07T12:15:00Z')).toISOString(),
    ).toBe('2026-03-08T11:15:00.000Z')
  })

  test('keeps 07:15 local across the autumn fall-back boundary', () => {
    // 2026-11-01 is the transition: 07:15 EDT (11:15Z) becomes 07:15 EST (12:15Z).
    expect(
      nextOccurrence('15 7 * * *', TORONTO, new Date('2026-10-31T11:15:00Z')).toISOString(),
    ).toBe('2026-11-01T12:15:00.000Z')
  })

  test('a schedule inside the skipped hour still runs once, later that morning', () => {
    // 02:30 does not exist on 2026-03-08; it must not vanish or double up.
    const slot = nextOccurrence('30 2 * * *', TORONTO, new Date('2026-03-07T12:00:00Z'))
    expect(businessDateFor(slot, TORONTO)).toBe('2026-03-08')
    expect(slot.getTime()).toBeGreaterThan(new Date('2026-03-07T12:00:00Z').getTime())
  })

  test('throws for an expression that can never match', () => {
    expect(() => nextOccurrence('0 0 31 2 *', TORONTO, new Date('2026-01-01T00:00:00Z'))).toThrow(
      /no occurrence/,
    )
  })
})

describe('previousOccurrence', () => {
  test('returns today s slot once it has passed', () => {
    // Monday 2026-11-16 10:00 EST: the 07:15 slot is already behind us.
    expect(
      previousOccurrence('15 7 * * 1-5', TORONTO, new Date('2026-11-16T15:00:00Z'))?.toISOString(),
    ).toBe('2026-11-16T12:15:00.000Z')
  })

  test('returns Friday s slot at the weekend', () => {
    // Saturday 2026-11-14 09:00 EST: the last weekday slot is Friday s.
    expect(
      previousOccurrence('15 7 * * 1-5', TORONTO, new Date('2026-11-14T14:00:00Z'))?.toISOString(),
    ).toBe('2026-11-13T12:15:00.000Z')
  })

  test('returns the current minute for a per-minute schedule', () => {
    expect(
      previousOccurrence('* * * * *', TORONTO, new Date('2026-11-16T12:00:30Z'))?.toISOString(),
    ).toBe('2026-11-16T12:00:00.000Z')
  })
})

describe('isOccurrence', () => {
  test('is true on the slot and false a minute later', () => {
    expect(isOccurrence('15 7 * * 1-5', TORONTO, new Date('2026-11-16T12:15:00Z'))).toBe(true)
    expect(isOccurrence('15 7 * * 1-5', TORONTO, new Date('2026-11-16T12:16:00Z'))).toBe(false)
    // Saturday: the weekday rule applies.
    expect(isOccurrence('15 7 * * 1-5', TORONTO, new Date('2026-11-14T12:15:00Z'))).toBe(false)
  })
})

describe('businessDateFor', () => {
  test('uses the local date, not the UTC date', () => {
    // 2026-03-09T02:00Z is 22:00 on 8 March in Toronto.
    expect(businessDateFor(new Date('2026-03-09T02:00:00Z'), TORONTO)).toBe('2026-03-08')
  })

  test('rolls over at local midnight', () => {
    expect(businessDateFor(new Date('2026-03-08T04:59:00Z'), TORONTO)).toBe('2026-03-07')
    expect(businessDateFor(new Date('2026-03-08T05:00:00Z'), TORONTO)).toBe('2026-03-08')
  })
})
