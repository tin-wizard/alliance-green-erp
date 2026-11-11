import { describe, expect, it } from 'vitest'
import { envSchema } from './env.server'

describe('envSchema', () => {
  it('applies documented defaults', () => {
    const parsed = envSchema.parse({ NODE_ENV: 'test' })
    expect(parsed.HOST).toBe('0.0.0.0')
    expect(parsed.PORT).toBe(3000)
    expect(parsed.SESSION_TTL_HOURS).toBe(12)
    expect(parsed.SAGE_HOST).toBe('127.0.0.1')
    expect(parsed.SAGE_PORTS).toEqual([13541, 13540, 13542, 13543, 13544])
    expect(parsed.SAGE_DATABASE).toBe('simply')
    expect(parsed.SAGE_ENABLED).toBe(false)
  })

  it('parses the legacy port list', () => {
    const parsed = envSchema.parse({ SAGE_PORTS: '13540, 13544' })
    expect(parsed.SAGE_PORTS).toEqual([13540, 13544])
  })

  it('rejects an out-of-range port', () => {
    const result = envSchema.safeParse({ SAGE_PORTS: '0,13540' })
    expect(result.success).toBe(false)
  })

  it('rejects a non-numeric port list', () => {
    const result = envSchema.safeParse({ SAGE_PORTS: 'abc' })
    expect(result.success).toBe(false)
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
