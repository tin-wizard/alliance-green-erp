import { expect, test } from '@playwright/test'

/**
 * Authentication now belongs to Neon Auth. The wrong-password test runs against
 * the provider; a full sign-in needs a real, provisioned Neon user:
 *
 *   E2E_NEON_EMAIL=... E2E_NEON_PASSWORD=... pnpm test:e2e
 *
 * No user is created by the test suite.
 */
const hasCredentials = Boolean(process.env.E2E_NEON_EMAIL && process.env.E2E_NEON_PASSWORD)

test.describe('authentication', () => {
  test('rejects a wrong password with a generic message', async ({ page }) => {
    await page.goto('/login')
    await page
      .getByLabel('Username or email')
      .fill(process.env.E2E_NEON_EMAIL ?? 'nobody@example.invalid')
    await page.getByLabel('Password').fill('definitely-not-the-password')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('alert')).toContainText(
      /Invalid username or password|Neon Auth is unavailable|not provisioned/i,
    )
    await expect(page).toHaveURL(/\/login/)
  })

  test('signs in, renders the shell, and signs out', async ({ page }) => {
    test.skip(!hasCredentials, 'Set E2E_NEON_EMAIL and E2E_NEON_PASSWORD')
    await page.goto('/login')
    await page.getByLabel('Username or email').fill(process.env.E2E_NEON_EMAIL as string)
    await page.getByLabel('Password').fill(process.env.E2E_NEON_PASSWORD as string)
    await page.getByRole('button', { name: 'Sign in' }).click()

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: /Good to see you/ })).toBeVisible()
    await expect(page.getByText('Postgres (Neon)')).toBeVisible()

    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/login/)
  })
})
