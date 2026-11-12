import { expect, test } from '@playwright/test'
import postgres from 'postgres'
import { randomBytes } from 'node:crypto'
import { createThrowaway, deleteThrowaway, e2eConfigured } from './support/throwaway'

/**
 * Compliance primary path with a real signed-in session: a WSIB document in the
 * seven-day window appears on the subcontractor row and the expiry dashboard.
 */
try {
  process.loadEnvFile('.env')
} catch {
  // The skip guard explains what is missing.
}

const DATABASE_URL = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
const sql = DATABASE_URL ? postgres(DATABASE_URL, { prepare: false, max: 2 }) : null

test.describe('compliance', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 })
  test.skip(!e2eConfigured(), 'Neon admin credentials and E2E database are required.')

  test('WSIB status and the seven-day expiry window are visible', async ({ page }) => {
    page.setDefaultTimeout(20_000)
    const suffix = Date.now()
    const subcontractorId = 9_600_000 + (suffix % 100_000)
    const name = `E2E Compliance Sub ${suffix}`
    const businessToday = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Toronto',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
    const expiry = new Date(`${businessToday}T00:00:00Z`)
    expiry.setUTCDate(expiry.getUTCDate() + 7)
    const expiresOn = expiry.toISOString().slice(0, 10)
    const email = `e2e-compliance-${suffix}@example.invalid`
    const password = randomBytes(24).toString('base64url')
    const created: string[] = []

    try {
      await sql!`
        insert into app.subcontractors (id, name, province, is_active)
        values (${subcontractorId}, ${name}, 'ON', true)`
      await sql!`
        insert into app.subcontractor_documents
          (subcontractor_id, kind, file_name, expires_on, is_expired)
        values (${subcontractorId}, 'wsib', ${`wsib-${suffix}.pdf`}, ${expiresOn}, false)`

      const auth = await createThrowaway(email, password)
      created.push(auth.id)
      await sql!`
        insert into app.users (email, username, display_name, role)
        values (${email}, ${`e2ecompliance${suffix}`}, 'E2E Compliance Admin', 'admin')`

      await page.goto('/login')
      await page.getByLabel('Username or email').fill(email)
      await page.getByLabel('Password').fill(password)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page).toHaveURL(/\/$/)

      await page.goto('/compliance')
      await expect(page.getByTestId('compliance-subcontractors')).toContainText(name)
      await expect(page.getByTestId('compliance-subcontractors')).toContainText('Expiring')

      await page.getByRole('button', { name: '7d' }).click()
      await expect(page.getByTestId('compliance-expiries')).toContainText(name)
      await expect(page.getByTestId('compliance-expiries')).toContainText(`wsib-${suffix}.pdf`)
    } finally {
      if (created.length) {
        for (const user of created) await deleteThrowaway(user).catch(() => undefined)
      }
      await sql!`delete from app.subcontractor_documents where subcontractor_id = ${subcontractorId}`
      await sql!`delete from app.subcontractors where id = ${subcontractorId}`
      await sql!`delete from app.users where email = ${email}`
    }
  })
})
