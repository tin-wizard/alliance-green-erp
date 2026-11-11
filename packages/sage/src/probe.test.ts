/**
 * The tenant probe, against a stub reader.
 *
 * The probe's job is to say what the tenant offers before anyone posts. These
 * tests pin the three answers that change the plan: a healthy tenant, a tenant
 * with stock items switched off, and a tenant that does not expose quota headers
 * (which is `unknown`, not `pass`).
 */
import { describe, expect, test } from 'vitest'
import { SageError } from './errors'
import { probeTenant, type ProbeReader, type ProbeResponse } from './probe'

const NOW = new Date('2026-11-11T06:00:00Z')
const headers = new Headers()

interface Routes {
  businesses?: unknown
  taxRates?: unknown
  ledgerAccounts?: unknown
  stockItems?: unknown
  products?: unknown
  quotaHeaders?: Record<string, string>
  failTaxRates?: 'forbidden' | 'network'
}

function reader(routes: Routes = {}): ProbeReader {
  const response = (json: unknown, extraHeaders: Record<string, string> = {}): ProbeResponse => {
    const map = new Map(Object.entries(extraHeaders).map(([key, value]) => [key.toLowerCase(), value]))
    return {
      json,
      headers: { get: (name: string) => map.get(name.toLowerCase()) ?? headers.get(name) },
    }
  }
  const list = (items: unknown[]) => ({ $items: items, $total: items.length })

  return {
    async get(path) {
      if (path.startsWith('businesses')) {
        return response(routes.businesses ?? list([{ id: 'b-1', name: 'Alliance Lighting' }]), routes.quotaHeaders)
      }
      if (path.startsWith('tax_rates')) {
        if (routes.failTaxRates === 'forbidden') {
          throw new SageError('permanent', 'SAGE_REJECTED', '403 Forbidden', { status: 403 })
        }
        if (routes.failTaxRates === 'network') throw new Error('connect ETIMEDOUT')
        return response(
          routes.taxRates ?? list([{ id: 't-1', percentage: 13, name: 'HST' }]),
        )
      }
      if (path.startsWith('ledger_accounts')) {
        return response(
          routes.ledgerAccounts ?? list([{ id: 'a-1', name: 'Sales', ledger_account_type: { displayed_as: 'Sales' } }]),
        )
      }
      if (path.startsWith('stock_items')) {
        return response(routes.stockItems ?? list([{ id: 's-1' }]))
      }
      if (path.startsWith('products')) {
        return response(routes.products ?? list([{ id: 'p-1' }]))
      }
      throw new Error(`unexpected path ${path}`)
    },
  }
}

describe('probeTenant', () => {
  test('a healthy tenant passes every check and the capsule names the business', async () => {
    const capsule = await probeTenant(
      reader({ quotaHeaders: { 'x-ratelimit-remaining': '2400', 'x-ratelimit-limit': '2500' } }),
      { now: () => NOW },
    )

    expect(capsule.status).toBe('passed')
    expect(capsule.business).toEqual({ id: 'b-1', name: 'Alliance Lighting' })
    expect(capsule.observedAt).toEqual(NOW)
    expect(capsule.checks.map((check) => check.key)).toEqual([
      'business',
      'tax_rates',
      'ledger_accounts',
      'stock_items',
      'products',
      'quota_headers',
    ])
    expect(capsule.checks.every((check) => check.status === 'pass')).toBe(true)
    expect(capsule.snapshot.quotaHeaders['x-ratelimit-limit']).toBe('2500')
    expect(capsule.snapshot.taxRates).toHaveLength(1)
  })

  test('stock items answering with zero rows still passes: the endpoint is what was probed', async () => {
    const capsule = await probeTenant(reader({ stockItems: { $items: [], $total: 0 } }), {
      now: () => NOW,
    })
    const stock = capsule.checks.find((check) => check.key === 'stock_items')
    expect(stock?.status).toBe('pass')
    expect(capsule.snapshot.stockItems).toEqual({ supported: true, total: 0 })
    expect(capsule.status).toBe('passed')
  })

  test('missing quota headers are unknown, never pass', async () => {
    const capsule = await probeTenant(reader(), { now: () => NOW })
    const quota = capsule.checks.find((check) => check.key === 'quota_headers')
    expect(quota?.status).toBe('unknown')
    expect(capsule.status).toBe('passed')
  })

  test('a refused endpoint is attention with the reason, and the rest still run', async () => {
    const capsule = await probeTenant(reader({ failTaxRates: 'forbidden' }), { now: () => NOW })
    const tax = capsule.checks.find((check) => check.key === 'tax_rates')
    expect(tax?.status).toBe('attention')
    expect(tax?.detail).toContain('403')
    expect(capsule.status).toBe('attention')
    expect(capsule.checks).toHaveLength(6)
  })

  test('a dropped connection is unknown, not attention: the tenant may still have the data', async () => {
    const capsule = await probeTenant(reader({ failTaxRates: 'network' }), { now: () => NOW })
    const tax = capsule.checks.find((check) => check.key === 'tax_rates')
    expect(tax?.status).toBe('unknown')
    expect(tax?.detail).toContain('ETIMEDOUT')
  })

  test('two visible businesses is attention: nothing is guessed', async () => {
    const capsule = await probeTenant(
      reader({
        businesses: {
          $items: [
            { id: 'b-1', name: 'Alliance Lighting' },
            { id: 'b-2', name: 'Second Company' },
          ],
          $total: 2,
        },
      }),
      { now: () => NOW },
    )
    const business = capsule.checks.find((check) => check.key === 'business')
    expect(business?.status).toBe('attention')
    expect(capsule.status).toBe('attention')
    expect(capsule.business?.id).toBe('b-1')
  })
})
