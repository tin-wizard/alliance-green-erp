/**
 * Shared-secret gate for the job trigger route (ADR 0012 §5).
 *
 * Modelled on `/api/cron/compliance-expiry`: `503` when the secret is not
 * configured (a plainly broken deployment), `403` on a missing or wrong header,
 * `cache-control: no-store` on every answer. Extracted from the route so the
 * three cases can be tested without a server.
 */
import { timingSafeEqual } from 'node:crypto'

const SECRET_HEADER = 'x-job-secret'

function refuse(message: string, status: number): Response {
  return Response.json({ error: message }, { status, headers: { 'cache-control': 'no-store' } })
}

/** Constant-time comparison; length is the only thing that leaks. */
function secretMatches(provided: string, expected: string): boolean {
  const left = Buffer.from(provided, 'utf8')
  const right = Buffer.from(expected, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/**
 * Returns the response that must be sent when the request is not authorised,
 * or `null` when it may proceed.
 *
 * `env` is injectable so a test can present a missing, wrong and correct secret
 * without mutating the process environment for other tests.
 */
export function verifyJobSecret(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
): Response | null {
  const secret = env.JOB_RUNNER_SECRET
  if (!secret) {
    return refuse('JOB_RUNNER_SECRET is not configured.', 503)
  }
  const provided = request.headers.get(SECRET_HEADER)
  if (!provided || !secretMatches(provided, secret)) {
    return refuse('Forbidden.', 403)
  }
  return null
}
