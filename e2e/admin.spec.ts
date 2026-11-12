import { expect, test } from '@playwright/test'
import postgres from 'postgres'
import { randomBytes } from 'node:crypto'
import { createThrowaway, deleteThrowaway, e2eConfigured } from './support/throwaway'

/**
 * Admin primary path with a real signed-in session: the user list shows the
 * linked identity, and the activity log filters by action to a known row.
 */
try {
  process.loadEnvFile('.env')
} catch {
  // The skip guard explains what is missing.
}

const DATABASE_URL = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
const sql = DATABASE_URL ? postgres(DATABASE_URL, { prepare: false, max: 2 }) : null

test.describe('admin', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 })
  test.skip(!e2eConfigured(), 'Neon admin credentials and E2E database are required.')

  test('the user list and activity log are visible to an administrator', async ({ page }) => {
    page.setDefaultTimeout(20_000)
    const suffix = Date.now()
    const email = `e2e-admin-${suffix}@example.invalid`
    const password = randomBytes(24).toString('base64url')
    const displayName = `E2E Admin ${suffix}`
    const action = `e2e.admin.view.${suffix}`
    const summary = `E2E audit row ${suffix}`
    const created: string[] = []

    try {
      const auth = await createThrowaway(email, password)
      created.push(auth.id)
      await sql!`
        insert into app.users (email, username, display_name, role)
        values (${email}, ${`e2eadmin${suffix}`}, ${displayName}, 'admin')`

      await page.goto('/login')
      await page.getByLabel('Username or email').fill(email)
      await page.getByLabel('Password').fill(password)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page).toHaveURL(/\/$/)

      await page.goto('/admin/users')
      await expect(page.getByTestId('admin-users')).toContainText(displayName)
      await expect(page.getByTestId('admin-users')).toContainText(email)

      await sql!`
        insert into app.audit_log (actor_label, action, entity_type, entity_id, summary)
        values (${email}, ${action}, 'test', ${String(suffix)}, ${summary})`

      await page.goto('/admin/audit')
      await page.getByLabel('Action').fill(action)
      await page.getByRole('button', { name: 'Apply' }).click()
      await expect(page.getByTestId('audit-table')).toContainText(summary)
      await expect(page.getByTestId('audit-table')).toContainText(action)
    } finally {
      await sql!`delete from app.audit_log where action = ${action}`
      if (created.length) {
        for (const user of created) await deleteThrowaway(user).catch(() => undefined)
      }
      await sql!`delete from app.users where email = ${email}`
    }
  })
})
