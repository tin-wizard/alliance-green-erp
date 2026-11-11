import { getConfig } from '@cls/core/env.server'
import { LegacyPortScanAdapter } from './legacy-port-scan'
import type { SageAdapter } from './types'

export * from './types'
export { LegacyPortScanAdapter, probePort, type LegacyPortScanOptions } from './legacy-port-scan'

let adapter: SageAdapter | undefined

/**
 * The application resolves Sage through this function and nowhere else.
 * Configuration is read once from the validated env (ADR 0005).
 */
export function getSageAdapter(): SageAdapter {
  if (!adapter) {
    const sage = getConfig().sage
    adapter = new LegacyPortScanAdapter({
      enabled: sage.enabled,
      host: sage.host,
      ports: sage.ports,
      database: sage.database,
      user: sage.user,
      password: sage.password,
      connectTimeoutMs: sage.connectTimeoutMs,
    })
  }
  return adapter
}

export function setSageAdapterForTests(next: SageAdapter | undefined): void {
  adapter = next
}
