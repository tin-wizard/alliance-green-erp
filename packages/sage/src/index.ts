/**
 * Sage boundary. Two entry points:
 *
 * - `getSageInvoiceGateway()` — the posting worker's dependency. Defaults to the
 *   in-memory fake so nothing can accidentally reach a tenant; the app swaps in
 *   the cloud adapter once credentials exist.
 * - `UnconfiguredSageAdapter` / `FakeSageAdapter` — health, with no network.
 *
 * The real adapter is constructed in the app (`apps/web/src/modules/sage`),
 * because it needs the database-backed token, quota and pause stores. This
 * package stays free of database imports so it can be tested in isolation.
 */
export * from './types'
export * from './errors'
export { parseKey, createSealer, tokenFingerprint, connectionAad, type Sealer } from './crypto'
export {
  CLASS_BUDGETS,
  DAILY_LIMIT,
  MINUTE_LIMIT,
  MemoryQuotaStore,
  MinuteBucket,
  QuotaGovernor,
  quotaPausedError,
  resetsAtFor,
  utcDayKey,
  type DailyQuotaStore,
  type QuotaClass,
  type QuotaDecision,
  type QuotaThreshold,
  type QuotaUsage,
} from './quota'
export {
  MemoryPauseStore,
  PauseGovernor,
  emptyPauseState,
  type PauseReason,
  type PauseReport,
  type PauseState,
  type PauseStore,
} from './pause'
export {
  TokenService,
  type ConnectionRepository,
  type StoredConnection,
  type TokenServiceOptions,
} from './auth/tokens'
export { SageHttp, type SageHttpOptions, type SageRequest, type SageResponse } from './client/http'
export { toCents, fromCents, mapLines, type DocumentMappingContext } from './mappers/common'
export { mapSalesInvoice, mapPurchaseInvoice, type MappedDocument } from './mappers/documents'
export { mapSalesCreditNote, mapPurchaseCreditNote } from './mappers/credit-note'
export {
  mapContactPayment,
  mapJournal,
  mapOpeningJournal,
  type ContactPaymentInput,
  type JournalInput,
  type JournalLineInput,
} from './mappers/payments'
export {
  SageCloudAdapter,
  type SageCloudAdapterOptions,
  type SageLedgerMapping,
} from './adapter'
export { FakeSageAdapter, UnconfiguredSageAdapter, assertFakeAllowed } from './fake'
export {
  FakeSageInvoiceGateway,
  getSageInvoiceGateway,
  resetSageInvoiceGateway,
  setSageInvoiceGateway,
  type SageCreditNotePayload,
  type SageInvoiceGateway,
  type SageInvoiceLine,
  type SagePostingOutcome,
  type SagePurchaseInvoicePayload,
  type SageSalesInvoicePayload,
} from './invoices'
export { createFakeSageApi, fakeApiId, type FakeSageApi, type FakeFault } from './testing/fake-api'
// Test seam: the real adapter wired to the in-memory API, for contract tests.
export { buildHarness } from './testing/harness'
