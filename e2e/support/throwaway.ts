/**
 * Throwaway signed-in sessions for E2E (test process only).
 * Pattern documented in docs/platform/MODULE-CONTRACT.md §8.2.
 *
 * Requires E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD for an existing provider admin,
 * NEON_AUTH_BASE_URL and APP_URL. Never imported by the application.
 *
 * Neon Auth rate-limits concurrent admin calls with 429. Specs run in parallel
 * worker processes, so admin calls are serialised through a shared file lock and
 * retried with backoff; the admin cookie is cached per process.
 */
import { mkdir, open, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

const BASE = process.env.NEON_AUTH_BASE_URL
const ORIGIN = process.env.APP_URL
const LOCK_PATH = join(process.cwd(), 'test-results', '.e2e-auth.lock')
const SLEEP = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let adminCookiePromise: Promise<string> | null = null

async function withAuthLock<T>(fn: () => Promise<T>): Promise<T> {
  await mkdir(join(process.cwd(), 'test-results'), { recursive: true })
  const deadline = Date.now() + 60_000
  let handle: Awaited<ReturnType<typeof open>> | null = null
  while (!handle) {
    try {
      handle = await open(LOCK_PATH, 'wx')
    } catch {
      try {
        const info = await stat(LOCK_PATH)
        if (Date.now() - info.mtimeMs > 60_000) await unlink(LOCK_PATH)
      } catch {
        // Another worker removed it; retry immediately.
      }
      if (Date.now() > deadline) throw new Error('Timed out waiting for the E2E auth lock.')
      await SLEEP(100 + Math.floor(Math.random() * 150))
    }
  }
  try {
    return await fn()
  } finally {
    await handle.close()
    await unlink(LOCK_PATH).catch(() => undefined)
  }
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  attempts = 6,
): Promise<Response> {
  let last: Response | null = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(url, init)
    if (response.status !== 429 && response.status < 500) return response
    last = response
    await SLEEP(300 * 2 ** attempt + Math.floor(Math.random() * 250))
  }
  return last!
}

async function signInAdmin(): Promise<string> {
  if (!BASE || !ORIGIN) throw new Error('Neon Auth is not configured for E2E.')
  const response = await fetchWithRetry(`${BASE}/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({
      email: process.env.E2E_ADMIN_EMAIL,
      password: process.env.E2E_ADMIN_PASSWORD,
    }),
  })
  if (!response.ok) throw new Error(`admin sign-in failed: ${response.status}`)
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')
}

async function adminCookie(): Promise<string> {
  adminCookiePromise ??= signInAdmin()
  try {
    return await adminCookiePromise
  } catch (error) {
    adminCookiePromise = null
    throw error
  }
}

export async function createThrowaway(
  email: string,
  password: string,
): Promise<{ id: string; email: string }> {
  return withAuthLock(async () => {
    const cookie = await adminCookie()
    const response = await fetchWithRetry(`${BASE}/admin/create-user`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN!, cookie },
      body: JSON.stringify({ email, password, name: 'E2E Throwaway' }),
    })
    if (!response.ok) throw new Error(`create-user failed: ${response.status}`)
    return (await response.json()).user as { id: string; email: string }
  })
}

export async function deleteThrowaway(userId: string): Promise<void> {
  await withAuthLock(async () => {
    const cookie = await adminCookie()
    const response = await fetchWithRetry(`${BASE}/admin/remove-user`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN!, cookie },
      body: JSON.stringify({ userId }),
    })
    if (!response.ok) throw new Error(`remove-user failed: ${response.status}`)
  })
}

export function e2eConfigured(): boolean {
  return Boolean(
    process.env.E2E_ADMIN_EMAIL &&
      process.env.E2E_ADMIN_PASSWORD &&
      process.env.NEON_AUTH_BASE_URL &&
      process.env.APP_URL &&
      (process.env.E2E_DATABASE_URL || process.env.DATABASE_URL),
  )
}
