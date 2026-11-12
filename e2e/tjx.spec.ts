import { expect, test } from '@playwright/test'
import postgres from 'postgres'
import { randomBytes } from 'node:crypto'
import { createThrowaway, deleteThrowaway, e2eConfigured } from './support/throwaway'

/**
 * TJX primary path with a real signed-in session:
 * create from the default template → add a special part → save → submit →
 * approve → customer PDF → internal order sheet.
 *
 * Seeds its own site/customer and removes the quote, documents, revisions and
 * audit rows afterwards. No master-data seed: a special part is a valid line.
 */
try {
  process.loadEnvFile('.env')
} catch {
  // Skip guard below explains what is missing.
}

const DATABASE_URL = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
const SITE_ID = 990211
const CUSTOMER_ID = 990212

const sql = DATABASE_URL ? postgres(DATABASE_URL, { prepare: false, max: 2 }) : null

async function seedReference(): Promise<void> {
  await sql!`
    insert into app.customers (id, name) values (${CUSTOMER_ID}, 'E2E TJX Customer')
    on conflict (id) do nothing`
  await sql!`
    insert into app.sites (id, customer_id, name, street, city, province, postal_code)
    values (${SITE_ID}, ${CUSTOMER_ID}, 'E2E TJX Site', '2 TJX Way', 'Toronto', 'ON', 'M5V 0A2')
    on conflict (id) do nothing`
}

async function cleanup(quoteIds: number[], email: string): Promise<void> {
  for (const id of quoteIds) {
    await sql!`delete from app.generated_documents where entity_type = 'tjx_quote' and entity_id = ${String(id)}`
    await sql!`delete from app.audit_log where entity_type = 'tjx_quote' and entity_id = ${String(id)}`
    await sql!`delete from app.tjx_quotes where id = ${id}`
  }
  await sql!`delete from app.users where email = ${email}`
  await sql!`delete from app.sites where id = ${SITE_ID}`
  await sql!`delete from app.customers where id = ${CUSTOMER_ID}`
}

test.describe('TJX quote lifecycle', () => {
  test.describe.configure({ mode: 'serial', timeout: 150_000 })
  test.skip(!e2eConfigured(), 'Neon admin credentials and E2E database are required.')

  test('create → edit → submit → approve → PDFs', async ({ page }) => {
    page.setDefaultTimeout(20_000)
    const email = `e2e-tjx-${Date.now()}@example.invalid`
    const password = randomBytes(24).toString('base64url')
    const quoteIds: number[] = []
    let authUserId: string | null = null

    try {
      await seedReference()
      const authUser = await createThrowaway(email, password)
      authUserId = authUser.id
      await sql!`
        insert into app.users (email, username, display_name, role)
        values (${email}, ${`e2etjx${Date.now()}`}, 'E2E TJX Admin', 'admin')`

      await page.goto('/login')
      await page.getByLabel('Username or email').fill(email)
      await page.getByLabel('Password').fill(password)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page).toHaveURL(/\/$/)

      await page.goto('/tjx/quotes/new')
      await page.getByPlaceholder('Search sites or customers…').fill('E2E TJX Site')
      await page.getByRole('button', { name: /E2E TJX Site/ }).click()
      await page.getByLabel('Ceiling grid').selectOption('2')
      await page.getByLabel('Payment terms').selectOption('4')
      await page.getByRole('button', { name: 'Create quote' }).click()

      await expect(page).toHaveURL(/\/tjx\/quotes\/\d+/)
      const quoteId = Number(page.url().match(/\/tjx\/quotes\/(\d+)/)?.[1])
      expect(quoteId).toBeGreaterThan(0)
      quoteIds.push(quoteId)

      await page.getByRole('button', { name: 'Add special part' }).click()
      await page.getByLabel('Name').fill('E2E Freight')
      await page.getByLabel('Quantity').fill('1')
      await page.getByLabel('Unit price').fill('10.00')
      await page.getByRole('button', { name: 'Save quote' }).click()
      await expect(page.getByText(/Server saved/)).toBeVisible()

      await page.getByRole('button', { name: 'Submit for approval' }).click()
      await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible({
        timeout: 20_000,
      })
      await expect(page.getByText('Waiting for Approval', { exact: true }).first()).toBeVisible()

      await page.getByRole('button', { name: 'Approve' }).click()
      await expect(page.getByText('Quote approved.', { exact: true })).toBeVisible({
        timeout: 20_000,
      })
      await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible()

      await page.getByRole('button', { name: 'Quote PDF' }).click()
      await expect(page.getByRole('status')).toContainText(/Quote PDF generated/)

      await page.getByRole('button', { name: 'Order sheet' }).click()
      await expect(page.getByRole('status')).toContainText(/order sheet generated/)

      const docs = await sql!`
        select kind, schema_version, sha256, page_count, byte_size, data_snapshot
        from app.generated_documents
        where entity_type = 'tjx_quote' and entity_id = ${String(quoteId)}
        order by created_at`
      expect(docs).toHaveLength(2)
      expect(new Set(docs.map((row) => row.kind))).toEqual(
        new Set(['tjx-quote', 'tjx-order-sheet']),
      )
      for (const row of docs) {
        expect(row.schema_version).toBe(1)
        expect(row.sha256).toMatch(/^[0-9a-f]{64}$/)
        expect(row.page_count).toBeGreaterThanOrEqual(1)
        expect(row.byte_size).toBeGreaterThan(1000)
      }
      expect(docs[0]!.data_snapshot).toMatchObject({ kind: 'tjx-quote' })

      await page.getByRole('button', { name: 'Regenerate' }).first().click()
      await expect
        .poll(async () => {
          const rows = await sql!`
            select sha256 from app.generated_documents
            where entity_type = 'tjx_quote' and entity_id = ${String(quoteId)}`
          return rows.length
        })
        .toBe(3)
      const hashes = await sql!`
        select sha256 from app.generated_documents
        where entity_type = 'tjx_quote' and entity_id = ${String(quoteId)}
          and kind = 'tjx-quote'`
      expect(new Set(hashes.map((row) => row.sha256)).size).toBe(1)

      const revisions = await sql!`
        select revision_type from app.tjx_quote_revisions
        where quote_id = ${quoteId} order by save_seq`
      expect(revisions.map((row) => row.revision_type)).toEqual([
        'insert',
        'update',
        'submit',
        'approve',
      ])
    } finally {
      await cleanup(quoteIds, email)
      if (authUserId) await deleteThrowaway(authUserId)
    }
  })
})
