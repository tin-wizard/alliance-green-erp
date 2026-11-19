/**
 * The scheduled endpoints share one gate.
 *
 * Two callers exist: a host scheduler sending `x-cron-secret`, and Vercel Cron,
 * which sends the project's `CRON_SECRET` environment variable as
 * `Authorization: Bearer …`. Both compare against the same expected secret, so
 * the platform copy of `CRON_SECRET` must equal `SAGE_CRON_SECRET`.
 *
 * `503` when the secret is unset (a deployment that forgot it must not accept
 * anonymous triggers), `403` on mismatch. Constant-time comparison, because a
 * secret check that leaks its prefix length is not a check.
 */
import { timingSafeEqual } from 'node:crypto'

export function assertCronSecret(
  request: Request,
  secret = process.env.SAGE_CRON_SECRET,
): Response | null {
  if (!secret) {
    return Response.json(
      { error: 'SAGE_CRON_SECRET is not configured.' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }
  const authorization = request.headers.get('authorization') ?? ''
  const bearer = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice('bearer '.length)
    : ''
  const provided = request.headers.get('x-cron-secret') ?? bearer
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
