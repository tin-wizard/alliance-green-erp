import net from 'node:net'
import mysql from 'mysql2/promise'
import type { RowDataPacket } from 'mysql2'
import {
  SageNotConfiguredError,
  SageUnavailableError,
} from '@cls/core'
import { logger } from '@cls/core/logger'
import {
  SAGE_SENTINEL_SQL,
  SAGE_SENTINEL_VENDOR_ID,
  SAGE_SENTINEL_VENDOR_NAME,
  type SageAdapter,
  type SageConnectionInfo,
  type SageEndpoint,
  type SageHealth,
} from './types'

export interface LegacyPortScanOptions {
  enabled: boolean
  host: string
  /** Ordered. The legacy system tries 13541 first, then 13540, 13542–13544. */
  ports: number[]
  database: string
  user: string | undefined
  password: string | undefined
  connectTimeoutMs: number
  /** Cache window for health() so a status check does not scan on every call. */
  healthCacheMs?: number
}

/**
 * Probe one TCP endpoint. Resolves true only on a completed TCP connect.
 * Never rejects: a closed port, a timeout and a DNS failure are all "not here".
 */
export function probePort(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false

    const finish = (reachable: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(reachable)
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, host)
  })
}

interface Sentinels {
  user: string | undefined
  password: string | undefined
  database: string
  connectTimeoutMs: number
}

/**
 * The legacy acceptance test: connect over the MySQL protocol, select `simply`,
 * and require the `SagePort` vendor row. A bare TCP accept proves nothing —
 * another service can hold the port — so this is the only test that counts.
 * Never throws; a failure is simply "not this port".
 */
export async function verifySageSentinel(
  host: string,
  port: number,
  options: Sentinels,
): Promise<boolean> {
  if (!options.user || !options.password) return false

  let connection: mysql.Connection | undefined
  try {
    connection = await mysql.createConnection({
      host,
      port,
      user: options.user,
      password: options.password,
      database: options.database,
      connectTimeout: options.connectTimeoutMs,
      multipleStatements: false,
    })
    const [rows] = await connection.query<RowDataPacket[]>(SAGE_SENTINEL_SQL, [
      SAGE_SENTINEL_VENDOR_ID,
      SAGE_SENTINEL_VENDOR_NAME,
    ])
    return rows.length > 0
  } catch (error) {
    logger.debug('Sage sentinel probe failed', {
      port,
      reason: error instanceof Error ? error.message : String(error),
    })
    return false
  } finally {
    await connection?.end().catch(() => undefined)
  }
}

interface ScanOutcome {
  endpoint: SageEndpoint | null
  reachablePorts: number[]
  sentinelChecked: boolean
}

/**
 * Implements the legacy discovery mechanism: try each configured port in order,
 * accept the first one whose company contains the `SagePort` sentinel row.
 *
 * Without credentials the sentinel cannot be checked. In that case the adapter
 * still reports the first TCP listener, but marks it `verified: false` and never
 * claims the endpoint is a Sage company.
 */
export class LegacyPortScanAdapter implements SageAdapter {
  readonly name = 'legacy-port-scan'

  private readonly options: Required<LegacyPortScanOptions>
  private cachedHealth: SageHealth | undefined
  private cachedAt = 0
  private connection: mysql.Connection | undefined

  constructor(options: LegacyPortScanOptions) {
    this.options = {
      healthCacheMs: 30_000,
      ...options,
    }
  }

  private get canVerify(): boolean {
    return Boolean(this.options.user && this.options.password)
  }

  private async scan(): Promise<ScanOutcome> {
    if (!this.options.enabled) {
      return { endpoint: null, reachablePorts: [], sentinelChecked: false }
    }

    const reachablePorts: number[] = []
    for (const port of this.options.ports) {
      const reachable = await probePort(
        this.options.host,
        port,
        this.options.connectTimeoutMs,
      )
      if (!reachable) continue
      reachablePorts.push(port)

      if (!this.canVerify) {
        return {
          endpoint: { host: this.options.host, port, verified: false },
          reachablePorts,
          sentinelChecked: false,
        }
      }

      const verified = await verifySageSentinel(this.options.host, port, {
        user: this.options.user,
        password: this.options.password,
        database: this.options.database,
        connectTimeoutMs: this.options.connectTimeoutMs,
      })
      if (verified) {
        return {
          endpoint: { host: this.options.host, port, verified: true },
          reachablePorts,
          sentinelChecked: true,
        }
      }
    }

    return {
      endpoint: null,
      reachablePorts,
      sentinelChecked: this.canVerify && reachablePorts.length > 0,
    }
  }

