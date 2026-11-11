import { expect, test } from '@playwright/test'
import postgres from 'postgres'
import { randomBytes } from 'node:crypto'
import { createThrowaway, deleteThrowaway, e2eConfigured } from './support/throwaway'
import { dataOnly } from './support/data-only'

/**
 * RGA primary path with real signed-in sessions:
 * raise → approve → record credit, assert the Sage purchase-credit-note outbox
 * row, then prove another subcontractor cannot open the RGA.
 */
try {
  process.loadEnvFile('.env')
} catch {
  // The skip guard explains what is missing.
}

const DATABASE_URL = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
const sql = DATABASE_URL ? dataOnly(postgres(DATABASE_URL, { prepare: false, max: 2 })) : null

test.describe('rgas', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 })
  test.skip(!e2eConfigured(), 'Neon admin credentials and E2E database are required.')

  test('raise, approve and credit an RGA, then deny another subcontractor', async ({
    page,
    browser,
  }) => {
    page.setDefaultTimeout(20_000)
    const suffix = Date.now()
    const siteId = 9_820_000 + (suffix % 100_000)
    const woId = siteId * 10 + 1
    const subId = 9_860_000 + (suffix % 100_000)
    const otherSubId = subId + 1
    const supplierId = 9_870_000 + (suffix % 100_000)
    const poId = supplierId
    const adminEmail = `e2e-rga-admin-${suffix}@example.invalid`
    const otherEmail = `e2e-rga-other-${suffix}@example.invalid`
    const password = randomBytes(24).toString('base64url')
    const partNo = `E2E-RGA-${suffix}`
    const created: string[] = []

    try {
      await sql!`
        insert into app.sites (id, customer_id, name, province)
        values (${siteId}, ${siteId + 7}, ${`E2E RGA Site ${suffix}`}, 'ON')`
      await sql!`
        insert into app.subcontractors (id, name, province)
        values (${subId}, ${`E2E RGA Sub ${suffix}`}, 'ON'),
               (${otherSubId}, ${`E2E Other RGA Sub ${suffix}`}, 'ON')`
      await sql!`
        insert into app.work_orders (id, site_id, status, service_required, subcontractor_id, completed_at)
        values (${woId}, ${siteId}, 2, 'E2E RGA return', ${subId}, now())`
      await sql!`
        insert into app.suppliers (id, name)
        values (${supplierId}, ${`E2E RGA Supplier ${suffix}`})`
      await sql!`
        insert into app.purchase_orders (id, display_number, supplier_id, status, subtotal, tax, total)
        values (${poId}, ${`PO-E2E-RGA-${suffix}`}, ${supplierId}, 3, 50.00, 6.50, 56.50)`
      await sql!`
        insert into app.purchase_order_parts (po_id, part_no, description, qty, qty_received, price, sort_order)
        values (${poId}, ${partNo}, 'E2E returned fixture', 5, 5, 10.00, 1)`
      await sql!`
        with inv as (
          insert into app.purchase_order_invoices
            (po_id, supplier_id, supplier_invoice_number, invoice_date, subtotal, tax, total, status)
          values (${poId}, ${supplierId}, ${`E2E-RGA-INV-${suffix}`}, '2026-02-01', 50.00, 6.50, 56.50, 'posted')
          returning id
        )
        insert into app.purchase_order_invoice_lines
          (invoice_id, part_line_id, qty, unit_price, line_total, tax_amount, variance, sort_order)
        select inv.id, p.id, 5, 10.00, 50.00, 6.50, 0.00, 0
        from inv, app.purchase_order_parts p
        where p.po_id = ${poId} and p.part_no = ${partNo}`

      const adminAuth = await createThrowaway(adminEmail, password)
      const otherAuth = await createThrowaway(otherEmail, password)
      created.push(adminAuth.id, otherAuth.id)
      await sql!`
        insert into app.users (email, username, display_name, role, subcontractor_id)
        values (${adminEmail}, ${`e2ergaa${suffix}`}, 'E2E RGA Admin', 'admin', null),
               (${otherEmail}, ${`e2ergaother${suffix}`}, 'E2E Other RGA Sub', 'subcontractor', ${otherSubId})`

      await page.goto('/login')
      await page.getByLabel('Username or email').fill(adminEmail)
      await page.getByLabel('Password').fill(password)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page).toHaveURL(/\/$/)

      await page.goto('/rgas/new')
      await page.getByLabel('Supplier', { exact: true }).selectOption(String(supplierId))
      await page.getByLabel('Work order', { exact: true }).selectOption(String(woId))
      await page.getByLabel('Purchase order', { exact: true }).selectOption(String(poId))
      await page.getByLabel('RGA type', { exact: true }).selectOption('credit')
      await page.getByLabel('Part number 1').fill(partNo)
      await page.getByLabel('Part description 1').fill('Returned fixture')
      await page.getByLabel('Part quantity 1').fill('5')
      await page.getByLabel('Return quantity 1').fill('2')
      await page.getByLabel('Part price 1').fill('10.00')
      await page.getByLabel('Reason for return 1').fill('Damaged in transit')
      await page.getByRole('button', { name: 'Raise RGA' }).click()
      await expect(page).toHaveURL(/\/rgas\/\d+/)
      const rgaUrl = page.url()
      const rgaId = Number(rgaUrl.split('/').pop())
      expect(rgaId).toBeGreaterThan(0)
      await expect(page.getByText('Active').first()).toBeVisible()

      await page.getByTestId('approve-rga').click()
      await expect(page.getByText('Saved').first()).toBeVisible({ timeout: 30_000 })

      await page.getByTestId('record-credit').click()
      await expect(page.getByText(/Credit R-/).first()).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText('Invoiced').first()).toBeVisible({ timeout: 30_000 })

      const [credit] = await sql!`
        select id, credit_number, total_amount
        from app.rga_credits
        where rga_id = ${rgaId}`
      expect(credit).toBeTruthy()
      expect(Number(credit!.total_amount)).toBe(22.6)

      const [posting] = await sql!`
        select doc_type, doc_id, external_ref, status
        from app.sage_postings
        where external_ref = ${`cls:rga_credit:${credit!.id}`}`
      expect(posting).toBeTruthy()
      expect(posting!.doc_type).toBe('purchase_credit_note')
      expect(Number(posting!.doc_id)).toBe(Number(credit!.id))
      expect(posting!.status).toBe('queued')

      // Another subcontractor cannot open this RGA.
      const otherContext = await browser.newContext()
      const otherPage = await otherContext.newPage()
      otherPage.setDefaultTimeout(20_000)
      await otherPage.goto('/login')
      await otherPage.getByLabel('Username or email').fill(otherEmail)
      await otherPage.getByLabel('Password').fill(password)
      await otherPage.getByRole('button', { name: 'Sign in' }).click()
      await expect(otherPage).toHaveURL(/\/$/)
      await otherPage.goto(rgaUrl)
      await expect(otherPage.getByText('This RGA belongs to another subcontractor.')).toBeVisible({
        timeout: 30_000,
      })
      await otherContext.close()
    } finally {
      await sql!`delete from app.audit_log where actor_user_id in (select id from app.users where email in (${adminEmail}, ${otherEmail}))`
      await sql!`
        delete from app.sage_postings
        where external_ref in (select 'cls:rga_credit:' || id from app.rga_credits where rga_id in (select id from app.rgas where work_order_id = ${woId}))`
      await sql!`
        delete from app.sage_links
        where external_ref in (select 'cls:rga_credit:' || id from app.rga_credits where rga_id in (select id from app.rgas where work_order_id = ${woId}))`
      await sql!`delete from app.generated_documents where entity_type = 'rga' and entity_id::text in (select id::text from app.rgas where work_order_id = ${woId})`
      await sql!`delete from app.rga_credits where rga_id in (select id from app.rgas where work_order_id = ${woId})`
      await sql!`delete from app.rgas where work_order_id = ${woId}`
      await sql!`
        delete from app.purchase_order_invoice_lines
        where invoice_id in (select id from app.purchase_order_invoices where po_id = ${poId})`
      await sql!`delete from app.purchase_order_invoices where po_id = ${poId}`
      await sql!`delete from app.purchase_order_parts where po_id = ${poId}`
      await sql!`delete from app.purchase_orders where id = ${poId}`
      await sql!`delete from app.suppliers where id = ${supplierId}`
      await sql!`delete from app.work_orders where id = ${woId}`
      await sql!`delete from app.sites where id = ${siteId}`
      await sql!`delete from app.users where email in (${adminEmail}, ${otherEmail})`
      await sql!`delete from app.subcontractors where id in (${subId}, ${otherSubId})`
      for (const id of created) await deleteThrowaway(id)
    }
  })
})
