/**
 * Sage invoice posting boundary.
 *
 * The production adapter is not chosen yet (SAGE-CLOUD §1.2), so the rebuild
 * ships a deterministic fake behind the same interface. Callers never post
 * inline: the invoice writes a queued `sage_postings` row and a worker calls
 * this gateway.
 */
import { createHash } from 'node:crypto'

export interface SageInvoiceLine {
  description: string
  quantity: string
  unitPrice: string
  taxRate: string
  lineTotal: string
  partNumber?: string | null
}

export interface SageSalesInvoicePayload {
  externalRef: string
  invoiceNumber: string
  workOrderNumber: string
  customerName: string
  invoiceDate: string
  taxProvince: string
  subtotal: string
  tax: string
  total: string
  lines: SageInvoiceLine[]
}

export interface SagePurchaseInvoicePayload {
  externalRef: string
  invoiceNumber: string
  workOrderNumber: string
  supplierName: string
  invoiceDate: string
  taxProvince: string
  subtotal: string
  tax: string
  total: string
  lines: SageInvoiceLine[]
}

export interface SagePostingOutcome {
  externalId: string
  /** True when the external reference was already present and was linked. */
  duplicate: boolean
}

export interface SageInvoiceGateway {
  readonly name: string
  postSalesInvoice(payload: SageSalesInvoicePayload): Promise<SagePostingOutcome>
  postPurchaseInvoice(payload: SagePurchaseInvoicePayload): Promise<SagePostingOutcome>
  findSalesInvoice(externalRef: string): Promise<string | null>
}

function fakeId(prefix: string, externalRef: string): string {
  return `${prefix}-${createHash('sha256').update(externalRef).digest('hex').slice(0, 12).toUpperCase()}`
}

/**
 * In-memory gateway. Idempotent by external reference, and can be made
 * unreachable so tests prove the invoice still issues while posting waits.
 */
export class FakeSageInvoiceGateway implements SageInvoiceGateway {
  readonly name = 'fake'
  readonly #sales = new Map<string, string>()
  readonly #purchases = new Map<string, string>()
  #reachable: boolean

  constructor(options: { reachable?: boolean } = {}) {
    this.#reachable = options.reachable ?? true
  }

  setReachable(value: boolean): void {
    this.#reachable = value
  }

  async findSalesInvoice(externalRef: string): Promise<string | null> {
    if (!this.#reachable) throw new Error('Sage is unreachable.')
    return this.#sales.get(externalRef) ?? null
  }

  async postSalesInvoice(payload: SageSalesInvoicePayload): Promise<SagePostingOutcome> {
    if (!this.#reachable) throw new Error('Sage is unreachable.')
    const existing = this.#sales.get(payload.externalRef)
    if (existing) return { externalId: existing, duplicate: true }
    const externalId = fakeId('FAKE-SI', payload.externalRef)
    this.#sales.set(payload.externalRef, externalId)
    return { externalId, duplicate: false }
  }

  async postPurchaseInvoice(payload: SagePurchaseInvoicePayload): Promise<SagePostingOutcome> {
    if (!this.#reachable) throw new Error('Sage is unreachable.')
    const existing = this.#purchases.get(payload.externalRef)
    if (existing) return { externalId: existing, duplicate: true }
    const externalId = fakeId('FAKE-PI', payload.externalRef)
    this.#purchases.set(payload.externalRef, externalId)
    return { externalId, duplicate: false }
  }
}

let gateway: SageInvoiceGateway = new FakeSageInvoiceGateway()

export function getSageInvoiceGateway(): SageInvoiceGateway {
  return gateway
}

export function setSageInvoiceGateway(next: SageInvoiceGateway): void {
  gateway = next
}

export function resetSageInvoiceGateway(): void {
  gateway = new FakeSageInvoiceGateway()
}
