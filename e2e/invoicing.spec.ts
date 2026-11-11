import { expect, test } from '@playwright/test'
import postgres from 'postgres'
import { randomBytes } from 'node:crypto'
import { createThrowaway, deleteThrowaway, e2eConfigured } from './support/throwaway'

/**
 * Invoicing primary path with real signed-in sessions:
 * create from the work-order snapshot → edit → issue → reject → resubmit →
 * payment, then a subcontractor submit/approve and a cross-subcontractor
 * denial on the detail route.
 */
try {
  process.loadEnvFile('.env')
} catch {
  // The skip guard explains what is missing.
}

const DATABASE_URL = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
const sql = DATABASE_URL ? postgres(DATABASE_URL, { prepare: false, max: 2 }) : null

test.describe('invoicing', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 })
  test.skip(!e2eConfigured(), 'Neon admin credentials and E2E database are required.')

  test('sales lifecycle, subcontractor approval and cross-subcontractor denial', async ({
    page,
    browser,
  }) => {
    page.setDefaultTimeout(20_000)
    const suffix = Date.now()
    const siteId = 9_800_000 + (suffix % 100_000)
    const woSales = siteId * 10 + 1
    const woSub = siteId * 10 + 2
    const subId = 9_850_000 + (suffix % 100_000)
    const otherSubId = subId + 1
    const adminEmail = `e2e-invoice-admin-${suffix}@example.invalid`
    const subEmail = `e2e-invoice-sub-${suffix}@example.invalid`
    const otherEmail = `e2e-invoice-other-${suffix}@example.invalid`
    const subInvoiceNumber = `E2E-SUB-${suffix}`
    const password = randomBytes(24).toString('base64url')
    const created: string[] = []

    try {
      await sql!`
        insert into app.sites (id, customer_id, name, province)
        values (${siteId}, ${siteId + 7}, ${`E2E Invoice Site ${suffix}`}, 'ON')`
      await sql!`
        insert into app.subcontractors (id, name, province)
        values (${subId}, ${`E2E Invoice Sub ${suffix}`}, 'ON'),
               (${otherSubId}, ${`E2E Other Sub ${suffix}`}, 'ON')`
      await sql!`
        insert into app.work_orders (id, site_id, status, service_required, completed_at)
        values (${woSales}, ${siteId}, 2, 'E2E invoice lifecycle', now()),
               (${woSub}, ${siteId}, 2, 'E2E sub invoice', now())`
      await sql!`
        update app.work_orders set subcontractor_id = ${subId} where id = ${woSub}`
      await sql!`
        insert into app.work_order_hours (work_order_id, line_date, hours, rate_code, hourly_rate, note)
        values (${woSales}, '2026-02-01', 2.00, 1, 50.00, 'E2E labour')`
      await sql!`
        insert into app.work_order_tax (work_order_id, tax_province)
        values (${woSales}, 'ON'), (${woSub}, 'ON')`

      const adminAuth = await createThrowaway(adminEmail, password)
      const subAuth = await createThrowaway(subEmail, password)
      const otherAuth = await createThrowaway(otherEmail, password)
      created.push(adminAuth.id, subAuth.id, otherAuth.id)
      await sql!`
        insert into app.users (email, username, display_name, role, subcontractor_id)
        values (${adminEmail}, ${`e2einvoicea${suffix}`}, 'E2E Invoice Admin', 'admin', null),
               (${subEmail}, ${`e2einvoicesub${suffix}`}, 'E2E Invoice Sub', 'subcontractor', ${subId}),
               (${otherEmail}, ${`e2einvoiceother${suffix}`}, 'E2E Other Sub', 'subcontractor', ${otherSubId})`

      // Sales invoice: snapshot → edit → issue → reject → resubmit → pay.
      await page.goto('/login')
      await page.getByLabel('Username or email').fill(adminEmail)
      await page.getByLabel('Password').fill(password)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page).toHaveURL(/\/$/)

      await page.goto('/invoicing/new')
      await page.getByTestId('invoice-wo').fill(String(woSales))
      await page.getByRole('button', { name: 'Create invoice' }).click()
      await expect(page).toHaveURL(/\/invoicing\/\d+/)
      const invoiceUrl = page.url()
      await expect(page.getByTestId('invoice-status')).toContainText('draft')

      await page.getByTestId('invoice-hours-0').fill('3')
      await page.getByTestId('invoice-recalculate').click()
      await expect(page.getByText(/Labour \$150\.00/)).toBeVisible()
      await page.getByTestId('invoice-save').click()
      await expect(page.getByTestId('invoice-status')).toContainText('draft')
      await expect(page.getByText('Stored total on the invoice: $169.50')).toBeVisible()

      await page.getByTestId('invoice-issue').click()
      await expect(page.getByTestId('invoice-status')).toContainText('issued', { timeout: 30_000 })
      await expect(page.getByText(/Sage: queued/)).toBeVisible()

      await page.getByTestId('invoice-reason').fill('E2E customer rejected the labour hours')
      await page.getByTestId('invoice-reject').click()
      await expect(page.getByTestId('invoice-status')).toContainText('rejected', { timeout: 30_000 })
      await expect(page.getByText('E2E customer rejected the labour hours')).toBeVisible()

      // The work-order tab surfaces the rejection reason too.
      await page.goto(`/work-orders/${woSales}`)
      await page.getByRole('tab', { name: 'Invoice ready' }).click()
      await expect(page.getByText(/Rejected: E2E customer rejected/)).toBeVisible()
      await page.goto(invoiceUrl)

      await page.getByTestId('invoice-resubmit').click()
      await expect(page.getByTestId('invoice-status')).toContainText('draft')

      await page.getByTestId('invoice-issue').click()
      await expect(page.getByTestId('invoice-status')).toContainText('issued', { timeout: 30_000 })

      await page.getByTestId('invoice-payment').click()
      await expect(page.getByTestId('invoice-status')).toContainText('paid', { timeout: 30_000 })

      // The work order carries the rejection history, not just the invoice.
      const rejections = await sql!`
        select ri.reason
        from app.rejected_invoices ri
        join app.sales_invoices si on si.id = ri.invoice_id
        where si.work_order_id = ${woSales}`
      expect(rejections.map((row) => row.reason)).toContain(
        'E2E customer rejected the labour hours',
      )
      const [invoice] = await sql!`
        select status, total_amount from app.sales_invoices where work_order_id = ${woSales}`
      expect(invoice!.status).toBe('paid')
      expect(Number(invoice!.total_amount)).toBe(169.5)

      // Subcontractor submits against their own work order.
      const subContext = await browser.newContext()
      const subPage = await subContext.newPage()
      subPage.setDefaultTimeout(20_000)
      await subPage.goto('/login')
      await subPage.getByLabel('Username or email').fill(subEmail)
      await subPage.getByLabel('Password').fill(password)
      await subPage.getByRole('button', { name: 'Sign in' }).click()
      await expect(subPage).toHaveURL(/\/$/)
      await subPage.goto('/portal/sub/invoices')
      await subPage.getByTestId('sub-work-order').fill(String(woSub))
      await subPage.getByTestId('sub-invoice-number').fill(subInvoiceNumber)
      await subPage.getByTestId('sub-line-qty-0').fill('2')
      await subPage.getByTestId('sub-line-rate-0').fill('100.00')
      await subPage.getByTestId('sub-submit').click()
      await expect(subPage.getByTestId(`sub-invoice-${subInvoiceNumber}`)).toBeVisible()
      await expect(subPage.getByTestId(`sub-invoice-${subInvoiceNumber}`)).toContainText(
        'submitted',
      )
      await subContext.close()

      const [subInvoice] = await sql!`
        select id, total_amount from app.subcontractor_invoices
        where subcontractor_id = ${subId} and invoice_number = ${subInvoiceNumber}`
      expect(subInvoice).toBeTruthy()
      expect(Number(subInvoice!.total_amount)).toBe(226)

      // Office review approves the submitted invoice.
      await page.goto('/invoicing/subcontractor')
      await expect(page.getByTestId(`sub-review-${subInvoiceNumber}`)).toBeVisible({ timeout: 30_000 })
      await page.getByTestId(`sub-approve-${subInvoiceNumber}`).click()
      await expect(page.getByTestId(`sub-review-${subInvoiceNumber}`)).toContainText('approved', { timeout: 30_000 })

      // Another subcontractor cannot open that invoice by id.
      const otherContext = await browser.newContext()
      const otherPage = await otherContext.newPage()
      otherPage.setDefaultTimeout(20_000)
      await otherPage.goto('/login')
      await otherPage.getByLabel('Username or email').fill(otherEmail)
      await otherPage.getByLabel('Password').fill(password)
      await otherPage.getByRole('button', { name: 'Sign in' }).click()
      await expect(otherPage).toHaveURL(/\/$/)
      await otherPage.goto(`/portal/sub/invoices/${subInvoice!.id}`)
      await expect(otherPage.getByText('We couldn’t load this.')).toBeVisible({ timeout: 30_000 })
      await otherPage.goto('/portal/sub/invoices')
      await expect(otherPage.getByTestId(`sub-invoice-${subInvoiceNumber}`)).toHaveCount(0)
      await otherContext.close()
    } finally {
      await sql!`delete from app.audit_log where actor_user_id in (select id from app.users where email in (${adminEmail}, ${subEmail}, ${otherEmail}))`
      await sql!`
        delete from app.sage_postings
        where (doc_type = 'sales_invoice' and doc_id in (select id from app.sales_invoices where work_order_id in (${woSales}, ${woSub})))
           or (doc_type = 'subcontractor_invoice' and doc_id in (select id from app.subcontractor_invoices where work_order_id in (${woSales}, ${woSub})))`
      await sql!`
        delete from app.sage_links
        where (doc_type = 'sales_invoice' and doc_id in (select id from app.sales_invoices where work_order_id in (${woSales}, ${woSub})))
           or (doc_type = 'subcontractor_invoice' and doc_id in (select id from app.subcontractor_invoices where work_order_id in (${woSales}, ${woSub})))`
      await sql!`delete from app.generated_documents where entity_type = 'sales_invoice' and entity_id::text in (select id::text from app.sales_invoices where work_order_id in (${woSales}, ${woSub}))`
      await sql!`delete from app.sales_invoices where work_order_id in (${woSales}, ${woSub})`
      await sql!`delete from app.subcontractor_invoices where work_order_id in (${woSales}, ${woSub})`
      await sql!`delete from app.work_order_hours where work_order_id in (${woSales}, ${woSub})`
      await sql!`delete from app.work_order_tax where work_order_id in (${woSales}, ${woSub})`
      await sql!`delete from app.work_orders where id in (${woSales}, ${woSub})`
      await sql!`delete from app.sites where id = ${siteId}`
      await sql!`delete from app.users where email in (${adminEmail}, ${subEmail}, ${otherEmail})`
      await sql!`delete from app.subcontractors where id in (${subId}, ${otherSubId})`
      for (const id of created) await deleteThrowaway(id)
    }
  })
})
