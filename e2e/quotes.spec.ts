import { expect, test } from '@playwright/test'
import postgres from 'postgres'
import { randomBytes } from 'node:crypto'
import { createThrowaway, deleteThrowaway, e2eConfigured } from './support/throwaway'

/**
 * Quotes primary path with a real signed-in session:
 * create → submit → approve → quote PDF → convert to a work order.
 *
 * Seeds its own site/customer/reference rows and removes them, the quote, the
 * converted work order and the generated audit rows afterwards.
 */
try {
  process.loadEnvFile('.env')
} catch {
  // Skip guard below explains what is missing.
}

const DATABASE_URL = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
const SITE_ID = 990201
const CUSTOMER_ID = 990202

const sql = DATABASE_URL ? postgres(DATABASE_URL, { prepare: false, max: 2 }) : null

async function seedReference(): Promise<void> {
  await sql!`
    insert into public.wo_servtype (id, name) values (1, 'Interior'), (2, 'Exterior')
    on conflict (id) do nothing`
  await sql!`
    insert into public.wo_priority (id, name) values (1, 'High'), (3, 'Normal')
    on conflict (id) do nothing`
  await sql!`
    insert into app.customers (id, name) values (${CUSTOMER_ID}, 'E2E Quote Customer')
    on conflict (id) do nothing`
  await sql!`
    insert into app.sites (id, customer_id, name, street, city, province, postal_code)
    values (${SITE_ID}, ${CUSTOMER_ID}, 'E2E Quote Site', '1 Quote Way', 'Toronto', 'ON', 'M5V 0A1')
    on conflict (id) do nothing`
}

async function cleanup(workOrderIds: number[], quoteIds: number[], email: string): Promise<void> {
  for (const id of workOrderIds) {
    await sql!`delete from app.audit_log where entity_type = 'work_order' and entity_id = ${String(id)}`
    await sql!`delete from app.work_orders where id = ${id}`
  }
  for (const id of quoteIds) {
    await sql!`delete from app.audit_log where entity_type = 'quote' and entity_id = ${String(id)}`
    await sql!`delete from app.generated_documents where entity_type = 'quote' and entity_id = ${String(id)}`
    await sql!`delete from app.quotes where id = ${id}`
  }
  await sql!`delete from app.users where email = ${email}`
  await sql!`delete from app.sites where id = ${SITE_ID}`
  await sql!`delete from app.customers where id = ${CUSTOMER_ID}`
}

test.describe('quotes', () => {
  test.describe.configure({ mode: 'serial', timeout: 120_000 })
  test.skip(!e2eConfigured(), 'Neon admin credentials and E2E database are required.')

  test('create → submit → approve → PDF → convert to work order', async ({ page }) => {
    page.setDefaultTimeout(15_000)
    const email = `e2e-quote-${Date.now()}@example.invalid`
    const password = randomBytes(24).toString('base64url')
    const quoteIds: number[] = []
    const workOrderIds: number[] = []
    let authUserId: string | null = null

    try {
      await seedReference()
      const authUser = await createThrowaway(email, password)
      authUserId = authUser.id
      await sql!`
        insert into app.users (email, username, display_name, role)
        values (${email}, ${`e2equote${Date.now()}`}, 'E2E Quote Admin', 'admin')`

      await page.goto('/login')
      await page.getByLabel('Username or email').fill(email)
      await page.getByLabel('Password').fill(password)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page).toHaveURL(/\/$/)

      await page.goto('/quotes/new')
      await page.getByPlaceholder('Search sites or customers…').fill('E2E Quote Site')
      await page.getByRole('button', { name: /E2E Quote Site/ }).click()
      await page.getByLabel('Hours').fill('2')
      await page.getByLabel('Rate', { exact: true }).fill('85')
      await page.getByRole('button', { name: 'Add part' }).click()
      await page.getByLabel('Part', { exact: true }).fill('BALLAST-1')
      await page.getByLabel('Qty').first().fill('3')
      await page.getByLabel('Price').first().fill('12.99')
      await page.getByRole('button', { name: 'Create quote' }).click()

      await expect(page).toHaveURL(/\/quotes\/\d+/)
      const quoteId = Number(page.url().match(/\/quotes\/(\d+)/)?.[1])
      expect(quoteId).toBeGreaterThan(0)
      quoteIds.push(quoteId)
      await expect(page.getByText('$236.14')).toBeVisible()

      await page.getByRole('button', { name: 'Submit for approval' }).click()
      await expect(page.getByText('Pending approval', { exact: true }).first()).toBeVisible()

      await page.getByRole('button', { name: 'Approve' }).click()
      await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible()

      await page.getByRole('button', { name: 'Quote PDF' }).click()
      await expect(page.getByRole('status')).toContainText(/PDF generated/)

      const docs = await sql!`
        select id, schema_version, sha256, page_count, byte_size, data_snapshot
        from app.generated_documents
        where entity_type = 'quote' and entity_id = ${String(quoteId)}`
      expect(docs).toHaveLength(1)
      expect(docs[0]!.schema_version).toBe(1)
      expect(docs[0]!.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(docs[0]!.page_count).toBeGreaterThanOrEqual(1)
      expect(docs[0]!.byte_size).toBeGreaterThan(1000)
      const originalHash = docs[0]!.sha256 as string

      await page.getByRole('tab', { name: 'PDFs' }).click()
      await page.getByRole('button', { name: 'Regenerate' }).first().click()
      await expect
        .poll(async () => {
          const rows = await sql!`
            select sha256 from app.generated_documents
            where entity_type = 'quote' and entity_id = ${String(quoteId)}`
          return rows.length
        })
        .toBe(2)
      const hashes = await sql!`
        select sha256 from app.generated_documents
        where entity_type = 'quote' and entity_id = ${String(quoteId)}`
      expect(new Set(hashes.map((row) => row.sha256))).toEqual(new Set([originalHash]))

      await page.getByRole('button', { name: 'Convert to work order' }).click()
      await expect(page.getByRole('status')).toContainText(/Created work order/)
      const workOrderLink = page.getByRole('link', { name: /Work order \d+/ })
      await expect(workOrderLink).toBeVisible()
      const workOrderId = Number((await workOrderLink.innerText()).match(/\d+/)?.[0])
      workOrderIds.push(workOrderId)
      expect(workOrderId).toBeGreaterThan(0)
    } finally {
      await cleanup(workOrderIds, quoteIds, email)
      if (authUserId) await deleteThrowaway(authUserId)
    }
  })
})
