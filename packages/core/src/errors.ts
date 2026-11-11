/**
 * Typed application errors.
 *
 * These are transport-agnostic. The server layer maps `status` onto the HTTP
 * response and serialises `code`/`message` into the server-function error.
 */
export class AppError extends Error {
  readonly code: string
  readonly status: number
  readonly details: Record<string, unknown> | undefined

  constructor(
    code: string,
    message: string,
    status = 500,
    details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.status = status
    this.details = details
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required.') {
    super('unauthenticated', message, 401)
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends AppError {
  constructor(permission?: string) {
    super(
      'forbidden',
      permission
        ? `You do not have the "${permission}" permission.`
        : 'You do not have permission to do that.',
      403,
      permission ? { permission } : undefined,
    )
    this.name = 'ForbiddenError'
  }
}

export class NotFoundError extends AppError {
  constructor(entity = 'Record') {
    super('not_found', `${entity} not found.`, 404)
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends AppError {
  constructor(message = 'The submitted data is invalid.', details?: Record<string, unknown>) {
    super('validation_failed', message, 422, details)
    this.name = 'ValidationError'
  }
}

export class ConflictError extends AppError {
  constructor(message = 'The record changed since you loaded it.') {
    super('conflict', message, 409)
    this.name = 'ConflictError'
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(service: string, message?: string) {
    super('service_unavailable', message ?? `${service} is unavailable.`, 503, { service })
    this.name = 'ServiceUnavailableError'
  }
}

/** The Sage integration is switched off or cannot reach the company. */
export class SageUnavailableError extends AppError {
  constructor(message = 'Sage 50 is unavailable.') {
    super('sage_unavailable', message, 503, { service: 'sage' })
    this.name = 'SageUnavailableError'
  }
}

/** Sage is reachable in principle, but the connection credentials are missing. */
export class SageNotConfiguredError extends AppError {
  constructor(message = 'Sage credentials are not configured.') {
    super('sage_not_configured', message, 503, { service: 'sage' })
    this.name = 'SageNotConfiguredError'
  }
}

/** The AI Gateway seam is wired but inference is off or unfunded. */
export class AiUnavailableError extends AppError {
  constructor(message = 'AI features are unavailable.') {
    super('ai_unavailable', message, 503, { service: 'ai' })
    this.name = 'AiUnavailableError'
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}

/**
 * Normalises anything thrown into a public-safe shape.
 * Never leaks stack traces or driver messages to the browser.
 */
export function toPublicError(error: unknown): {
  code: string
  message: string
  status: number
} {
  if (isAppError(error)) {
    return { code: error.code, message: error.message, status: error.status }
  }
  return {
    code: 'internal_error',
    message: 'Something went wrong. The error has been logged.',
    status: 500,
  }
}
