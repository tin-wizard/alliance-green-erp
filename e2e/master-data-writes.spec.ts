import { expect, test } from '@playwright/test'
import postgres from 'postgres'

/**
 * The signed-in write path: create a customer, add a site under it, upload a
 * compliance document, then edit a part. Every row is named with a unique
 * `E2E ` prefix and removed afterwards, so the run leaves no business data.
 */
const hasCredentials = Boolean(
  process.env.E2E_NEON_EMAIL && process.env.E2E_NEON_PASSWORD && process.env.E2E_DATABASE_URL,
)

const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
const customerName = `E2E Customer ${runId}`
const siteName = `E2E Site ${runId}`
const subcontractorName = `E2E Vendor ${runId}`
const partNumber = `E2E-PART-${runId.toUpperCase()}`
const prefix = `E2E %${runId}%`

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF')

async function cleanup(): Promise<void> {
  const url = process.env.E2E_DATABASE_URL
  if (!url) return
  const sql = postgres(url, { prepare: false, max: 1 })
  try {
    const customers = await sql<{ id: number }[]>`
      select id from app.customers where name like ${prefix}
    `
    const customerIds = customers.map((row) => row.id)
    const sites = await sql<{ id: number }[]>`
      select id from app.sites
      where name like ${prefix}
         or customer_id in (select id from app.customers where name like ${prefix})
    `
    const siteIds = sites.map((row) => row.id)
    const subs = await sql<{ id: number }[]>`
      select id from app.subcontractors where name like ${prefix}
    `
    const subIds = subs.map((row) => row.id)
    const parts = await sql<{ id: number }[]>`
      select id from app.parts where name like ${prefix} or part_number like ${prefix.toUpperCase()}
    `
    const partIds = parts.map((row) => row.id)
    const allIds = [...customerIds, ...siteIds, ...subIds, ...partIds]

    if (subIds.length > 0) {
      await sql`delete from app.compliance_reminders where subcontractor_id = any(${subIds})`
      await sql`delete from app.subcontractor_documents where subcontractor_id = any(${subIds})`
      await sql`delete from app.subcontractor_contacts where subcontractor_id = any(${subIds})`
      await sql`delete from app.subcontractors where id = any(${subIds})`
    }
    if (siteIds.length > 0) {
      await sql`delete from app.site_warranties where site_id = any(${siteIds})`
      await sql`delete from app.sites where id = any(${siteIds})`
    }
    if (allIds.length > 0) {
      await sql`delete from app.import_state where local_id = any(${allIds})`
      await sql`delete from app.master_data_requests where entity_id = any(${allIds})`
      await sql`delete from app.audit_log where entity_id = any(${allIds.map(String)})`
    }
    if (partIds.length > 0) await sql`delete from app.parts where id = any(${partIds})`
    if (customerIds.length > 0) await sql`delete from app.customers where id = any(${customerIds})`
  } finally {
    await sql.end({ timeout: 5 })
  }
}

test.describe('master data writes', () => {
  test.describe.configure({ timeout: 120_000 })
  test.skip(!hasCredentials, 'Set E2E_NEON_EMAIL, E2E_NEON_PASSWORD and E2E_DATABASE_URL')

  test.afterAll(async () => {
    await cleanup()
  })

  test('creates a customer, a site, a document and edits a part', async ({ page }) => {
    page.setDefaultTimeout(20_000)
    await page.goto('/login')
    await page.getByLabel('Username or email').fill(process.env.E2E_NEON_EMAIL as string)
    await page.getByLabel('Password').fill(process.env.E2E_NEON_PASSWORD as string)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/$/)

    // 1. Customer, with a negative local id and an explicit Sage warning.
    await page.goto('/master-data/customers')
    await page.getByRole('button', { name: 'New customer' }).click()
    await expect(page.getByRole('heading', { name: 'New customer.' })).toBeVisible()
    await page.getByLabel('Customer name').fill(customerName)
    await page.getByLabel('Street').fill(`1 E2E Street ${runId}`)
    await page.getByLabel('City').fill('Toronto')
    await page.getByLabel('Postal code').fill('M5V 9Z8')
    await page.getByLabel('Contact phone').fill('416-555-0199')
    await page.getByLabel('Contact email').fill(`e2e-${runId}@example.test`)
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page).toHaveURL(/\/master-data\/customers\/-\d+/)
    await expect(page.getByRole('heading', { name: customerName })).toBeVisible()
    await expect(page.getByText('Local — not in Sage')).toBeVisible()
    await expect(page.getByText('Sage posting is blocked')).toBeVisible()

    // 2. Site: the billing parent is a deliberate choice, never a default.
    await page.goto('/master-data/sites')
    await page.getByRole('button', { name: 'New site' }).click()
    await expect(page.getByRole('heading', { name: 'New site.' })).toBeVisible()
    await page.getByLabel('Existing customer').check()
    await page.getByLabel('Search customers').fill(customerName)
    const parentSelect = page.getByRole('combobox', { name: /Billing customer/ })
    const parentOption = parentSelect.locator('option').filter({ hasText: customerName })
    await expect(parentOption).toHaveCount(1)
    await parentSelect.selectOption((await parentOption.getAttribute('value')) as string)
    await page.getByLabel('Site name').fill(siteName)
    await page.getByLabel('Street', { exact: true }).fill(`2 E2E Street ${runId}`)
    await page.getByLabel('City').fill('Toronto')
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page).toHaveURL(/\/master-data\/sites\/-\d+/)
    await expect(page.getByRole('heading', { name: siteName })).toBeVisible()
    await expect(page.getByText(customerName)).toBeVisible()

    // 3. Subcontractor plus a real PDF compliance document.
    await page.goto('/master-data/subcontractors')
    await page.getByRole('button', { name: 'New subcontractor' }).click()
    await page.getByLabel(/^Name/).fill(subcontractorName)
    await page.getByLabel('City').fill('Toronto')
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page).toHaveURL(/\/master-data\/subcontractors\/-\d+/)
    await expect(page.getByRole('heading', { name: subcontractorName })).toBeVisible()

    await page.getByLabel('Expiry (required)').fill('2099-12-31')
    await page.getByLabel('Document name').fill(`WSIB ${runId}`)
    await page
      .getByLabel('File (PDF, JPEG, PNG; max 10 MiB)')
      .setInputFiles({ name: `wsib-${runId}.pdf`, mimeType: 'application/pdf', buffer: PDF })
    await page.getByRole('button', { name: 'Upload document' }).click()
    await expect(page.getByText('Current', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: `View wsib-${runId}.pdf` })).toBeVisible()

    // 4. Part identity edit. Prices are not inputs here.
    await page.goto('/master-data/parts/new')
    await expect(page.getByRole('heading', { name: 'New part.' })).toBeVisible()
    await page.getByLabel(/^Part number/).fill(partNumber)
    await page.getByLabel('Description').fill(`E2E Part ${runId}`)
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page).toHaveURL(/\/master-data\/parts\/-\d+/)
    await expect(page.getByText('Prices are read-only here.')).toBeVisible()
    await page.getByRole('link', { name: 'Edit part' }).click()
    await page.getByLabel('Description').fill(`E2E Part edited ${runId}`)
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page).toHaveURL(/\/master-data\/parts\/-\d+/)
    await expect(page.getByText(`E2E Part edited ${runId}`)).toBeVisible()
  })
})
