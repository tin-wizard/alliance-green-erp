/**
 * Neon AI Gateway client seam.
 *
 * The gateway is provisioned but inference is not available: the project has no
 * prepaid credits, so model calls fail with `credits_required`. This module
 * wires the client and reports that honestly behind a feature flag; it never
 * fabricates a response.
 *
 * SERVER ONLY. The token must not reach the browser.
 */
import { AiUnavailableError, ServiceUnavailableError } from '@cls/core'
import { getConfig } from '@cls/core/env.server'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  model?: string
  maxTokens?: number
  temperature?: number
}

export interface ChatResult {
  model: string
  content: string
  usage?: { promptTokens?: number; completionTokens?: number }
}

export type AiHealthStatus = 'disabled' | 'available' | 'unavailable' | 'not_configured'

export interface AiHealth {
  status: AiHealthStatus
  models: number
  message: string
}

const TIMEOUT_MS = 10_000

function baseUrl(): string | undefined {
  return getConfig().ai.baseUrl?.replace(/\/$/, '')
}

export function isAiConfigured(): boolean {
  const ai = getConfig().ai
  return Boolean(ai.enabled && ai.baseUrl && ai.token)
}

function authHeaders(): Record<string, string> {
  const token = getConfig().ai.token
  if (!token) throw new AiUnavailableError('NEON_AI_GATEWAY_TOKEN is not set.')
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
}

/** Reads the model catalogue. Works even when inference is not funded. */
export async function listModels(): Promise<string[]> {
  if (!isAiConfigured()) throw new AiUnavailableError('The AI Gateway feature flag is off.')
  const response = await fetch(`${baseUrl()}/v1/models`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new ServiceUnavailableError(
      'AI Gateway',
      `Model list returned ${response.status}.`,
    )
  }
  const body = (await response.json()) as { data?: { id?: string }[] }
  return (body.data ?? []).map((model) => model.id).filter((id): id is string => Boolean(id))
}

/**
 * Chat completion. Throws `AiUnavailableError` when the feature flag is off and
 * `ServiceUnavailableError` with the provider's message when inference is not
 * funded. Callers must handle both; there is no fallback model.
 */
export async function chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
  const ai = getConfig().ai
  if (!ai.enabled) throw new AiUnavailableError('The AI Gateway feature flag is off (AI_ENABLED=false).')
  if (!ai.baseUrl || !ai.token) {
    throw new AiUnavailableError('NEON_AI_GATEWAY_BASE_URL and NEON_AI_GATEWAY_TOKEN are required.')
  }

  const response = await fetch(`${baseUrl()}/v1/chat/completions`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      model: options.model ?? ai.defaultModel,
      messages,
      max_tokens: options.maxTokens ?? 512,
      temperature: options.temperature ?? 0.2,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  const body = (await response.json().catch(() => null)) as
    | {
        error?: { message?: string; code?: string }
        choices?: { message?: { content?: string } }[]
        usage?: { prompt_tokens?: number; completion_tokens?: number }
        model?: string
      }
    | null

  if (!response.ok) {
    const detail = body?.error?.message ?? `AI Gateway returned ${response.status}.`
    throw new ServiceUnavailableError('AI Gateway', detail)
  }

  const content = body?.choices?.[0]?.message?.content
  if (!content) {
    throw new ServiceUnavailableError('AI Gateway', 'The gateway returned no completion.')
  }

  return {
    model: body.model ?? options.model ?? ai.defaultModel,
    content,
    usage: body.usage
      ? {
          promptTokens: body.usage.prompt_tokens,
          completionTokens: body.usage.completion_tokens,
        }
      : undefined,
  }
}

export async function aiHealth(): Promise<AiHealth> {
  const ai = getConfig().ai
  if (!ai.enabled) {
    return {
      status: 'disabled',
      models: 0,
      message: 'AI Gateway is disabled (AI_ENABLED=false).',
    }
  }
  if (!ai.baseUrl || !ai.token) {
    return {
      status: 'not_configured',
      models: 0,
      message: 'AI Gateway URL or token is missing.',
    }
  }
  try {
    const models = await listModels()
    return {
      status: models.length > 0 ? 'available' : 'unavailable',
      models: models.length,
      message:
        models.length > 0
          ? `${models.length} models advertised; inference requires prepaid credits.`
          : 'The gateway advertises no models for this project.',
    }
  } catch (error) {
    return {
      status: 'unavailable',
      models: 0,
      message: error instanceof Error ? error.message : 'AI Gateway is unavailable',
    }
  }
}
