/**
 * An in-memory Sage Accounting API that speaks the documented v3.1 shapes.
 *
 * It is the test double for the real HTTP client: the adapter, the mappers, the
 * quota code and the classification all run for real, only the socket is fake.
 * That is what lets the invoicing integration suite run unchanged against both
 * the fake gateway and the real-shape adapter.
 *
 * It also drives the failure paths that matter: a 429, a 500, a commit followed
 * by a timeout, a 422 and an expired access token.
 */
import type { FetchLike } from '../types'
import { createHash } from 'node:crypto'

export type FakeFault = 429 | 500 | 422 | 401 | 409

export interface FakeSageApiOptions {
  contacts?: { id: string; name: string }[]
  taxRates?: { id: string; percentage: number }[]
  products?: { id: string; itemCode: string }[]
}

export interface FakeSageApi {
  fetch: FetchLike
  contacts: { id: string; name: string }[]
  ledger: Map<string, Record<string, unknown>[]>
  calls: { method: string; path: string; body: string | null }[]
  /** Queue faults for the next N POSTs (or any method when `all`). */
  failNext(count: number, fault: FakeFault, options?: { all?: boolean }): void
  /** Succeed at the server, then fail the response: the classic duplicate trap. */
  timeoutAfterCommit(count: number): void
  expireAccessToken(): void
  killRefreshToken(): void
  addRecord(collection: string, record: Record<string, unknown>): void
  reset(): void
}

interface Fault {
  count: number
  status: FakeFault
  all: boolean
}

export function createFakeSageApi(options: FakeSageApiOptions = {}): FakeSageApi {
  const contacts = options.contacts ?? [
    { id: 'contact_1', name: 'Alliance Lighting' },
    { id: 'contact_2', name: 'Northline Electric' },
    { id: 'contact_vendor_1', name: 'Liteline Supply' },
  ]
  const taxRates = options.taxRates ?? [
    { id: 'tax_5', percentage: 5 },
    { id: 'tax_13', percentage: 13 },
    { id: 'tax_15', percentage: 15 },
  ]
  const products = options.products ?? []
  const ledger = new Map<string, Record<string, unknown>[]>()
  const calls: FakeSageApi['calls'] = []
  const faults: Fault[] = []
  const timeouts: { count: number }[] = []
  let accessToken = 'fake_access_0'
  let refreshToken = 'fake_refresh_0'
  let counter = 0
  let accessValid = true

  const api: FakeSageApi = {
    contacts,
    ledger,
    calls,
    fetch: async (input, init) => {
      const url = new URL(input)
      const method = init?.method ?? 'GET'
      const path = url.pathname.replace(/^\/v3\.1\//, '').replace(/^\//, '')
      const body = init?.body ?? null
      calls.push({ method, path: `${path}${url.search}`, body })

      // OAuth token endpoint.
      if (path.endsWith('token')) {
        const params = new URLSearchParams(body ?? '')
        if (params.get('grant_type') === 'refresh_token') {
          if (params.get('refresh_token') !== refreshToken) {
            return respond(400, { error: 'invalid_grant' })
          }
        }
        counter += 1
        accessToken = `fake_access_${counter}`
        refreshToken = `fake_refresh_${counter}`
        accessValid = true
        return respond(200, {
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_in: 300,
          token_type: 'Bearer',
        })
      }

      if (path === 'businesses') {
        return respond(200, { $items: [{ id: 'business_1', name: 'Alliance Lighting' }] })
      }

      if (!accessValid || (init?.headers?.authorization ?? '') !== `Bearer ${accessToken}`) {
        return respond(401, { message: 'expired token' })
      }

      const fault = takeFault(method)
      if (fault === 429) {
        return respond(429, { message: 'rate limited' }, { 'retry-after': '1' })
      }
      if (fault === 500) return respond(500, { message: 'server error' })
      if (fault === 422) return respond(422, { message: 'validation failed', $errors: [] })
      if (fault === 409) return respond(409, { message: 'conflict' })
      if (fault === 401) {
        accessValid = false
        return respond(401, { message: 'expired token' })
      }

      if (path === 'contacts') return search(contacts.map((c) => ({ ...c })), url)
      if (path === 'tax_rates') {
        return respond(200, {
          $items: taxRates.map((rate) => ({ id: rate.id, percentage: String(rate.percentage) })),
        })
      }
      if (path === 'products') {
        return respond(200, {
          $items: products.map((product) => ({ id: product.id, item_code: product.itemCode })),
        })
      }

      const collection = path.split('/')[0] ?? ''
      if (!ledger.has(collection)) ledger.set(collection, [])
      const records = ledger.get(collection)!

      if (method === 'GET') return search(records, url)

      const envelope = JSON.parse(body ?? '{}') as Record<string, Record<string, unknown>>
      const payload = envelope[collection.replace(/s$/, '')] ?? Object.values(envelope)[0] ?? {}
      const id = `${collection}_${records.length + 1}`
      const record = { ...payload, id, __collection: collection }
      records.push(record)

      const timeout = takeTimeout()
      if (timeout) return respond(503, { message: 'gateway timeout' })
      return respond(201, record)
    },
    failNext(count, status, opts) {
      faults.push({ count, status, all: opts?.all ?? false })
    },
    timeoutAfterCommit(count) {
      timeouts.push({ count })
    },
    expireAccessToken() {
      accessValid = false
    },
    killRefreshToken() {
      refreshToken = 'revoked'
    },
    addRecord(collection, record) {
      if (!ledger.has(collection)) ledger.set(collection, [])
      ledger.get(collection)!.push(record)
    },
    reset() {
      ledger.clear()
      calls.length = 0
      faults.length = 0
      timeouts.length = 0
      accessValid = true
    },
  }

  function takeFault(method: string): FakeFault | null {
    const index = faults.findIndex((fault) => fault.all || method === 'POST')
    if (index === -1) return null
    const fault = faults[index]!
    fault.count -= 1
    if (fault.count <= 0) faults.splice(index, 1)
    return fault.status
  }

  function takeTimeout(): boolean {
    const entry = timeouts[0]
    if (!entry) return false
    entry.count -= 1
    if (entry.count <= 0) timeouts.shift()
    return true
  }

  return api
}

function search(records: Record<string, unknown>[], url: URL): Response {
  const term = (url.searchParams.get('search') ?? '').toLowerCase()
  const page = records.filter((record) => {
    if (!term) return true
    return Object.values(record).some(
      (value) => typeof value === 'string' && value.toLowerCase().includes(term),
    )
  })
  return respond(200, { $items: page, $total: page.length })
}

function respond(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  const text = JSON.stringify(body)
  return new Response(text, {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

/** Deterministic opaque ids, used by the fake gateway and by tests. */
export function fakeApiId(prefix: string, reference: string): string {
  return `${prefix}-${createHash('sha256').update(reference).digest('hex').slice(0, 12).toUpperCase()}`
}
