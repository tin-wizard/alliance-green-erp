import { expect, test } from '@playwright/test'
import postgres from 'postgres'
import { randomBytes } from 'node:crypto'
import { createThrowaway, deleteThrowaway, e2eConfigured } from './support/throwaway'

/**
 * Purchasing primary path with a real signed-in session:
 * create → request approval → self-approve (audited) → issue → receive → invoice → invoiced.
 * Also proves a technician without po.approve cannot approve, and that a supplier
 * sees only its own purchase orders.
 */
try {
  process.loadEnvFile('.env')
} catch {
  // Skip guard below explains what is missing.
}

const DATABASE_URL = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
const SUPPLIER_ID = 990301
const OTHER_SUPPLIER_ID = 990302

const sql = DATABASE_URL ? postgres(DATABASE_URL, { prepare: false, max: 2 }) : null

test.describe('purchasing', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 })
  test.skip(!e2eConfigured(), 'Neon admin credentials and E2E database are required.')

  test('self-approval, receipt, invoice, denied approval and supplier isolation', async ({
    page,
    browser,
  }) => {
    page.setDefaultTimeout(20_000)
    const suffix = Date.now()
    const adminEmail = `e2e-po-admin-${suffix}@example.invalid`
    const techEmail = `e2e-po-tech-${suffix}@example.invalid`
    const supplierEmail = `e2e-po-supplier-${suffix}@example.invalid`
    const otherSupplierEmail = `e2e-po-supplier2-${suffix}@example.invalid`
    const password = randomBytes(24).toString('base64url')
    const created: string[] = []
    const poIds: number[] = []

    try {
      await sql!`
        insert into app.suppliers (id, name, province, user_id)
        values (${SUPPLIER_ID}, ${`E2E Purchasing Supplier ${suffix}`}, 'ON', null),
               (${OTHER_SUPPLIER_ID}, ${`E2E Other Supplier ${suffix}`}, 'ON', null)
        on conflict (id) do update set name = excluded.name, user_id = null`

      const adminAuth = await createThrowaway(adminEmail, password)
      created.push(adminAuth.id)
      await sql!`
        insert into app.users (email, username, display_name, role)
        values (${adminEmail}, ${`e2epo${suffix}`}, 'E2E Purchasing Admin', 'admin')`

      await page.goto('/login')
      await page.getByLabel('Username or email').fill(adminEmail)
      await page.getByLabel('Password').fill(password)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page).toHaveURL(/\/$/)

      // Draft.
      await page.goto('/purchasing/new')
      await page.getByLabel('Supplier search').fill(`E2E Purchasing Supplier ${suffix}`)
      await page.getByLabel('Supplier', { exact: true }).selectOption(String(SUPPLIER_ID))
      await page.getByLabel('Part number 1').fill(`E2E-PART-${suffix}`)
      await page.getByLabel('Quantity 1').fill('2.00')
      await page.getByLabel('Price 1').fill('10.00')
      await page.getByRole('button', { name: 'Create purchase order' }).click()
      await expect(page).toHaveURL(/\/purchasing\/\d+/)
      const poId = Number(page.url().match(/\/purchasing\/(\d+)/)?.[1])
      poIds.push(poId)
      await expect(page.getByText('$22.60')).toBeVisible()

      // Approval request, then self-approval by the same user.
      await page.getByRole('button', { name: 'Request approval' }).click()
      await expect(page.getByTestId('po-status')).toHaveText('Pending approval')
      await page.getByRole('button', { name: 'Approve' }).click()
      await expect(page.getByTestId('po-status')).toHaveText('Approved')
      await expect(page.getByText(/Self-approved by the same user/)).toBeVisible()
      const approval = await sql!`
        select self_approved, approved_by
        from app.purchase_order_approvals
        where po_id = ${poId} and decision = 'approve'`
      expect(approval).toHaveLength(1)
      expect(approval[0]!.self_approved).toBe(true)

      // Issue, receive in full, invoice, close.
      await page.getByRole('button', { name: 'Issue to supplier' }).click()
      await expect(page.getByTestId('po-status')).toHaveText('Submitted')
      await page.getByRole('button', { name: 'Post receipt' }).click()
      await expect(page.getByTestId('po-status')).toHaveText('Received')
      const movements = await sql!`
        select id, qty from app.inventory_movements where po_id = ${poId}`
      expect(movements).toHaveLength(1)
      expect(movements[0]!.qty).toBe('2.00')

      await page.getByLabel('Supplier invoice number').fill(`E2E-INV-${suffix}`)
      await page.getByRole('button', { name: 'Record invoice' }).click()
      await expect(page.getByText('matched', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Close as invoiced' }).click()
      await expect(page.getByTestId('po-status')).toHaveText('Invoiced')

      // A technician with purchasing:write but no po.approve cannot approve.
      await page.goto('/purchasing/new')
      await page.getByLabel('Supplier search').fill(`E2E Purchasing Supplier ${suffix}`)
      await page.getByLabel('Supplier', { exact: true }).selectOption(String(SUPPLIER_ID))
      await page.getByLabel('Part number 1').fill(`E2E-DENY-${suffix}`)
      await page.getByLabel('Quantity 1').fill('1.00')
      await page.getByLabel('Price 1').fill('5.00')
      await page.getByRole('button', { name: 'Create purchase order' }).click()
      await expect(page).toHaveURL(/\/purchasing\/\d+/)
      const deniedPoId = Number(page.url().match(/\/purchasing\/(\d+)/)?.[1])
      poIds.push(deniedPoId)
      await page.getByRole('button', { name: 'Request approval' }).click()
      await expect(page.getByTestId('po-status')).toHaveText('Pending approval')

      const techAuth = await createThrowaway(techEmail, password)
      created.push(techAuth.id)
      await sql!`
        insert into app.users (email, username, display_name, role)
        values (${techEmail}, ${`e2epotech${suffix}`}, 'E2E Purchasing Tech', 'technician')`
      const techContext = await browser.newContext()
      const techPage = await techContext.newPage()
      techPage.setDefaultTimeout(20_000)
      await techPage.goto('/login')
      await techPage.getByLabel('Username or email').fill(techEmail)
      await techPage.getByLabel('Password').fill(password)
      await techPage.getByRole('button', { name: 'Sign in' }).click()
      await expect(techPage).toHaveURL(/\/$/)
      await techPage.goto(`/purchasing/${deniedPoId}`)
      await expect(techPage.getByTestId('po-status')).toHaveText('Pending approval')
      await expect(techPage.getByRole('button', { name: 'Approve' })).toHaveCount(0)
      await techContext.close()

      // Supplier isolation: only the supplier on the PO can see it.
      const supplierAuth = await createThrowaway(supplierEmail, password)
      created.push(supplierAuth.id)
      const otherAuth = await createThrowaway(otherSupplierEmail, password)
      created.push(otherAuth.id)
      await sql!`
        insert into app.users (email, username, display_name, role)
        values (${supplierEmail}, ${`e2eposup${suffix}`}, 'E2E Purchasing Supplier', 'supplier'),
               (${otherSupplierEmail}, ${`e2eposup2${suffix}`}, 'E2E Other Supplier', 'supplier')`
      const supplierRows = await sql!`select id, email from app.users where email in (${supplierEmail}, ${otherSupplierEmail})`
      const supplierAppUserId = supplierRows.find((row) => row.email === supplierEmail)!.id as string
      const otherAppUserId = supplierRows.find((row) => row.email === otherSupplierEmail)!.id as string
      await sql!`update app.suppliers set user_id = ${supplierAppUserId} where id = ${SUPPLIER_ID}`
      await sql!`update app.suppliers set user_id = ${otherAppUserId} where id = ${OTHER_SUPPLIER_ID}`

      const otherContext = await browser.newContext()
      const otherPage = await otherContext.newPage()
      otherPage.setDefaultTimeout(20_000)
      await otherPage.goto('/login')
      await otherPage.getByLabel('Username or email').fill(otherSupplierEmail)
      await otherPage.getByLabel('Password').fill(password)
      await otherPage.getByRole('button', { name: 'Sign in' }).click()
      await expect(otherPage).toHaveURL(/\/$/)
      await otherPage.goto('/portal/supplier')
      await expect(otherPage.getByText('No purchase orders')).toBeVisible()
      await expect(otherPage.getByText(`PO ${poId}`)).toHaveCount(0)
      await otherContext.close()

      const supplierContext = await browser.newContext()
      const supplierPage = await supplierContext.newPage()
      supplierPage.setDefaultTimeout(20_000)
      await supplierPage.goto('/login')
      await supplierPage.getByLabel('Username or email').fill(supplierEmail)
      await supplierPage.getByLabel('Password').fill(password)
      await supplierPage.getByRole('button', { name: 'Sign in' }).click()
      await expect(supplierPage).toHaveURL(/\/$/)
      await supplierPage.goto('/purchasing')
      await expect(supplierPage.getByText(`E2E Purchasing Supplier ${suffix}`).first()).toBeVisible()
      await supplierPage.goto(`/purchasing/${poId}`)
      await expect(supplierPage.getByText(`PO ${poId}`)).toBeVisible()
      await supplierContext.close()
    } finally {
      for (const id of poIds) {
        await sql!`delete from app.inventory_movements where po_id = ${id}`
        await sql!`delete from app.audit_log where entity_type = 'purchase_order' and entity_id = ${String(id)}`
        await sql!`delete from app.purchase_orders where id = ${id}`
      }
      for (const email of [adminEmail, techEmail, supplierEmail, otherSupplierEmail]) {
        await sql!`delete from app.users where email = ${email}`
      }
      await sql!`delete from app.suppliers where id in (${SUPPLIER_ID}, ${OTHER_SUPPLIER_ID})`
      for (const id of created) await deleteThrowaway(id)
    }
  })
})
