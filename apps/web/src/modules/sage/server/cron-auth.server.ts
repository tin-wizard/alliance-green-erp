/**
 * The drain endpoints share one gate.
 *
 * `503` when the secret is unset (a deployment that forgot it must not accept
 * anonymous triggers), `403` on mismatch. Constant-time comparison, because a
 * secret check that leaks its prefix length is not a check.
 */
import { timingSafeEqual } from 'node:crypto'

export function assertCronSecret(request: Request, header = 'x-cron-secret'): Response | null {
  const secret = process.env.SAGE_CRON_SECRET
  if (!secret) {
    return Response.json(
      { error: 'SAGE_CRON_SECRET is not configured.' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }
  const provided = request.headers.get(header) ?? ''
  if (!safeEqual(provided, secret)) {
    return Response.json(
      { error: 'Forbidden.' },
      { status: 403, headers: { 'cache-control': 'no-store' } },
    )
  }
  return null
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
