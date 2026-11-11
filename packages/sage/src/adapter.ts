/**
 * The real adapter: documented Sage Accounting v3.1 over HTTPS.
 *
 * It is written to be exercised without a tenant. Every dependency that would
 * touch the network, the clock, the database or the quota ledger is injected, so
 * the tests drive it through an in-memory API that speaks the same shapes and
 * the invoicing suite runs against it unchanged.
 *
 * Two rules the code below is arranged around:
 *   1. Refuse, never fake. Missing contact, missing tax rate, missing account or
 *      an unresolved business is a permanent, named error; there is no silent
 *      fallback and no call is made.
 *   2. Search before create. The search runs on every attempt, not only after a
 *      timeout, because it costs one cheap call and the alternative is a
 *      duplicate invoice in the client's books.
 */
import { SageError } from './errors'
import type { PauseGovernor } from './pause'
import type { QuotaGovernor } from './quota'
import type { SageHttp } from './client/http'
import type {
  AccessTokenProvider,
  SageAdapter,
  SageHealth,
  SageHealthStatus,
} from './types'
import type {
  SageCreditNotePayload,
  SageInvoiceGateway,
  SagePostingOutcome,
  SagePurchaseInvoicePayload,
  SageSalesInvoicePayload,
} from './invoices'
import type { DocumentMappingContext } from './mappers/common'
import { mapPurchaseInvoice, mapSalesInvoice, type MappedDocument } from './mappers/documents'
import { taxPercent } from './mappers/common'
import { mapPurchaseCreditNote } from './mappers/credit-note'

export interface SageLedgerMapping {
  /** Account for lines that are not catalogued products (labour, services). */
  salesAccountId?: string | null
  purchaseAccountId?: string | null
  /** Account for the explicit rounding line; unset means a difference blocks. */
  roundingAccountId?: string | null
}

export interface SageCloudAdapterOptions {
  http: SageHttp
  tokens: AccessTokenProvider
  quota: QuotaGovernor
  pause: PauseGovernor
  environment: 'sandbox' | 'production'
  ledger: SageLedgerMapping
  now?: () => Date
  /** Called once per threshold or pause transition so the app can write a finding. */
  onFinding?: (finding: { code: string; message: string }) => void
}

interface Cached<T> {
  value: T
  expiresAt: number
}

const HOUR = 60 * 60 * 1000

export class SageCloudAdapter implements SageAdapter, SageInvoiceGateway {
  readonly name = 'sage-cloud'
  readonly #options: SageCloudAdapterOptions
  readonly #now: () => Date
  readonly #contacts = new Map<string, Cached<string>>()
  readonly #taxRates = new Map<string, Cached<string>>()
  readonly #products = new Map<string, Cached<string | null>>()

  constructor(options: SageCloudAdapterOptions) {
    this.#options = options
    this.#now = options.now ?? (() => new Date())
  }

