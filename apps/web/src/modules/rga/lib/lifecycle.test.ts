import { describe, expect, test } from 'vitest'
import {
  RGA_STATUSES,
  allowedNextStatuses,
  canApprove,
  canRecordCredit,
  isTerminal,
  statusLabel,
} from './lifecycle'

describe('RGA lifecycle', () => {
  test('maps every raw legacy code to its vocabulary label', () => {
    expect(RGA_STATUSES.map(statusLabel)).toEqual([
      'Active',
      'Saved',
      'Completed',
      'Received',
      'In Transit',
      'Cancelled',
      'Invoiced',
    ])
    expect(statusLabel(1)).toBe('Status 1')
    expect(statusLabel(8)).toBe('Status 8')
  })

  test('only the legacy edges exist', () => {
    expect(allowedNextStatuses(2)).toEqual([3, 10])
    expect(allowedNextStatuses(3)).toEqual([7, 10])
    expect(allowedNextStatuses(7)).toEqual([6, 10])
    expect(allowedNextStatuses(6)).toEqual([4, 10])
    expect(allowedNextStatuses(4)).toEqual([])
    expect(allowedNextStatuses(10)).toEqual([])
    expect(allowedNextStatuses(11)).toEqual([])
  })

  test('terminal states never move', () => {
    for (const status of [4, 10, 11]) {
      expect(isTerminal(status)).toBe(true)
      expect(allowedNextStatuses(status)).toHaveLength(0)
    }
  })

  test('every from/to pair outside the edge list is rejected by construction', () => {
    const edges = new Set(['2>3', '2>10', '3>7', '3>10', '7>6', '7>10', '6>4', '6>10'])
    for (const from of RGA_STATUSES) {
      for (const to of RGA_STATUSES) {
        const allowed = allowedNextStatuses(from).includes(to)
        expect(allowed, `${from} -> ${to}`).toBe(edges.has(`${from}>${to}`))
      }
    }
  })

  test('approval is Active only; credit needs a credit RGA and a post-approval state', () => {
    expect(canApprove(2)).toBe(true)
    expect(canApprove(3)).toBe(false)
    expect(canRecordCredit(3, 'credit')).toBe(true)
    expect(canRecordCredit(6, 'credit')).toBe(true)
    expect(canRecordCredit(4, 'credit')).toBe(true)
    expect(canRecordCredit(2, 'credit')).toBe(false)
    expect(canRecordCredit(3, 'rga')).toBe(false)
    expect(canRecordCredit(11, 'credit')).toBe(false)
  })
})
