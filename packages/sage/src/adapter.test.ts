import { describe, expect, test } from 'vitest'
import { isSageError } from './errors'
import { UnconfiguredSageAdapter } from './fake'
import { createFakeSageApi } from './testing/fake-api'
import { buildHarness } from './testing/harness'
import {
  purchaseCreditNotePayload,
  purchaseInvoicePayload,
  salesInvoicePayload,
} from './testing/payloads'

type Harness = ReturnType<typeof buildHarness>

function posts(h: Harness): number {
  return h.api.calls.filter((call) => call.method === 'POST' && !call.path.endsWith('token')).length
}

/** Runs a call that must fail and returns the Sage error's code and kind. */
async function failure(fn: () => Promise<unknown>): Promise<{ code: string; kind: string }> {
  try {
    await fn()
  } catch (error) {
    if (isSageError(error)) return { code: error.code, kind: error.kind }
    throw error
  }
  throw new Error('Expected the call to fail with a SageError, but it succeeded.')
}

describe('SageCloudAdapter — posting', () => {
  test('creates a sales invoice with the documented shape and our reference', async () => {
    const h = buildHarness()
    const outcome = await h.adapter.postSalesInvoice(salesInvoicePayload)

    expect(outcome.duplicate).toBe(false)
    expect(outcome.externalId).toBe('sales_invoices_1')
    expect(posts(h)).toBe(1)

    const record = h.api.ledger.get('sales_invoices')?.[0]
    expect(record?.reference).toBe('cls:sales_invoice:1')
    expect(record?.contact_id).toBe('contact_1')
    const lines = record?.invoice_lines as Record<string, unknown>[]
    expect(lines).toHaveLength(1)
    expect(lines[0]?.ledger_account_id).toBe('account_sales')
    expect(lines[0]?.tax_rate_id).toBe('tax_13')
  })

  test('a second attempt finds its own document instead of posting twice', async () => {
    const h = buildHarness()
    await h.adapter.postSalesInvoice(salesInvoicePayload)
    const second = await h.adapter.postSalesInvoice(salesInvoicePayload)

    expect(second.duplicate).toBe(true)
    expect(second.externalId).toBe('sales_invoices_1')
    expect(posts(h)).toBe(1)
    expect(h.api.ledger.get('sales_invoices')).toHaveLength(1)
  })

  test('a timeout after the server committed yields one document, not two', async () => {
    const h = buildHarness()
    h.api.timeoutAfterCommit(1)

    expect((await failure(() => h.adapter.postSalesInvoice(salesInvoicePayload))).kind).toBe(
      'retryable',
    )
    // The record landed even though the response did not.
    expect(h.api.ledger.get('sales_invoices')).toHaveLength(1)

    const retry = await h.adapter.postSalesInvoice(salesInvoicePayload)
    expect(retry.duplicate).toBe(true)
    expect(h.api.ledger.get('sales_invoices')).toHaveLength(1)
  })

  test('a 429 is a quota error', async () => {
    const h = buildHarness()
    h.api.failNext(1, 429)
    expect((await failure(() => h.adapter.postSalesInvoice(salesInvoicePayload))).kind).toBe('quota')
  })

  test('three consecutive server errors pause posting, and nothing is attempted', async () => {
    const h = buildHarness()
    h.api.failNext(3, 500)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await failure(() => h.adapter.postSalesInvoice(salesInvoicePayload))).kind).toBe(
        'retryable',
      )
    }
    const report = await h.pause.report()
    expect(report.reason).toBe('server_errors')

    const before = posts(h)
    expect((await failure(() => h.adapter.postSalesInvoice(salesInvoicePayload))).kind).toBe(
      'paused',
    )
    expect(posts(h)).toBe(before)
  })

  test('a 422 is permanent, and a rejection rate above 5% pauses the queue', async () => {
    const h = buildHarness()
    h.api.failNext(5, 422)
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await failure(() => h.adapter.postSalesInvoice(salesInvoicePayload))).kind).toBe(
        'permanent',
      )
    }
    const report = await h.pause.report()
    expect(report.reason).toBe('rejections')
    expect(report.message).toContain('rejected')
  })

  test('an exhausted daily quota pauses before the next call', async () => {
    const h = buildHarness({ quotaLimit: 1 })
    expect((await failure(() => h.adapter.postSalesInvoice(salesInvoicePayload))).kind).toBe('paused')
  })

  test('an unmatched contact is a permanent error and no POST is made', async () => {
    const h = buildHarness()
    expect(
      (
        await failure(() =>
          h.adapter.postSalesInvoice({ ...salesInvoicePayload, customerName: 'Nobody Ltd' }),
        )
      ).code,
    ).toBe('CONTACT_NOT_LINKED')
    expect(posts(h)).toBe(0)
  })

  test('a missing tax rate is permanent and names the rate', async () => {
    const h = buildHarness()
    const result = await failure(() =>
      h.adapter.postSalesInvoice({
        ...salesInvoicePayload,
        lines: salesInvoicePayload.lines.map((line) => ({ ...line, taxRate: '13.5' })),
      }),
    )
    expect(result.code).toBe('TAX_RATE_NOT_MAPPED')
    expect(posts(h)).toBe(0)
  })

  test('a product line resolves the product instead of the fallback account', async () => {
    const h = buildHarness({
      api: { products: [{ id: 'product_1', itemCode: 'LIT-100' }] },
    })
    await h.adapter.postPurchaseInvoice(purchaseInvoicePayload)
    const record = h.api.ledger.get('purchase_invoices')?.[0]
    const lines = record?.invoice_lines as Record<string, unknown>[]
    expect(lines[0]?.product_id).toBe('product_1')
    expect(lines[0]?.ledger_account_id).toBeUndefined()
  })

  test('a purchase credit note posts to its own collection', async () => {
    const h = buildHarness()
    const outcome = await h.adapter.postPurchaseCreditNote(purchaseCreditNotePayload)
    expect(outcome.duplicate).toBe(false)
    expect(h.api.ledger.get('purchase_credit_notes')).toHaveLength(1)
    expect(h.api.ledger.get('purchase_credit_notes')?.[0]?.reference).toBe('cls:rga_credit:12')
    expect(h.api.ledger.get('purchase_invoices')).toBeUndefined()
  })
})

