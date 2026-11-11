/**
 * The trigger route's shared-secret gate and its response contract
 * (ADR 0012 §5). No database: these cases are decided before any query.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { verifyJobSecret } from './auth.server'
import { Route } from '../../../routes/api/internal/jobs/$key'

const SECRET = 'test-job-runner-secret'

type PostHandler = (input: { request: Request; params: { key: string } }) => Promise<Response>

const post = (
  Route.options as unknown as {
    server?: { handlers?: { POST?: PostHandler } }
  }
).server?.handlers?.POST

function request(
  headers: Record<string, string> = {},
  url = 'http://localhost/api/internal/jobs/x',
): Request {
  return new Request(url, { method: 'POST', headers })
}

const originalSecret = process.env.JOB_RUNNER_SECRET

afterEach(() => {
  if (originalSecret === undefined) delete process.env.JOB_RUNNER_SECRET
  else process.env.JOB_RUNNER_SECRET = originalSecret
})

describe('verifyJobSecret', () => {
  test('503 when the secret is not configured', async () => {
    const response = verifyJobSecret(request(), {})
    expect(response?.status).toBe(503)
    expect(response?.headers.get('cache-control')).toBe('no-store')
    await expect(response?.json()).resolves.toEqual({
      error: 'JOB_RUNNER_SECRET is not configured.',
    })
  })

  test('403 when the header is missing', () => {
    expect(verifyJobSecret(request(), { JOB_RUNNER_SECRET: SECRET })?.status).toBe(403)
  })

  test('403 when the header is wrong', async () => {
    const response = verifyJobSecret(request({ 'x-job-secret': 'nope' }), {
      JOB_RUNNER_SECRET: SECRET,
    })
    expect(response?.status).toBe(403)
    await expect(response?.json()).resolves.toEqual({ error: 'Forbidden.' })
  })

  test('null when the header matches', () => {
    expect(
      verifyJobSecret(request({ 'x-job-secret': SECRET }), { JOB_RUNNER_SECRET: SECRET }),
    ).toBeNull()
  })
})

describe('POST /api/internal/jobs/$key', () => {
  test('the route exposes a POST handler', () => {
    expect(post).toBeTypeOf('function')
  })

  test('503 when JOB_RUNNER_SECRET is unset', async () => {
    delete process.env.JOB_RUNNER_SECRET
    const response = await post?.({
      request: request(),
      params: { key: 'platform.notifications-drain' },
    })
    expect(response?.status).toBe(503)
    expect(response?.headers.get('cache-control')).toBe('no-store')
  })

  test('403 on a wrong secret, before any job lookup', async () => {
    process.env.JOB_RUNNER_SECRET = SECRET
    const response = await post?.({
      request: request({ 'x-job-secret': 'wrong' }),
      params: { key: 'platform.notifications-drain' },
    })
    expect(response?.status).toBe(403)
  })

  test('404 for a key that is not in the catalogue', async () => {
    process.env.JOB_RUNNER_SECRET = SECRET
    const response = await post?.({
      request: request({ 'x-job-secret': SECRET }),
      params: { key: 'does.not-exist' },
    })
    expect(response?.status).toBe(404)
    expect(response?.headers.get('cache-control')).toBe('no-store')
    await expect(response?.json()).resolves.toEqual({ error: "Unknown job 'does.not-exist'." })
  })
})