  async discover(): Promise<SageEndpoint | null> {
    if (!this.options.enabled) return null
    const outcome = await this.scan()
    if (outcome.endpoint?.verified) {
      logger.info('Sage endpoint discovered', {
        host: outcome.endpoint.host,
        port: outcome.endpoint.port,
      })
    } else if (outcome.endpoint) {
      logger.warn('Sage port is open but the company is unverified', {
        host: outcome.endpoint.host,
        port: outcome.endpoint.port,
        reason: 'SAGE_USER/SAGE_PASSWORD not set',
      })
    } else {
      logger.warn('Sage endpoint not found', {
        host: this.options.host,
        ports: this.options.ports,
        reachablePorts: outcome.reachablePorts,
      })
    }
    return outcome.endpoint
  }

  async connect(endpoint?: SageEndpoint): Promise<SageConnectionInfo> {
    if (!this.options.enabled) {
      throw new SageUnavailableError('Sage integration is disabled (SAGE_ENABLED=false).')
    }
    if (!this.canVerify) {
      throw new SageNotConfiguredError(
        'SAGE_USER and SAGE_PASSWORD are required to connect to Sage.',
      )
    }

    const target = endpoint ?? (await this.scan()).endpoint
    if (!target) {
      throw new SageUnavailableError(
        `No Sage company answered the ${SAGE_SENTINEL_VENDOR_NAME} sentinel on ${this.options.host} ports ${this.options.ports.join(', ')}.`,
      )
    }

    await this.disconnect()
    const connection = await mysql.createConnection({
      host: target.host,
      port: target.port,
      user: this.options.user,
      password: this.options.password,
      database: this.options.database,
      connectTimeout: this.options.connectTimeoutMs,
      multipleStatements: false,
    })

    try {
      const [rows] = await connection.query<RowDataPacket[]>(SAGE_SENTINEL_SQL, [
        SAGE_SENTINEL_VENDOR_ID,
        SAGE_SENTINEL_VENDOR_NAME,
      ])
      if (rows.length === 0) {
        throw new SageUnavailableError(
          `Port ${target.port} accepted a MySQL connection but is not the CLS company (no ${SAGE_SENTINEL_VENDOR_NAME} vendor).`,
        )
      }
      const [versionRows] = await connection.query<RowDataPacket[]>('SELECT VERSION() AS version')
      this.connection = connection
      return {
        endpoint: { host: target.host, port: target.port, verified: true },
        database: this.options.database,
        serverVersion: String(versionRows[0]?.version ?? 'unknown'),
        connectedAt: new Date(),
      }
    } catch (error) {
      await connection.end().catch(() => undefined)
      if (error instanceof SageUnavailableError) throw error
      throw new SageUnavailableError(
        error instanceof Error ? `Sage connection failed: ${error.message}` : 'Sage connection failed.',
      )
    }
  }

  async disconnect(): Promise<void> {
    const connection = this.connection
    this.connection = undefined
    await connection?.end().catch(() => undefined)
  }

  async health(): Promise<SageHealth> {
    const now = Date.now()
    if (this.cachedHealth && now - this.cachedAt < this.options.healthCacheMs) {
      return this.cachedHealth
    }

    let health: SageHealth
    if (!this.options.enabled) {
      health = {
        status: 'disabled',
        checkedAt: new Date(now),
        endpoint: null,
        database: this.options.database,
        message: 'Sage integration is disabled (SAGE_ENABLED=false).',
      }
    } else {
      const outcome = await this.scan()
      if (outcome.endpoint?.verified) {
        health = {
          status: 'verified',
          checkedAt: new Date(now),
          endpoint: outcome.endpoint,
          database: this.options.database,
          message: `Connected company confirmed on ${outcome.endpoint.host}:${outcome.endpoint.port}.`,
        }
      } else if (outcome.endpoint) {
        health = {
          status: 'unverified',
          checkedAt: new Date(now),
          endpoint: outcome.endpoint,
          database: this.options.database,
          message: `A listener answers on port ${outcome.endpoint.port}, but the company cannot be verified without SAGE_USER/SAGE_PASSWORD.`,
        }
      } else if (outcome.sentinelChecked) {
        health = {
          status: 'error',
          checkedAt: new Date(now),
          endpoint: null,
          database: this.options.database,
          message: `Ports ${outcome.reachablePorts.join(', ')} answer, but none contains the ${SAGE_SENTINEL_VENDOR_NAME} vendor. Is Sage running the right company?`,
        }
      } else {
        health = {
          status: 'unreachable',
          checkedAt: new Date(now),
          endpoint: null,
          database: this.options.database,
          message: `No Sage listener on ${this.options.host} ports ${this.options.ports.join(', ')}.`,
        }
      }
    }

    this.cachedHealth = health
    this.cachedAt = now
    return health
  }
}
