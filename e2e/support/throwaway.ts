/**
 * Throwaway signed-in sessions for E2E (test process only).
 * Pattern documented in docs/platform/MODULE-CONTRACT.md §8.2.
 *
 * Requires E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD for an existing provider admin,
 * NEON_AUTH_BASE_URL and APP_URL. Never imported by the application.
 */
const BASE = process.env.NEON_AUTH_BASE_URL
const ORIGIN = process.env.APP_URL

async function adminCookie(): Promise<string> {
  if (!BASE || !ORIGIN) throw new Error('Neon Auth is not configured for E2E.')
  const response = await fetch(`${BASE}/sign-in/email`, {
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

export async function createThrowaway(
  email: string,
  password: string,
): Promise<{ id: string; email: string }> {
  const cookie = await adminCookie()
  const response = await fetch(`${BASE}/admin/create-user`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN!, cookie },
    body: JSON.stringify({ email, password, name: 'E2E Throwaway' }),
  })
  if (!response.ok) throw new Error(`create-user failed: ${response.status}`)
  return (await response.json()).user as { id: string; email: string }
}

export async function deleteThrowaway(userId: string): Promise<void> {
  const cookie = await adminCookie()
  const response = await fetch(`${BASE}/admin/remove-user`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN!, cookie },
    body: JSON.stringify({ userId }),
  })
  if (!response.ok) throw new Error(`remove-user failed: ${response.status}`)
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
