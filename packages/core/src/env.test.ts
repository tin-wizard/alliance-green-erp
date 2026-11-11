import { describe, expect, it } from 'vitest'
import { envSchema } from './env.server'

describe('envSchema', () => {
  it('applies documented defaults', () => {
    const parsed = envSchema.parse({ NODE_ENV: 'test' })
    expect(parsed.HOST).toBe('0.0.0.0')
    expect(parsed.PORT).toBe(3000)
    expect(parsed.SESSION_TTL_HOURS).toBe(12)
    expect(parsed.SAGE_ENVIRONMENT).toBe('sandbox')
    expect(parsed.SAGE_API_BASE_URL).toBe('https://api.accounting.sage.com/v3.1')
    expect(parsed.SAGE_DAILY_QUOTA).toBe(2500)
    expect(parsed.SAGE_ENABLED).toBe(false)
  })

  it('parses the cloud Sage credentials and quotas', () => {
    const parsed = envSchema.parse({
      SAGE_ENABLED: 'true',
      SAGE_CLIENT_ID: 'client',
      SAGE_CLIENT_SECRET: 'secret',
      SAGE_REDIRECT_URI: 'https://app.example/api/sage/oauth/callback',
      SAGE_TOKEN_ENC_KEY: 'a'.repeat(64),
      SAGE_DAILY_QUOTA: '1500',
      SAGE_MINUTE_QUOTA: '90',
    })
    expect(parsed.SAGE_ENABLED).toBe(true)
    expect(parsed.SAGE_DAILY_QUOTA).toBe(1500)
    expect(parsed.SAGE_MINUTE_QUOTA).toBe(90)
    expect(parsed.SAGE_TOKEN_URL).toBe('https://oauth.accounting.sage.com/token')
  })

  it('strips a trailing slash from the API base URL', () => {
    const parsed = envSchema.parse({ SAGE_API_BASE_URL: 'https://api.example/v3.1/' })
    expect(parsed.SAGE_API_BASE_URL).toBe('https://api.example/v3.1')
  })

  it('rejects an unknown Sage environment', () => {
    expect(envSchema.safeParse({ SAGE_ENVIRONMENT: 'staging' }).success).toBe(false)
  })

  it('coerces numeric strings', () => {
    const parsed = envSchema.parse({ PORT: '8080', SESSION_TTL_HOURS: '8' })
    expect(parsed.PORT).toBe(8080)
    expect(parsed.SESSION_TTL_HOURS).toBe(8)
  })

  it('rejects an invalid APP_URL', () => {
    expect(envSchema.safeParse({ APP_URL: 'not-a-url' }).success).toBe(false)
  })

  it('treats empty DATABASE_URL as unset', () => {
    const parsed = envSchema.parse({ DATABASE_URL: '' })
    expect(parsed.DATABASE_URL).toBeUndefined()
  })

  it('accepts true/1 for flags and rejects anything else', () => {
    expect(envSchema.parse({ SAGE_ENABLED: 'true' }).SAGE_ENABLED).toBe(true)
    expect(envSchema.parse({ SAGE_ENABLED: '1' }).SAGE_ENABLED).toBe(true)
    expect(envSchema.parse({ SAGE_ENABLED: 'yes' }).SAGE_ENABLED).toBe(false)
  })
})
