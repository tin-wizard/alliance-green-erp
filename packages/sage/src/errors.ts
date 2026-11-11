/**
 * Sage error taxonomy. The posting worker decides retry-or-not from these
 * classes, never from a message string.
 */

export type SageErrorKind =
  | 'auth' // 401/403 after one refresh: needs_reauth
  | 'quota' // 429 or our own daily budget: retry after a delay
  | 'permanent' // 422 and other 4xx: a human fixes the payload or mapping
  | 'retryable' // 5xx, timeout, network: try again with backoff
  | 'conflict' // 409: the record probably exists; search for it
  | 'unconfigured' // no credentials: refuse to call, never fake success
  | 'paused' // a pause condition is active: the queue waits, nothing is lost

export class SageError extends Error {
  readonly kind: SageErrorKind
  readonly code: string
  readonly status: number | null
  readonly retryAfterMs: number | null
  /** Field errors from a 422, preserved for the finding. */
  readonly details: unknown

  constructor(
    kind: SageErrorKind,
    code: string,
    message: string,
    options: { status?: number | null; retryAfterMs?: number | null; details?: unknown } = {},
  ) {
    super(message)
    this.name = 'SageError'
    this.kind = kind
    this.code = code
    this.status = options.status ?? null
    this.retryAfterMs = options.retryAfterMs ?? null
    this.details = options.details ?? null
  }

  get retryable(): boolean {
    return this.kind === 'retryable' || this.kind === 'quota' || this.kind === 'conflict'
  }
}

export function isSageError(error: unknown): error is SageError {
  return error instanceof SageError
}

export interface ClassifiedResponse {
  code: string
  message: string
  retryAfterMs: number | null
  details: unknown
}

/**
 * Maps an HTTP response to our taxonomy. `Retry-After` is honoured in seconds
 * or as an HTTP date; a header we cannot parse becomes a one-minute delay.
 */
export function classifyResponse(
  status: number,
  body: string,
  headers: { get(name: string): string | null },
): SageError {
  let details: unknown = null
  let message = body.slice(0, 500)
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>
    details = parsed
    const first =
      (Array.isArray(parsed.$errors) && (parsed.$errors[0] as Record<string, unknown>)) || null
    if (first && typeof first.error_message === 'string') message = first.error_message
    else if (typeof parsed.message === 'string') message = parsed.message
  } catch {
    // A non-JSON body is kept as the truncated text.
  }

  const retryAfter = parseRetryAfter(headers.get('retry-after'))

  if (status === 401 || status === 403) {
    return new SageError('auth', 'SAGE_UNAUTHORISED', message || 'Unauthorised', {
      status,
      details,
    })
  }
  if (status === 409) {
    return new SageError('conflict', 'SAGE_CONFLICT', message || 'Conflict', { status, details })
  }
  if (status === 429) {
    return new SageError('quota', 'SAGE_RATE_LIMITED', message || 'Rate limited', {
      status,
      retryAfterMs: retryAfter ?? 60_000,
      details,
    })
  }
  if (status === 422 || (status >= 400 && status < 500)) {
    return new SageError('permanent', 'SAGE_REJECTED', message || `Rejected (${status})`, {
      status,
      details,
    })
  }
  return new SageError('retryable', 'SAGE_UNAVAILABLE', message || `Server error (${status})`, {
    status,
    retryAfterMs: retryAfter,
    details,
  })
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds, 3600) * 1000
  const date = Date.parse(value)
  if (Number.isFinite(date)) return Math.max(0, Math.min(date - Date.now(), 3_600_000))
  return null
}
