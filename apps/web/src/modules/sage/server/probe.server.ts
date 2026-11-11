/**
 * The tenant probe's app half: run it, store the capsule.
 *
 * The capsule is evidence for a human, so it is persisted with its environment,
 * business and timestamp rather than printed into a log that nobody reads.
 */
import { getDb } from '@cls/db'
import { sageProbeReports } from '@cls/db/schema'
import { assertFakeAllowed, probeTenant, SageError, type ProbeCapsule, type ProbeReader } from '@cls/sage'
import { getSageHttp, sageConfig, sageCredentialsPresent } from './gateway.server'

export interface ProbeResult {
  status: ProbeCapsule['status']
  business: ProbeCapsule['business']
  checks: ProbeCapsule['checks']
  reportId: number | null
}

/** Builds the reader the pure probe expects from the shared HTTP client. */
export function probeReader(): ProbeReader {
  const http = getSageHttp()
  return {
    async get(path) {
      const response = await http.request({ method: 'GET', path, quotaClass: 'probe' })
      return { json: response.json, headers: response.headers }
    },
  }
}

export async function runTenantProbe(options: {
  dryRun?: boolean
  reader?: ProbeReader
  now?: () => Date
} = {}): Promise<ProbeResult> {
  const config = sageConfig()
  assertFakeAllowed({
    nodeEnv: process.env.NODE_ENV,
    fake: config.fake,
    environment: config.environment,
  })
  if (!config.enabled) {
    throw new SageError('unconfigured', 'SAGE_DISABLED', 'Sage is disabled; there is no tenant to probe.')
  }
  if (!sageCredentialsPresent()) {
    throw new SageError(
      'unconfigured',
      'SAGE_NOT_CONFIGURED',
      'Sage is enabled but the developer app credentials are missing; the probe needs a connection.',
    )
  }

  const capsule = await probeTenant(options.reader ?? probeReader(), { now: options.now })

  let reportId: number | null = null
  if (!options.dryRun) {
    const [row] = await getDb()
      .insert(sageProbeReports)
      .values({
        environment: config.environment,
        businessId: capsule.business?.id ?? null,
        businessName: capsule.business?.name ?? null,
        status: capsule.status,
        runAt: capsule.observedAt,
        report: capsule as unknown as Record<string, unknown>,
      })
      .returning({ id: sageProbeReports.id })
    reportId = row?.id ?? null
  }

  return {
    status: capsule.status,
    business: capsule.business,
    checks: capsule.checks,
    reportId,
  }
}
