/**
 * The tenant probe (`SAGE-CLOUD.md` §1.4, step 9 of the wiring checklist).
 *
 * It is the first thing to run after consent, and it answers the questions that
 * decide how the conversion and posting behave — with the tenant's own answers,
 * not ours:
 *
 * | Question | Endpoint | Why it changes the plan |
 * |---|---|---|
 * | Which company is this? | `/businesses` | posting to the wrong books cannot be reconciled away |
 * | What tax rates exist? | `/tax_rates` | a missing rate is a permanent refusal per document |
 * | Which ledger accounts? | `/ledger_accounts` | the mappers need sales, purchases and a rounding account |
 * | Are stock items enabled? | `/stock_items` | decides whether posting moves stock or we post movements |
 * | Does the response expose quota? | headers | the reset boundary is an assumption until the tenant says otherwise |
 *
 * The capsule is evidence, not configuration: it is stored with its timestamp and
 * shown to a human, who then sets the account ids and processes the result.
 */
import { SageError } from './errors'

export interface ProbeHeaders {
  get(name: string): string | null
}

export interface ProbeResponse {
  json: unknown
  headers: ProbeHeaders
}

export interface ProbeReader {
  get(path: string): Promise<ProbeResponse>
}

export type ProbeCheckStatus = 'pass' | 'attention' | 'unknown'

export interface ProbeCheck {
  key: string
  label: string
  status: ProbeCheckStatus
  detail: string
  data?: unknown
}

export interface ProbeCapsule {
  status: 'passed' | 'attention'
  observedAt: Date
  business: { id: string; name: string } | null
  checks: ProbeCheck[]
  snapshot: {
    taxRates: { id: string; percentage: string; name?: string }[]
    ledgerAccounts: { id: string; name: string; type?: string }[]
    stockItems: { supported: boolean; total: number | null }
    products: { total: number | null }
    quotaHeaders: Record<string, string>
  }
}

function itemsOf(json: unknown): Record<string, unknown>[] {
  const record = json as Record<string, unknown> | null
  const items = record?.$items ?? record?.items
  return Array.isArray(items) ? (items as Record<string, unknown>[]) : []
}

function totalOf(json: unknown): number | null {
  const record = json as Record<string, unknown> | null
  const total = record?.$total ?? record?.total
  if (typeof total === 'number') return total
  return null
}

async function attempt(
  key: string,
  label: string,
  fn: () => Promise<{ check: ProbeCheck; data?: unknown }>,
): Promise<ProbeCheck> {
  try {
    return (await fn()).check
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status: ProbeCheckStatus =
      error instanceof SageError && error.kind === 'permanent' ? 'attention' : 'unknown'
    return { key, label, status, detail: message }
  }
}

