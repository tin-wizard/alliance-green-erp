/**
 * Minimal structured logger. No dependency, no request bodies, no secrets.
 * Output is one JSON object per line so the local server log is greppable.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

let currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel | undefined) ?? 'info'

export function setLogLevel(level: LogLevel): void {
  currentLevel = level
}

function emit(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...redact(fields),
  })
  if (level === 'error' || level === 'warn') {
    process.stderr.write(`${line}\n`)
  } else {
    process.stdout.write(`${line}\n`)
  }
}

const SECRET_KEYS = /pass(word)?|secret|token|cookie|authorization|database_url|connection/i

function redact(fields?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!fields) return undefined
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (SECRET_KEYS.test(key)) {
      out[key] = '[redacted]'
      continue
    }
    out[key] = value instanceof Error ? { name: value.name, message: value.message } : value
  }
  return out
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) => emit('debug', message, fields),
  info: (message: string, fields?: Record<string, unknown>) => emit('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => emit('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => emit('error', message, fields),
}