describe('SageCloudAdapter — tokens and health', () => {
  test('a 401 refreshes once and the posting succeeds', async () => {
    const h = buildHarness()
    await h.adapter.findSalesInvoice('cls:sales_invoice:1')
    h.api.expireAccessToken()
    const outcome = await h.adapter.postSalesInvoice(salesInvoicePayload)
    expect(outcome.duplicate).toBe(false)
    expect(h.api.calls.some((call) => call.path.endsWith('token'))).toBe(true)
  })

  test('a rejected refresh lands on needs_reauth and pauses with that reason', async () => {
    const h = buildHarness()
    h.api.killRefreshToken()
    h.api.expireAccessToken()
    expect((await failure(() => h.adapter.postSalesInvoice(salesInvoicePayload))).kind).toBe('auth')
    const report = await h.pause.report()
    expect(report.reason).toBe('needs_reauth')
    const status = await h.adapter.health()
    expect(status.status).toBe('needs_reauth')
  })

  test('health reports the quota and the token age without a network call', async () => {
    const h = buildHarness()
    const callsBefore = h.api.calls.length
    const health = await h.adapter.health()
    expect(health.status).toBe('verified')
    expect(health.tokenAgeDays).toBe(0)
    expect(health.quota.limit).toBe(2500)
    expect(health.businessId).toBe('business_1')
    expect(h.api.calls.length).toBe(callsBefore)
  })

  test('an unconfigured adapter says so and makes no call', async () => {
    const api = createFakeSageApi()
    const adapter = new UnconfiguredSageAdapter({
      status: 'disconnected',
      message: 'Not configured.',
      environment: 'sandbox',
    })
    const health = await adapter.health()
    expect(health.status).toBe('disconnected')
    expect(health.tokenAgeDays).toBeNull()
    expect(api.calls).toHaveLength(0)
  })
})
