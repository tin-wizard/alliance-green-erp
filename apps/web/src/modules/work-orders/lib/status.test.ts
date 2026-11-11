import { describe, expect, test } from 'vitest'
import { STATUSES } from '@cls/core'
import {
  ALLOWED_TRANSITIONS,
  DISPLAY_TO_CODES,
  WORK_ORDER_STATUSES,
  canTransition,
  isTerminal,
  statusLabel,
  statusProjection,
  transitionPermission,
} from './status'
import type { WorkOrderStatusCode } from '../types'

const ALL_CODES = WORK_ORDER_STATUSES.map((status) => status.code)

describe('status projection', () => {
  test('stores the 12 legacy wo_status codes with their legacy labels', () => {
    expect(ALL_CODES).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(statusLabel(1)).toBe('Active')
    expect(statusLabel(4)).toBe('Pending Invoice')
    expect(statusLabel(11)).toBe('Invoiced')
  })

  test('projects only onto the shared eleven display statuses', () => {
    // Work orders use nine of the eleven; `transit` and `received` belong to
    // purchasing, and the design's reverse map keeps them empty.
    for (const status of WORK_ORDER_STATUSES) {
      expect(STATUSES).toContain(status.display)
    }
    expect(new Set(WORK_ORDER_STATUSES.map((status) => status.display)).size).toBe(9)
  })

  test('reverse map covers every raw code exactly once', () => {
    const fromReverse = Object.values(DISPLAY_TO_CODES).flat()
    expect(fromReverse.sort((a, b) => a - b)).toEqual(ALL_CODES)
  })

  test('status 7 Dispatched projects to Approved with the dispatched flag', () => {
    expect(statusProjection(7)).toMatchObject({
      display: 'approved',
      flags: ['dispatched'],
    })
  })

  test('status 4 Pending Invoice projects to Complete with awaiting_invoice', () => {
    expect(statusProjection(4)).toMatchObject({
      display: 'complete',
      flags: ['awaiting_invoice'],
    })
  })
})

describe('transition rules', () => {
  const legal: Array<[WorkOrderStatusCode, WorkOrderStatusCode]> = [
    [1, 7],
    [7, 2],
    [1, 8],
    [7, 8],
    [8, 1],
    [8, 7],
    [1, 9],
    [7, 9],
    [9, 1],
    [9, 7],
    [3, 1],
    [3, 10],
    [2, 4],
    [4, 11],
    [5, 1],
    [5, 7],
    [1, 5],
    [7, 5],
    [12, 1],
    [1, 6],
    [3, 6],
    [5, 6],
    [7, 6],
    [8, 6],
    [9, 6],
    [12, 6],
  ]

  test.each(legal)('allows %i -> %i', (from, to) => {
    expect(canTransition(from, to)).toBe(true)
  })

  const illegal: Array<[WorkOrderStatusCode, WorkOrderStatusCode]> = [
    [1, 2],
    [1, 11],
    [2, 1],
    [2, 11],
    [11, 1],
    [11, 2],
    [11, 6],
    [6, 1],
    [6, 7],
    [10, 1],
    [4, 2],
    [4, 6],
    [12, 7],
    [5, 2],
    [3, 7],
    [1, 10],
  ]

  test.each(illegal)('rejects %i -> %i', (from, to) => {
    expect(canTransition(from, to)).toBe(false)
  })

  test('Invoiced and Cancelled are terminal and cannot be resurrected', () => {
    expect(ALLOWED_TRANSITIONS[11]).toEqual([])
    expect(ALLOWED_TRANSITIONS[6]).toEqual([])
    expect(isTerminal(11)).toBe(true)
    expect(isTerminal(6)).toBe(true)
  })

  test('dispatch needs the dispatch permission, cancellation needs approve', () => {
    expect(transitionPermission(7)).toBe('workorder:dispatch')
    expect(transitionPermission(6)).toBe('workorder:approve')
    expect(transitionPermission(2)).toBe('workorder:write')
  })
})
