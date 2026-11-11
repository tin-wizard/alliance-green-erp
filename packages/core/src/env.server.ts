/**
 * Server-side configuration.
 *
 * SERVER ONLY. Imported by the DB, auth and Sage packages, never by a React
 * component or anything that can reach the browser bundle.
 *
 * Precedence: real process env > .env file next to the repo > documented
 * defaults. Missing required values fail loudly at startup; a missing database
 * URL does not, because the shell and /api/health must boot without Neon.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { logger, setLogLevel } from './logger'

const optionalText = z
  .string()
  .optional()
  .transform((value) => (value && value.trim() !== '' ? value.trim() : undefined))

const flag = z
  .string()
  .optional()
  .transform((value) => value === 'true' || value === '1')

const portList = z
  .string()
  .optional()
  .transform((value, ctx) => {
    const raw = value && value.trim() !== '' ? value : '13541,13540,13542,13543,13544'
    const ports = raw
      .split(',')
      .map((part) => Number.parseInt(part.trim(), 10))
      .filter((port) => Number.isInteger(port))
    if (ports.length === 0 || ports.some((port) => port < 1 || port > 65535)) {
      ctx.addIssue({ code: 'custom', message: 'must be 1-5 comma-separated TCP ports' })
      return z.NEVER
    }
    return ports
  })

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_URL: z.url().default('http://localhost:3000'),

  DATABASE_URL: optionalText,
  DATABASE_URL_UNPOOLED: optionalText,

  SESSION_SECRET: optionalText,
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  SESSION_COOKIE_SECURE: flag,

  SAGE_ENABLED: flag,
  SAGE_HOST: z.string().default('127.0.0.1'),
  SAGE_PORTS: portList,
  SAGE_DATABASE: z.string().default('simply'),
  SAGE_USER: optionalText,
  SAGE_PASSWORD: optionalText,
  SAGE_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(50).max(10_000).default(750),

  NEON_AUTH_BASE_URL: optionalText,
  NEON_AUTH_JWKS_URL: optionalText,

  AWS_ENDPOINT_URL_S3: optionalText,
  AWS_ACCESS_KEY_ID: optionalText,
  AWS_SECRET_ACCESS_KEY: optionalText,
  AWS_REGION: z.string().default('us-east-2'),
  STORAGE_DRIVER: z.enum(['auto', 's3', 'local']).default('auto'),
  S3_BUCKET: z.string().min(1).default('assets'),
  S3_ACCOUNTING_BUCKET: z.string().min(1).default('accounting'),
  STORAGE_LOCAL_DIR: z.string().min(1).default('.data/storage'),

  AI_ENABLED: flag,
  NEON_AI_GATEWAY_BASE_URL: optionalText,
  NEON_AI_GATEWAY_TOKEN: optionalText,
  AI_DEFAULT_MODEL: z.string().min(1).default('claude-haiku-4-5'),

  SEED_ADMIN_EMAIL: optionalText,
  SEED_ADMIN_USERNAME: z.string().min(3).default('admin'),
  SEED_ADMIN_DISPLAY_NAME: z.string().min(1).default('Administrator'),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
})

export type RawEnv = z.infer<typeof envSchema>

export interface SageConfig {
  enabled: boolean
  host: string
  ports: number[]
  database: string
  user: string | undefined
  password: string | undefined
  connectTimeoutMs: number
}

export interface AppConfig {
  nodeEnv: RawEnv['NODE_ENV']
  isProduction: boolean
  host: string
  port: number
  appUrl: string
  databaseUrl: string | undefined
  databaseUrlUnpooled: string | undefined
  session: {
    secret: string
    ttlHours: number
    cookieSecure: boolean
    cookieName: string
  }
  sage: SageConfig
  seedAdmin: {
    email: string | undefined
    username: string
    displayName: string
  }
  neonAuth: {
    baseUrl: string | undefined
    jwksUrl: string | undefined
  }
  storage: {
    driver: 'auto' | 's3' | 'local'
    bucket: string
    accountingBucket: string
    localDir: string
    endpoint: string | undefined
    region: string
    accessKeyId: string | undefined
    secretAccessKey: string | undefined
  }
  ai: {
    enabled: boolean
    baseUrl: string | undefined
    token: string | undefined
    defaultModel: string
  }
  logLevel: RawEnv['LOG_LEVEL']
}

const COOKIE_NAME = 'cls_session'

let loaded = false
let cached: AppConfig | undefined

function loadDotEnv(): void {
  if (loaded) return
  loaded = true
  if (process.env.DATABASE_URL && process.env.SESSION_SECRET) return

  const here = (() => {
    try {
      return fileURLToPath(new URL('.', import.meta.url))
    } catch {
      return process.cwd()
    }
  })()

  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
    resolve(here, '../../../.env'),
  ]
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    try {
      // Node >= 20.12. Existing process env wins over file values.
      ;(process as unknown as { loadEnvFile: (path: string) => void }).loadEnvFile(candidate)
      return
    } catch {
      // A malformed .env must not be silently half-applied; fall through and
      // let schema parsing report what is missing.
    }
  }
}

let warnedEphemeralSecret = false

function buildConfig(): AppConfig {
  loadDotEnv()
  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid environment configuration:\n${problems}`)
  }
  const env = parsed.data

  let secret = env.SESSION_SECRET
  if (!secret) {
    if (env.NODE_ENV === 'production') {
      throw new Error(
        'SESSION_SECRET is required in production. Generate one with:\n' +
          '  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
      )
    }
    secret = randomBytes(48).toString('base64url')
    if (!warnedEphemeralSecret) {
      warnedEphemeralSecret = true
      logger.warn('SESSION_SECRET is not set; using an ephemeral development secret. Sessions end on restart.')
    }
  }
  if (secret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters.')
  }

  return {
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    host: env.HOST,
    port: env.PORT,
    appUrl: env.APP_URL.replace(/\/$/, ''),
    databaseUrl: env.DATABASE_URL,
    databaseUrlUnpooled: env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL,
    session: {
      secret,
      ttlHours: env.SESSION_TTL_HOURS,
      cookieSecure: env.SESSION_COOKIE_SECURE,
      cookieName: COOKIE_NAME,
    },
    sage: {
      enabled: env.SAGE_ENABLED,
      host: env.SAGE_HOST,
      ports: env.SAGE_PORTS,
      database: env.SAGE_DATABASE,
      user: env.SAGE_USER,
      password: env.SAGE_PASSWORD,
      connectTimeoutMs: env.SAGE_CONNECT_TIMEOUT_MS,
    },
    seedAdmin: {
      // Deliberately optional: a default address would let anyone who signs up
      // with it claim the bootstrap admin row. See ADR 0004.
      email: env.SEED_ADMIN_EMAIL,
      username: env.SEED_ADMIN_USERNAME,
      displayName: env.SEED_ADMIN_DISPLAY_NAME,
    },
    neonAuth: {
      baseUrl: env.NEON_AUTH_BASE_URL,
      jwksUrl: env.NEON_AUTH_JWKS_URL,
    },
    storage: {
      driver: env.STORAGE_DRIVER,
      bucket: env.S3_BUCKET,
      accountingBucket: env.S3_ACCOUNTING_BUCKET,
      localDir: env.STORAGE_LOCAL_DIR,
      endpoint: env.AWS_ENDPOINT_URL_S3,
      region: env.AWS_REGION,
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
    ai: {
      enabled: env.AI_ENABLED,
      baseUrl: env.NEON_AI_GATEWAY_BASE_URL,
      token: env.NEON_AI_GATEWAY_TOKEN,
      defaultModel: env.AI_DEFAULT_MODEL,
    },
    logLevel: env.LOG_LEVEL,
  }
}

export function getConfig(): AppConfig {
  if (!cached) {
    cached = buildConfig()
    setLogLevel(cached.logLevel)
  }
  return cached
}

export function resetConfigForTests(): void {
  cached = undefined
  loaded = false
}