  async postSalesInvoice(payload: SageSalesInvoicePayload): Promise<SagePostingOutcome> {
    return this.#run(async () => {
      await this.#assertReady()
      await this.#prepareLines(payload.lines)
      const context = await this.#contextFor(payload.customerName, 'sales')
      const mapped = mapSalesInvoice(payload, context)
      if (mapped.roundingAdded) {
        this.#options.onFinding?.({
          code: 'ROUNDING_LINE_ADDED',
          message: `Invoice ${payload.externalRef} needed an explicit rounding line.`,
        })
      }
      return this.#post(mapped, 'sales_invoices')
    })
  }

  async postPurchaseInvoice(payload: SagePurchaseInvoicePayload): Promise<SagePostingOutcome> {
    return this.#run(async () => {
      await this.#assertReady()
      await this.#prepareLines(payload.lines)
      const context = await this.#contextFor(payload.supplierName, 'purchase')
      const mapped = mapPurchaseInvoice(payload, context)
      if (mapped.roundingAdded) {
        this.#options.onFinding?.({
          code: 'ROUNDING_LINE_ADDED',
          message: `Bill ${payload.externalRef} needed an explicit rounding line.`,
        })
      }
      return this.#post(mapped, 'purchase_invoices')
    })
  }

  async postPurchaseCreditNote(payload: SageCreditNotePayload): Promise<SagePostingOutcome> {
    return this.#run(async () => {
      await this.#assertReady()
      await this.#prepareLines(payload.lines)
      const context = await this.#contextFor(payload.contactName, 'purchase')
      const mapped = mapPurchaseCreditNote(payload, context)
      if (mapped.roundingAdded) {
        this.#options.onFinding?.({
          code: 'ROUNDING_LINE_ADDED',
          message: `Credit note ${payload.externalRef} needed an explicit rounding line.`,
        })
      }
      return this.#post(mapped, 'purchase_credit_notes')
    })
  }

  async findSalesInvoice(externalRef: string): Promise<string | null> {
    return this.#run(async () => {
      await this.#assertReady()
      return this.#findByReference('sales_invoices', externalRef)
    })
  }

  async #run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (error) {
      await this.#noteFailure(error)
      throw error
    }
  }

  async health(): Promise<SageHealth> {
    const [status, quota, pause] = await Promise.all([
      this.#options.tokens.status(),
      this.#options.quota.snapshot(),
      this.#options.pause.report(),
    ])

    let healthStatus: SageHealthStatus
    let message = status.message
    if (pause.paused) {
      healthStatus = pause.reason === 'needs_reauth' ? 'needs_reauth' : 'degraded'
      message = pause.message
    } else if (status.state === 'needs_reauth') {
      healthStatus = 'needs_reauth'
    } else if (status.state === 'disconnected') {
      healthStatus = 'disconnected'
    } else if (status.state === 'error') {
      healthStatus = 'error'
    } else if (status.state === 'degraded') {
      healthStatus = 'degraded'
    } else {
      healthStatus = 'verified'
    }

    return {
      status: healthStatus,
      checkedAt: this.#now(),
      environment: this.#options.environment,
      businessId: status.businessId,
      accessTokenExpiresAt: status.accessTokenExpiresAt,
      refreshExpiresAt: status.refreshExpiresAt,
      tokenAgeDays: status.daysSinceRefresh,
      quota,
      message,
    }
  }

  /** Throws `paused` when a condition is active, so nothing is even attempted. */
  async #assertReady(): Promise<void> {
    const pause = await this.#options.pause.report()
    if (pause.paused) {
      throw new SageError('paused', `SAGE_PAUSED_${pause.reason?.toUpperCase() ?? 'UNKNOWN'}`, pause.message)
    }
  }

  async #post(mapped: MappedDocument, collection: string): Promise<SagePostingOutcome> {
    const existing = await this.#findByReference(collection, mapped.reference)
    if (existing) return { externalId: existing, duplicate: true }

    try {
      const response = await this.#options.http.request({
        method: 'POST',
        path: collection,
        body: mapped.body,
        quotaClass: 'posting',
      })
      return { externalId: this.#idOf(response.json, mapped.reference), duplicate: false }
    } catch (error) {
      if (error instanceof SageError && error.kind === 'conflict') {
        // 409 means somebody — probably an earlier attempt of ours — created it.
        const found = await this.#findByReference(collection, mapped.reference)
        if (found) return { externalId: found, duplicate: true }
      }
      throw error
    }
  }

  /**
   * One place records what a failure means for the queue. Called by every public
   * posting method, so a 401 during a contact lookup pauses the same way a 401
   * during the POST does.
   */
  async #noteFailure(error: unknown): Promise<void> {
    if (!(error instanceof SageError)) return
    if (error.kind === 'retryable') {
      await this.#options.pause.noteServerError()
      const transitioned = await this.#options.pause.report()
      if (transitioned.paused) {
        this.#options.onFinding?.({ code: 'SAGE_PAUSED', message: transitioned.message })
      }
    } else if (error.kind === 'permanent') {
      await this.#options.pause.noteRejection()
      const transitioned = await this.#options.pause.report()
      if (transitioned.paused) {
        this.#options.onFinding?.({ code: 'SAGE_REJECTION_RATE', message: transitioned.message })
      }
    } else if (error.kind === 'auth') {
      await this.#options.pause.pause(
        'needs_reauth',
        'Sage rejected the credentials; a human must authorise the connection again.',
      )
    } else if (error.kind === 'quota') {
      this.#options.quota.noteRateLimited()
    }
  }

  async #findByReference(collection: string, reference: string): Promise<string | null> {
    const envelope = await this.#options.http.get(
      `${collection}?search=${encodeURIComponent(reference)}&items_per_page=20`,
      'posting',
    )
    const items = itemsOf(envelope)
    const match = items.find((item) => String(item.reference ?? '') === reference)
    if (!match) return null
    return this.#idOf(match, reference)
  }

  /**
   * Resolves every tax rate and product the payload needs, once, so the mapper
   * stays a pure function. A missing rate or product is refused here with a
   * named error rather than becoming an unresolved id in a request body.
   */
  async #prepareLines(lines: { taxRate: string; partNumber?: string | null }[]): Promise<void> {
    for (const line of lines) {
      await this.#resolveTaxRateId(line.taxRate)
      if (line.partNumber) await this.#resolveProductId(line.partNumber)
    }
  }

  async #contextFor(
    contactName: string,
    kind: 'sales' | 'purchase',
  ): Promise<DocumentMappingContext> {
    const contactId = await this.#resolveContact(contactName)
    return {
      contactId,
      ledgerAccountId:
        kind === 'sales'
          ? (this.#options.ledger.salesAccountId ?? null)
          : (this.#options.ledger.purchaseAccountId ?? null),
      roundingLedgerAccountId: this.#options.ledger.roundingAccountId ?? null,
      taxRateIdFor: (percent) => {
        const cached = this.#taxRates.get(String(taxPercent(percent)))
        if (!cached) {
          throw new SageError(
            'permanent',
            'TAX_RATE_NOT_MAPPED',
            `The tenant has no tax rate for ${percent}%.`,
          )
        }
        return cached.value
      },
      productIdFor: (partNumber) => {
        return this.#products.get(partNumber.trim().toLowerCase())?.value ?? null
      },
    }
  }

  async #resolveContact(contactName: string): Promise<string> {
    const key = contactName.trim().toLowerCase()
    const cached = this.#contacts.get(key)
    if (cached && cached.expiresAt > this.#now().getTime()) return cached.value
    const envelope = await this.#options.http.get(
      `contacts?search=${encodeURIComponent(contactName)}&items_per_page=20`,
      'posting',
    )
    const match = itemsOf(envelope).find(
      (item) => String(item.name ?? '').trim().toLowerCase() === key,
    )
    if (!match) {
      throw new SageError(
        'permanent',
        'CONTACT_NOT_LINKED',
        `No Sage contact matches "${contactName}". Link the customer or supplier before posting; a new contact would duplicate the ledger.`,
      )
    }
    const id = this.#idOf(match, contactName)
    this.#contacts.set(key, { value: id, expiresAt: this.#now().getTime() + HOUR })
    return id
  }

  async #resolveTaxRateId(raw: string): Promise<string> {
    const key = String(taxPercent(raw))
    const cached = this.#taxRates.get(key)
    if (cached && cached.expiresAt > this.#now().getTime()) return cached.value
    const envelope = await this.#options.http.get('tax_rates?items_per_page=100', 'posting')
    const match = itemsOf(envelope).find((item) => Number(item.percentage) === Number(key))
    if (!match) {
      throw new SageError(
        'permanent',
        'TAX_RATE_NOT_MAPPED',
        `The tenant has no tax rate for ${key}%. Map the rate in Sage before posting.`,
      )
    }
    const id = this.#idOf(match, `tax ${key}`)
    this.#taxRates.set(key, { value: id, expiresAt: this.#now().getTime() + HOUR })
    return id
  }

  async #resolveProductId(partNumber: string): Promise<string | null> {
    const key = partNumber.trim().toLowerCase()
    const cached = this.#products.get(key)
    if (cached && cached.expiresAt > this.#now().getTime()) return cached.value
    const envelope = await this.#options.http.get(
      `products?search=${encodeURIComponent(partNumber)}&items_per_page=20`,
      'posting',
    )
    const match = itemsOf(envelope).find(
      (item) => String(item.item_code ?? '').trim().toLowerCase() === key,
    )
    const id = match ? this.#idOf(match, partNumber) : null
    this.#products.set(key, { value: id, expiresAt: this.#now().getTime() + HOUR })
    return id
  }

  #idOf(json: unknown, label: string): string {
    const record = json as Record<string, unknown> | null
    const id = record?.id
    if (typeof id === 'string' && id.length > 0) return id
    if (typeof id === 'number') return String(id)
    throw new SageError(
      'retryable',
      'SAGE_RESPONSE_SHAPE',
      `Sage accepted "${label}" but the response carried no id; the search on the next attempt will settle it.`,
    )
  }
}

function itemsOf(json: unknown): Record<string, unknown>[] {
  const record = json as Record<string, unknown> | null
  const items = record?.$items ?? record?.items
  return Array.isArray(items) ? (items as Record<string, unknown>[]) : []
}
