import { expect, test } from '@playwright/test'

/**
 * Master Data is read-only, so the signed-in path only proves navigation,
 * authorization and that empty imports render honestly. It needs one seeded
 * admin account; no business rows are created or removed.
 */
const hasCredentials = Boolean(process.env.E2E_NEON_EMAIL && process.env.E2E_NEON_PASSWORD)

test.describe('master data', () => {
  test.skip(!hasCredentials, 'Set E2E_NEON_EMAIL and E2E_NEON_PASSWORD')

  test('lists render for a signed-in admin and orphan sites stay filterable', async ({ page }) => {
    page.setDefaultTimeout(15_000)
    await page.goto('/login')
    await page.getByLabel('Username or email').fill(process.env.E2E_NEON_EMAIL as string)
    await page.getByLabel('Password').fill(process.env.E2E_NEON_PASSWORD as string)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/$/)

    await page.getByRole('link', { name: 'Customers', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Customers.' })).toBeVisible()

    await page.getByRole('link', { name: 'Sites', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Sites.' })).toBeVisible()
    const parentFilter = page.getByLabel('Billing parent')
    await expect(parentFilter).toBeVisible()
    await parentFilter.selectOption('missing')
    await expect(page).toHaveURL(/parent=missing/)

    await page.getByRole('link', { name: 'Subcontractors', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Subcontractors.' })).toBeVisible()
    await expect(page.getByLabel('Compliance')).toBeVisible()

    await page.getByRole('link', { name: 'Suppliers', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Suppliers.' })).toBeVisible()

    await page.getByRole('link', { name: 'Parts catalogue', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Parts catalogue.' })).toBeVisible()
    await expect(
      page.getByText('Prices are read-only here.', { exact: false }),
    ).not.toBeVisible()
  })
})
