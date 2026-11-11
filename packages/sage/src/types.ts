/**
 * Sage 50 adapter boundary.
 *
 * The legacy system reaches Sage through Sage 50's own embedded MySQL server:
 * `mysql_connect('localhost:13541', 'sageuser', …)`, then `USE simply`, then the
 * sentinel `SELECT lId FROM tvendor WHERE lId = 663 AND sName = 'SagePort'`.
 * The sentinel port is tried first (13541), then 13540, 13542, 13543, 13544.
 * See `green-system/MODULES.md` §11 and docs/adr/0005-sage-adapter.md.
 *
 * Discovery and connection verification live here. Business reads and writes
 * (invoices, journals, inventory) belong to the Sage module that will consume
 * this adapter; they are deliberately absent.
 *
 * Nothing outside this package may import `node:net`/`mysql2` or read SAGE_*
 * env vars.
 */

export interface SageEndpoint {
  host: string
  port: number
  /**
   * True when the `tvendor` sentinel answered on this port, which is the only
   * acceptance test the legacy system uses. False means only a TCP listener
   * was found (no credentials configured), so the company is unconfirmed.
   */
  verified: boolean
}

export interface SageConnectionInfo {
  endpoint: SageEndpoint
  database: string
  serverVersion: string
  connectedAt: Date
}

export type SageHealthStatus =
  | 'disabled'
  | 'unreachable'
  | 'unverified'
  | 'verified'
  | 'error'

export interface SageHealth {
  status: SageHealthStatus
  checkedAt: Date
  endpoint: SageEndpoint | null
  database: string
  message: string
}

export interface SageAdapter {
  readonly name: string
  /** Ordered probe; returns the first port whose company answers the sentinel. */
  discover(): Promise<SageEndpoint | null>
  /** Opens and verifies a connection. Throws; never fakes success. */
  connect(endpoint?: SageEndpoint): Promise<SageConnectionInfo>
  disconnect(): Promise<void>
  health(): Promise<SageHealth>
}

/**
 * Legacy probe order. 13541 is tried first because that is where the production
 * company listens; the rest are fallbacks.
 */
export const DEFAULT_SAGE_PORTS = [13541, 13540, 13542, 13543, 13544] as const
export const DEFAULT_SAGE_DATABASE = 'simply'

/** Marker row that identifies the CLS company inside a Sage MySQL server. */
export const SAGE_SENTINEL_VENDOR_ID = 663
export const SAGE_SENTINEL_VENDOR_NAME = 'SagePort'
export const SAGE_SENTINEL_SQL = 'SELECT lId FROM tvendor WHERE lId = ? AND sName = ?'
