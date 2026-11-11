/**
 * Sage Accounting (Sage Business Cloud Accounting) adapter types.
 *
 * SERVER ONLY. Nothing here imports `node:net`, `mysql2` or the legacy Sage 50
 * discovery code; the cloud move deleted that. The two interfaces that matter:
 *
 * - `SageAdapter` — what the app asks about the connection (health, numbering).
 * - `SageInvoiceGateway` (see `invoices.ts`) — what the posting worker calls.
 *
 * `needs_reauth` is a state, not an exception: callers show "authorise the Sage
 * connection", never "something went wrong".
 */

export type SageConnectionState =
  | 'disabled' // SAGE_ENABLED=false; no calls attempted
  | 'disconnected' // enabled, never authorised
  | 'needs_reauth' // refresh token dead or revoked: a human must authorise again
  | 'verified' // token fresh, last probe succeeded
  | 'degraded' // reachable but failing calls, or quota exhausted
  | 'error' // last call failed in a way we cannot classify

/** Kept as a union member because the dashboard used it for Sage 50. */
export type SageHealthStatus = SageConnectionState | 'unverified'

export interface SageQuotaSnapshot {
  used: number
  limit: number
  resetsAt: Date
}

export interface SageHealth {
  status: SageHealthStatus
  checkedAt: Date
  environment: 'sandbox' | 'production'
  businessId: string | null
  accessTokenExpiresAt: Date | null
  refreshExpiresAt: Date | null
  /** Whole days since the last successful refresh or keep-alive. */
  tokenAgeDays: number | null
  quota: SageQuotaSnapshot
  message: string
}

export type SageDocumentType =
  | 'sales_invoice'
  | 'sales_credit_note'
  | 'purchase_invoice'
  | 'purchase_credit_note'
  | 'journal'
  | 'opening_balance'
  | 'stock_movement'

export interface PostingRequest {
  docType: SageDocumentType
  docId: string
  payload: unknown
}

export interface PostingResult {
  externalRef: string
  apiId: string
  status: 'created' | 'already_exists' | 'rejected' | 'unknown'
  apiReference?: string
  total?: string
}

/**
 * The app-facing adapter. Only `health()` and the optional `numberInUse()`
 * capability are part of it; postings go through `SageInvoiceGateway`.
 */
export interface SageAdapter {
  readonly name: string
  health(): Promise<SageHealth>
  /** True = number used, false = free, null = cannot verify. */
  numberInUse?(id: number): Promise<boolean | null>
}

/** Connection state as the token service sees it, without a network call. */
export interface ConnectionStatus {
  state: SageConnectionState
  businessId: string | null
  accessTokenExpiresAt: Date | null
  refreshExpiresAt: Date | null
  daysSinceRefresh: number | null
  message: string
}

/** Supplies bearer tokens to the HTTP client. Implemented by the token service. */
export interface AccessTokenProvider {
  getAccessToken(): Promise<string>
  /** Called on 401/403 so the provider can refresh once, then demand reauth. */
  invalidate(reason: string): Promise<void>
  status(): Promise<ConnectionStatus>
}

export type FetchLike = (
  input: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
    signal?: AbortSignal
  },
) => Promise<{
  status: number
  headers: { get(name: string): string | null }
  text(): Promise<string>
  json(): Promise<unknown>
}>
