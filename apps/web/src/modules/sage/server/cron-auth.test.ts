import { afterEach, describe, expect, test } from 'vitest'
import { assertCronSecret } from './cron-auth.server'

const original = process.env.SAGE_CRON_SECRET

afterEach(() => {
  if (original === undefined) delete process.env.SAGE_CRON_SECRET
  else process.env.SAGE_CRON_SECRET = original
})

function requestWith(secret?: string): Request {
  return new Request('https://app.example/api/cron/sage-postings', {
    headers: secret === undefined ? {} : { 'x-cron-secret': secret },
  })
}

describe('cron secret gate', () => {
  test('an unset secret refuses every call with 503', async () => {
    delete process.env.SAGE_CRON_SECRET
    const response = assertCronSecret(requestWith('anything'))
    expect(response?.status).toBe(503)
  })

  test('a missing header is 403', async () => {
    process.env.SAGE_CRON_SECRET = 'correct-secret'
    const response = assertCronSecret(requestWith())
    expect(response?.status).toBe(403)
  })

  test('a wrong secret is 403', async () => {
    process.env.SAGE_CRON_SECRET = 'correct-secret'
    const response = assertCronSecret(requestWith('wrong-secret'))
    expect(response?.status).toBe(403)
  })

  test('a prefix of the secret is not accepted', async () => {
    process.env.SAGE_CRON_SECRET = 'correct-secret'
    const response = assertCronSecret(requestWith('correct'))
    expect(response?.status).toBe(403)
  })

  test('the exact secret passes and the route proceeds', async () => {
    process.env.SAGE_CRON_SECRET = 'correct-secret'
    expect(assertCronSecret(requestWith('correct-secret'))).toBeNull()
  })

  test('the refusal carries no-store so a proxy cannot cache a 403', async () => {
    process.env.SAGE_CRON_SECRET = 'correct-secret'
    const response = assertCronSecret(requestWith('wrong'))
    expect(response?.headers.get('cache-control')).toBe('no-store')
  })
})