export async function probeTenant(
  reader: ProbeReader,
  options: { now?: () => Date } = {},
): Promise<ProbeCapsule> {
  const now = options.now ?? (() => new Date())
  const checks: ProbeCheck[] = []
  const snapshot: ProbeCapsule['snapshot'] = {
    taxRates: [],
    ledgerAccounts: [],
    stockItems: { supported: false, total: null },
    products: { total: null },
    quotaHeaders: {},
  }
  let business: ProbeCapsule['business'] = null

  const businesses = await reader.get('businesses?items_per_page=10')
  const businessItems = itemsOf(businesses.json)
  if (businessItems.length > 0) {
    const first = businessItems[0]!
    business = { id: String(first.id ?? ''), name: String(first.name ?? '') }
  }

  checks.push(
    await attempt('business', 'Business reachable and identified', async () => {
      const list = itemsOf(businesses.json)
      if (list.length === 0) {
        return {
          check: {
            key: 'business',
            label: 'Business reachable and identified',
            status: 'attention',
            detail: 'The connection works but the app can see no business. Check the developer app scopes.',
          },
        }
      }
      if (list.length > 1) {
        return {
          check: {
            key: 'business',
            label: 'Business reachable and identified',
            status: 'attention',
            detail: `${list.length} businesses are visible; one must be chosen before posting.`,
            data: list.map((item) => ({ id: item.id, name: item.name })),
          },
        }
      }
      return {
        check: {
          key: 'business',
          label: 'Business reachable and identified',
          status: 'pass',
          detail: `Connected to ${String(list[0]!.name ?? list[0]!.id ?? 'the business')}.`,
        },
      }
    }),
  )

  checks.push(
    await attempt('tax_rates', 'Tax rates available', async () => {
      const response = await reader.get('tax_rates?items_per_page=100')
      const rates = itemsOf(response.json).map((rate) => ({
        id: String(rate.id ?? ''),
        percentage: String(rate.percentage ?? ''),
        name: rate.name === undefined ? undefined : String(rate.name),
      }))
      snapshot.taxRates = rates
      if (rates.length === 0) {
        return {
          check: {
            key: 'tax_rates',
            label: 'Tax rates available',
            status: 'attention',
            detail: 'No tax rates exist. Every posting would be refused as TAX_RATE_NOT_MAPPED.',
          },
        }
      }
      return {
        check: {
          key: 'tax_rates',
          label: 'Tax rates available',
          status: 'pass',
          detail: `${rates.length} rate(s): ${rates.map((rate) => `${rate.percentage}%`).join(', ')}.`,
          data: rates,
        },
      }
    }),
  )

  checks.push(
    await attempt('ledger_accounts', 'Ledger accounts readable', async () => {
      const response = await reader.get('ledger_accounts?items_per_page=100')
      const accounts = itemsOf(response.json).map((account) => {
        const type = account.ledger_account_type as Record<string, unknown> | undefined
        return {
          id: String(account.id ?? ''),
          name: String(account.name ?? ''),
          type: type ? String(type.displayed_as ?? type.name ?? '') : undefined,
        }
      })
      snapshot.ledgerAccounts = accounts
      if (accounts.length === 0) {
        return {
          check: {
            key: 'ledger_accounts',
            label: 'Ledger accounts readable',
            status: 'attention',
            detail: 'No ledger accounts were returned; the mappers cannot name a sales or purchase account.',
          },
        }
      }
      return {
        check: {
          key: 'ledger_accounts',
          label: 'Ledger accounts readable',
          status: 'pass',
          detail: `${accounts.length} account(s) readable.`,
        },
      }
    }),
  )

  checks.push(
    await attempt('stock_items', 'Stock items enabled', async () => {
      const response = await reader.get('stock_items?items_per_page=1')
      const total = totalOf(response.json)
      const count = total ?? itemsOf(response.json).length
      snapshot.stockItems = { supported: true, total }
      return {
        check: {
          key: 'stock_items',
          label: 'Stock items enabled',
          status: 'pass',
          detail:
            count > 0
              ? `Stock items are enabled (${count} on the tenant).`
              : 'The stock-items endpoint answers but the tenant has no stock items.',
          data: { total },
        },
      }
    }),
  )

  checks.push(
    await attempt('products', 'Product catalogue readable', async () => {
      const response = await reader.get('products?items_per_page=1')
      const total = totalOf(response.json)
      snapshot.products = { total }
      return {
        check: {
          key: 'products',
          label: 'Product catalogue readable',
          status: 'pass',
          detail: total === null ? 'Products are readable.' : `${total} product(s).`,
        },
      }
    }),
  )

  checks.push(
    await attempt('quota_headers', 'Quota headers exposed', async () => {
      const names = [
        'x-ratelimit-remaining',
        'x-ratelimit-limit',
        'x-ratelimit-reset',
        'ratelimit-remaining',
        'ratelimit-reset',
      ]
      const found: Record<string, string> = {}
      for (const name of names) {
        const value = businesses.headers.get(name)
        if (value !== null) found[name] = value
      }
      snapshot.quotaHeaders = found
      if (Object.keys(found).length === 0) {
        return {
          check: {
            key: 'quota_headers',
            label: 'Quota headers exposed',
            status: 'unknown',
            detail:
              'The tenant does not expose quota headers; the UTC reset boundary stays an assumption and the guard keeps its own counter.',
          },
        }
      }
      return {
        check: {
          key: 'quota_headers',
          label: 'Quota headers exposed',
          status: 'pass',
          detail: `Quota headers present: ${Object.keys(found).join(', ')}.`,
          data: found,
        },
      }
    }),
  )

  const status = checks.some((check) => check.status === 'attention') ? 'attention' : 'passed'
  return { status, observedAt: now(), business, checks, snapshot }
}
