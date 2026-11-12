import { expect, test, type Page } from '@playwright/test'
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

async function cleanup(
  quoteIds: number[],
  email: string,
  workOrderId?: number,
  subEmail?: string,
): Promise<void> {
  if (workOrderId) {
    await sql!`delete from app.audit_log where entity_type = 'tjx_sub_invoice'
      and entity_id in (select id::text from app.tjx_sub_invoices where work_order_id = ${workOrderId})`
    await sql!`delete from app.tjx_sub_invoices where work_order_id = ${workOrderId}`
    await sql!`delete from app.sage_postings where doc_type = 'subcontractor_invoice'
      and doc_id in (select id from app.subcontractor_invoices where work_order_id = ${workOrderId})`
    await sql!`delete from app.subcontractor_invoices where work_order_id = ${workOrderId}`
    await sql!`delete from app.audit_log where entity_type = 'work_order' and entity_id = ${String(workOrderId)}`
  }
  for (const id of quoteIds) {
    await sql!`delete from app.generated_documents where entity_type = 'tjx_quote' and entity_id = ${String(id)}`
    await sql!`delete from app.audit_log where entity_type = 'tjx_quote' and entity_id = ${String(id)}`
    await sql!`delete from app.tjx_quotes where id = ${id}`
  }
  if (workOrderId) {
    await sql!`delete from app.work_orders where id = ${workOrderId}`
  }
  await sql!`delete from app.users where email = ${email}`
  if (subEmail) {
    await sql!`delete from app.users where email = ${subEmail}`
    await sql!`delete from app.subcontractors where id = 990213`
  }
  await sql!`delete from app.sites where id = ${SITE_ID}`
  await sql!`delete from app.customers where id = ${CUSTOMER_ID}`
}

