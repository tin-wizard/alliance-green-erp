import { describe, expect, it } from 'vitest'
import type { Executor } from '@cls/db'
import { writeAudit } from './audit'

describe('writeAudit', () => {
  it('records the permission checked inside after, not a username', async () => {
    let captured: Record<string, unknown> | undefined
    const executor = {
      insert: () => ({
        values: (value: Record<string, unknown>) => {
          captured = value
          return Promise.resolve()
        },
      }),
    } as unknown as Executor

    await writeAudit(executor, {
      action: 'invoice.calculate',
      actorLabel: 'carmen',
      actorRole: 'admin',
      permission: 'invoice.calculate',
      summary: 'Calculated invoice totals',
    })

    expect(captured?.after).toEqual({ permission: 'invoice.calculate' })
    expect(captured?.action).toBe('invoice.calculate')
  })

  it('preserves business details alongside the permission', async () => {
    let captured: Record<string, unknown> | undefined
    const executor = {
      insert: () => ({
        values: (value: Record<string, unknown>) => {
          captured = value
          return Promise.resolve()
        },
      }),
    } as unknown as Executor

    await writeAudit(executor, {
      action: 'invoice.calculate',
      permission: 'invoice.calculate',
      after: { total: '1234.50' },
    })

    expect(captured?.after).toEqual({ total: '1234.50', permission: 'invoice.calculate' })
  })

  it('leaves after null when there is no permission or business detail', async () => {
    let captured: Record<string, unknown> | undefined
    const executor = {
      insert: () => ({
        values: (value: Record<string, unknown>) => {
          captured = value
          return Promise.resolve()
        },
      }),
    } as unknown as Executor

    await writeAudit(executor, { action: 'auth.logout' })
    expect(captured?.after).toBeNull()
  })
})
