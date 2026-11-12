import { expect, test } from '@playwright/test'
import postgres from 'postgres'
import { randomBytes } from 'node:crypto'
import { createThrowaway, deleteThrowaway, e2eConfigured } from './support/throwaway'

/**
 * Reports primary path with a real signed-in session: seeded Bell invoice →
 * parameterised client report → PDF download.
 */
try {
  process.loadEnvFile('.env')
} catch {
  // The skip guard explains what is missing.
}

const DATABASE_URL = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
const sql = DATABASE_URL ? postgres(DATABASE_URL, { prepare: false, max: 2 }) : null

test.describe('reports', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 })
  test.skip(!e2eConfigured(), 'Neon admin credentials and E2E database are required.')

  test('client invoice report renders and exports the seeded invoice', async ({ page }) => {
    page.setDefaultTimeout(20_000)
    const suffix = Date.now()
    const customerId = 9_700_000 + (suffix % 100_000)
    const siteId = customerId + 1
    const workOrderId = 9_650_000 + (suffix % 100_000)
    const invoiceNumber = `E2E-INV-${suffix}`
    const today = new Date().toISOString().slice(0, 10)
    const email = `e2e-report-${suffix}@example.invalid`
    const password = randomBytes(24).toString('base64url')
    const created: string[] = []

    try {
      await sql!`
        insert into app.customers (id, name, province)
        values (${customerId}, ${`Bell Mobility Inc #${suffix} - E2E`}, 'ON')`
      await sql!`
        insert into app.sites (id, customer_id, name, street, city, province)
        values (${siteId}, ${customerId}, ${`E2E Report Site ${suffix}`}, '1 Report Way', 'Toronto', 'ON')`
      await sql!`
        insert into app.work_orders (id, site_id, status, service_type_id, date_taken, customer_po, service_required)
        values (${workOrderId}, ${siteId}, 11, 1, ${today}, ${`PO-${suffix}`}, 'E2E report service')`
      const [invoice] = await sql!`
        insert into app.sales_invoices
          (work_order_id, invoice_number, work_order_number, customer_id, site_id, calc_type, status,
           invoice_date, labour_amount, material_amount, subtotal_amount, tax_amount, total_amount)
        values (${workOrderId}, ${invoiceNumber}, ${workOrderId}, ${customerId}, ${siteId}, 'standard', 'issued',
                ${today}, '100.00', '50.00', '150.00', '19.50', '169.50')
        returning id`
      await sql!`
        insert into app.invoice_labour_lines
          (invoice_id, position, line_date, hours, rate_code, hourly_rate, qty, price, amount)
        values (${invoice!.id}, 1, ${today}, 1, 1, 100, 1, 100, 100)`

      const auth = await createThrowaway(email, password)
      created.push(auth.id)
      await sql!`
        insert into app.users (email, username, display_name, role)
        values (${email}, ${`e2ereport${suffix}`}, 'E2E Report Admin', 'admin')`

      await page.goto('/login')
      await page.getByLabel('Username or email').fill(email)
      await page.getByLabel('Password').fill(password)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page).toHaveURL(/\/$/)

      await page.goto('/reports')
      await page.getByRole('button', { name: 'Run report' }).click()
      await expect(page.getByTestId('report-table')).toContainText(invoiceNumber)
      await expect(page.getByTestId('report-table')).toContainText('169.50')

      const downloadPromise = page.waitForEvent('download')
      await page.getByRole('button', { name: 'PDF' }).click()
      const download = await downloadPromise
      expect(download.suggestedFilename()).toMatch(/^client-invoices-bell-\d{8}\.pdf$/)
    } finally {
      if (created.length) {
        await sql!`delete from app.audit_log
          where actor_user_id in (select id from app.users where email = ${email})`
        for (const user of created) await deleteThrowaway(user).catch(() => undefined)
      }
      await sql!`delete from app.sales_invoices where invoice_number = ${invoiceNumber}`
      await sql!`delete from app.work_orders where id = ${workOrderId}`
      await sql!`delete from app.sites where id = ${siteId}`
      await sql!`delete from app.customers where id = ${customerId}`
      await sql!`delete from app.users where email = ${email}`
    }
  })
})