async function signIn(page: Page, email: string, password: string) {
  await page.context().clearCookies()
  await page.goto('/login')
  await page.getByLabel('Username or email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/$/)
}

test.describe('TJX quote lifecycle', () => {
  test.describe.configure({ mode: 'serial', timeout: 300_000 })
  test.skip(!e2eConfigured(), 'Neon admin credentials and E2E database are required.')

  test('create → edit → submit → approve → PDFs → sub invoice gates', async ({ page }) => {
    page.setDefaultTimeout(20_000)
    const email = `e2e-tjx-${Date.now()}@example.invalid`
    const subEmail = `e2e-tjx-sub-${Date.now()}@example.invalid`
    const password = randomBytes(24).toString('base64url')
    const quoteIds: number[] = []
    let authUserId: string | null = null
    let subAuthUserId: string | null = null
    let workOrderId: number | undefined

    try {
      await seedReference()
      const authUser = await createThrowaway(email, password)
      authUserId = authUser.id
      await sql!`
        insert into app.users (email, username, display_name, role)
        values (${email}, ${`e2etjx${Date.now()}`}, 'E2E TJX Admin', 'admin')`

      await signIn(page, email, password)

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

      await page.getByLabel('Service type').selectOption({ index: 1 })
      await page.getByLabel('Priority').selectOption({ index: 1 })
      await page.getByRole('button', { name: 'Create work order' }).click()
      await expect(page.getByText(/Created work order \d+/)).toBeVisible()
      await expect
        .poll(async () => {
          const [link] = await sql!`
            select work_order_id from app.tjx_quote_work_orders
            where quote_id = ${quoteId} and is_primary`
          return link?.work_order_id ?? 0
        })
        .toBeGreaterThan(0)
      const [link] = await sql!`
        select work_order_id from app.tjx_quote_work_orders
        where quote_id = ${quoteId} and is_primary`
      workOrderId = Number(link!.work_order_id)

      await sql!`insert into app.subcontractors (id, name) values (990213, 'E2E TJX Installer')
        on conflict (id) do nothing`
      const subAuthUser = await createThrowaway(subEmail, password)
      subAuthUserId = subAuthUser.id
      await sql!`insert into app.users (email, username, display_name, role, subcontractor_id)
        values (${subEmail}, ${`e2etjxsub${Date.now()}`}, 'E2E TJX Subcontractor', 'subcontractor', 990213)`
      const [room] = await sql!`
        insert into app.tjx_quote_rooms (quote_id, room_name, sort_order)
        values (${quoteId}, 'E2E Sales Floor', 0) returning id`
      const [fixture] = await sql!`
        insert into app.tjx_quote_fixtures
          (quote_id, quote_room_id, fixture_name, quantity, sort_order)
        values (${quoteId}, ${room!.id}, 'E2E Troffer', 2, 0) returning id`
      await sql!`insert into app.tjx_quote_fixture_parts
        (quote_fixture_id, part_no, part_type, markup, ratio_per_fixture, sort_order)
        values (${fixture!.id}, 'WIN-E2E', 'Ballast', 2, 1, 0)`
      await sql!`insert into app.tjx_quote_parts
        (quote_id, part_no, qty_with_markup, qty_without_markup, unit_price,
         line_subtotal, line_subtotal_without_markup, sort_order, origin)
        values (${quoteId}, 'WIN-E2E', 4, 2, 10, 40, 20, 0, 'legacy')`
      await sql!`insert into app.tjx_subcontractor_rates
        (subcontractor_id, part_no, install_cost_per_unit)
        values (990213, 'WIN-E2E', 5)`
      await sql!`update app.work_orders set subcontractor_id = 990213, status = 2
        where id = ${workOrderId}`

      await signIn(page, subEmail, password)
      await page.goto(`/portal/sub/tjx-invoices/${workOrderId}`)
      await expect(page.getByText(`TJX invoice for work order ${workOrderId}`)).toBeVisible()
      await page.getByLabel('Your invoice number').fill(`SUB-E2E-${Date.now()}`)
      const invoiceNumber = await page.getByLabel('Your invoice number').inputValue()
      await page.getByRole('button', { name: 'Save draft' }).click()
      await expect
        .poll(
          async () => {
            const [row] = await sql!`
              select invoice_number from app.tjx_sub_invoices where work_order_id = ${workOrderId}`
            return row?.invoice_number
          },
          { timeout: 30_000 },
        )
        .toBe(invoiceNumber)

      for (let index = 0; index < 3; index += 1) {
        await page.locator('input[type="file"]').first().setInputFiles({
          name: `gate-${index}.pdf`,
          mimeType: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4\nE2E evidence\n%%EOF'),
        })
        await expect(page.getByText('Evidence on file.')).toHaveCount(index + 1)
      }
      await page.getByRole('button', { name: 'Submit invoice' }).click()
      await expect
        .poll(
          async () => {
            const [row] = await sql!`
              select is_submitted from app.tjx_sub_invoices where work_order_id = ${workOrderId}`
            return row?.is_submitted
          },
          { timeout: 30_000 },
        )
        .toBe(true)

      await signIn(page, email, password)
      await page.goto(`/tjx/invoices/${workOrderId}`)
      await page.getByRole('button', { name: 'Approve invoice' }).click()
      await expect
        .poll(
          async () => {
            const [row] = await sql!`
              select si.approved_at is not null as approved
              from app.tjx_sub_invoices si where si.work_order_id = ${workOrderId}`
            return row?.approved
          },
          { timeout: 30_000 },
        )
        .toBe(true)

      const [subInvoice] = await sql!`
        select id, is_submitted, invoice_number, subcontractor_invoice_id, rejected_count
        from app.tjx_sub_invoices where work_order_id = ${workOrderId}`
      expect(subInvoice!.is_submitted).toBe(true)
      expect(subInvoice!.rejected_count).toBe(0)
      const [standard] = await sql!`
        select invoice_number, status, total_amount from app.subcontractor_invoices
        where id = ${subInvoice!.subcontractor_invoice_id}`
      expect(standard!.invoice_number).toBe(subInvoice!.invoice_number)
      expect(standard!.status).toBe('approved')
      const postings = await sql!`
        select id from app.sage_postings
        where doc_type = 'subcontractor_invoice' and doc_id = ${subInvoice!.subcontractor_invoice_id}`
      expect(postings).toHaveLength(1)
      const [approvedWorkOrder] = await sql!`
        select status from app.work_orders where id = ${workOrderId}`
      expect(approvedWorkOrder!.status).toBe(4)
    } finally {
      await cleanup(quoteIds, email, workOrderId, subEmail)
      if (authUserId) await deleteThrowaway(authUserId)
      if (subAuthUserId) await deleteThrowaway(subAuthUserId)
    }
  })
})
