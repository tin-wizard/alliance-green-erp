import { describe, expect, test } from 'vitest'
import { ALL_PERMISSIONS, type PermissionKey } from '@cls/core'
import { PO_STATUSES, type PurchaseOrderStatus } from '../types'
import {
  PO_STATUS_LABELS,
  PO_TRANSITIONS,
  canTransitionPurchaseOrder,
  illegalTransitionMessage,
  isPurchaseOrderStatus,
  TERMINAL_PO_STATUSES,
  purchaseOrderCapabilities as capabilities,
  transitionPermission,
} from './status'

describe('purchase-order status table', () => {
  test('every one of the 121 status pairs agrees with the transition table', () => {
    for (const from of PO_STATUSES) {
      for (const to of PO_STATUSES) {
        const legal = PO_TRANSITIONS[from].includes(to)
        expect(canTransitionPurchaseOrder(from, to)).toBe(legal)
        if (!legal) {
          expect(illegalTransitionMessage(from, to)).toContain(PO_STATUS_LABELS[from])
          expect(illegalTransitionMessage(from, to)).toContain(PO_STATUS_LABELS[to])
        }
      }
    }
  })

  test('the legal edges are exactly the documented ones', () => {
    expect(PO_TRANSITIONS).toEqual({
      1: [3, 7, 8, 2, 10],
      2: [3, 5, 4, 6, 10],
      3: [7, 8, 2, 10],
      4: [11, 10],
      5: [5, 4, 10],
      6: [2, 5, 4, 10],
      7: [8, 9, 3, 10],
      8: [2, 3, 7, 10],
      9: [3, 7, 10],
      10: [],
      11: [],
    })
  })

  test('terminal statuses never move', () => {
    for (const status of [10, 11] as const) {
      expect(TERMINAL_PO_STATUSES).toContain(status)
      for (const to of PO_STATUSES) {
        expect(canTransitionPurchaseOrder(status, to)).toBe(false)
      }
    }
    for (const status of PO_STATUSES.filter((s) => s !== 10 && s !== 11)) {
      expect(TERMINAL_PO_STATUSES).not.toContain(status)
    }
  })

  test('action permissions follow the capability model, not usernames', () => {
    expect(transitionPermission(7, 8)).toBe('po.approve')
    expect(transitionPermission(7, 9)).toBe('po.approve')
    expect(transitionPermission(8, 2)).toBe('po.issue')
    expect(transitionPermission(4, 11)).toBe('invoice:issue')
    expect(transitionPermission(5, 4)).toBe('po.approve')
    expect(transitionPermission(5, 10)).toBe('po.approve')
    expect(transitionPermission(2, 3)).toBe('po.approve')
    expect(transitionPermission(3, 7)).toBe('purchasing:write')
    expect(transitionPermission(1, 3)).toBe('purchasing:write')
    for (const from of PO_STATUSES) {
      for (const to of PO_TRANSITIONS[from]) {
        expect(ALL_PERMISSIONS).toContain<PermissionKey>(transitionPermission(from, to))
      }
    }
  })

  test('status vocabulary covers 1..11 and capabilities only expose legal actions', () => {
    for (const status of PO_STATUSES) {
      expect(isPurchaseOrderStatus(status)).toBe(true)
      expect(PO_STATUS_LABELS[status]).toBeTruthy()
    }
    expect(isPurchaseOrderStatus(0)).toBe(false)
    expect(isPurchaseOrderStatus(12)).toBe(false)
    expect(typeof capabilities).toBe('function')

    const all = new Set<string>(ALL_PERMISSIONS as readonly string[])
    const draft = capabilities(
      { status: 3, isTransfer: false },
      all,
    )
    expect(draft.canEdit).toBe(true)
    expect(draft.canRequestApproval).toBe(true)
    expect(draft.canReceive).toBe(false)

    const approved = capabilities(
      { status: 8, isTransfer: false },
      all,
    )
    expect(approved.canIssue).toBe(true)
    expect(approved.canEdit).toBe(true)

    const received = capabilities(
      { status: 4, isTransfer: false },
      all,
    )
    expect(received.canShortClose).toBe(false)
    expect(received.canCancel).toBe(true)

    const partial = capabilities(
      { status: 5, isTransfer: false },
      all,
    )
    expect(partial.canShortClose).toBe(true)

    const cancelled = capabilities(
      { status: 10, isTransfer: false },
      all,
    )
    expect(Object.values(cancelled).every((value) => value === false)).toBe(true)
  })

  test('a status number outside 1..11 is not a purchase-order status', () => {
    const values: number[] = [-1, 0, 12, 99]
    for (const value of values) {
      expect((PO_STATUSES as readonly number[]).includes(value)).toBe(false)
    }
    expect(PO_STATUSES).toHaveLength(11)
    expect([...PO_STATUSES] as PurchaseOrderStatus[]).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ])
  })
})
