import { expect, test } from '@playwright/test'

test('liveness endpoint answers without any dependency', async ({ request }) => {
  const response = await request.get('/healthz')
  expect(response.status()).toBe(200)
  expect(await response.text()).toBe('ok')
})

test('health endpoint reports the real service state, not a crash', async ({ request }) => {
  const response = await request.get('/api/health')
  expect(response.status()).toBe(200)
  const body = await response.json()
  expect(['ok', 'not_configured', 'unavailable']).toContain(body.checks.database.status)
  expect(['ok', 'degraded']).toContain(body.status)
  expect(['disabled', 'verified', 'unverified', 'unreachable', 'error']).toContain(
    body.checks.sage.status,
  )
  expect(['ok', 'not_configured', 'unavailable']).toContain(body.checks.auth.status)
  expect(['ok', 'not_configured', 'unavailable']).toContain(body.checks.storage.status)
  expect(['disabled', 'available', 'unavailable', 'not_configured']).toContain(
    body.checks.ai.status,
  )
  expect(body.version).toMatch(/^\d+\.\d+\.\d+/)
})

test('readiness follows database connectivity', async ({ request }) => {
  const health = await (await request.get('/api/health')).json()
  const response = await request.get('/api/ready')
  const databaseOk = health.checks.database.status === 'ok'
  expect(response.status()).toBe(databaseOk ? 200 : 503)
  const body = await response.json()
  expect(body.ready).toBe(databaseOk)
})

test('unauthenticated root redirects to the login page', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  await expect(page.getByLabel('Username or email')).toBeVisible()
  await expect(page.getByLabel('Password')).toBeVisible()
})

test('login page is server-rendered and has no authentication cookie', async ({ page, context }) => {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  const cookies = await context.cookies()
  expect(cookies.find((cookie) => cookie.name === 'cls_session')).toBeUndefined()
})

test('security headers are present on document responses', async ({ request }) => {
  const response = await request.get('/login')
  expect(response.headers()['x-content-type-options']).toBe('nosniff')
  expect(response.headers()['x-frame-options']).toBe('DENY')
  expect(response.headers()['referrer-policy']).toBe('same-origin')
})

test('session cookie is http-only after a successful sign-in', async ({ page, context }) => {
  test.skip(
    !process.env.E2E_NEON_EMAIL || !process.env.E2E_NEON_PASSWORD,
    'Set E2E_NEON_EMAIL and E2E_NEON_PASSWORD to a real provisioned Neon user',
  )
  await page.goto('/login')
  await page.getByLabel('Username or email').fill(process.env.E2E_NEON_EMAIL as string)
  await page.getByLabel('Password').fill(process.env.E2E_NEON_PASSWORD as string)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/$/)

  const cookie = (await context.cookies()).find((candidate) => candidate.name === 'cls_session')
  expect(cookie).toBeDefined()
  expect(cookie?.httpOnly).toBe(true)
  expect(cookie?.sameSite).toBe('Lax')
  expect(cookie?.value.length).toBeGreaterThan(40)
})
