import { expect, test } from '@playwright/test'
import postgres from 'postgres'
import { randomBytes } from 'node:crypto'
import { createThrowaway, deleteThrowaway, e2eConfigured } from './support/throwaway'

/**
 * Work Orders primary path and one authorization-denial path.
 *
 * These tests write to the migrated E2E database and clean up after themselves.
 * They are skipped when the Neon admin credentials are absent, because a real
 * signed-in session cannot be provisioned without them. See
 * docs/platform/MODULE-CONTRACT.md §8.2.
 */
try {
  process.loadEnvFile('.env')
} catch {
  // No .env — the skip guard below explains what is missing.
}

const DATABASE_URL = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
const SITE_ID = 990101
const CUSTOMER_ID = 990102
const SUB_ID = 990103

const sql = DATABASE_URL ? postgres(DATABASE_URL, { prepare: false, max: 2 }) : null

async function seedReference(): Promise<void> {
  await sql!`
    insert into public.wo_servtype (id, name) values (1, 'Interior'), (2, 'Exterior')
    on conflict (id) do nothing`
  await sql!`
    insert into public.wo_priority (id, name) values (1, 'High'), (3, 'Normal')
    on conflict (id) do nothing`
  await sql!`
    insert into public.customer (id, name) values (${CUSTOMER_ID}, 'E2E Customer')
    on conflict (id) do nothing`
  await sql!`
    insert into public.sites (id, custid, name, street, city, province, postalcode)
    values (${SITE_ID}, ${CUSTOMER_ID}, 'E2E Site', '1 E2E Way', 'Toronto', 'ON', 'M5V 0A1')
    on conflict (id) do nothing`
  await sql!`
    insert into public.subcontractor (id, name, street, city, province, postalcode, cname, cnumber, cemail1)
    values (${SUB_ID}, 'E2E Subcontractor', '2 E2E Way', 'Toronto', 'ON', 'M5V 0A2', 'E2E Contact', '416-555-0100', 'e2e@example.invalid')
    on conflict (id) do nothing`
  await sql!`
    insert into public.subcontractor_wsib_insurance_documents (subid, document_type, document_name, is_expired, expiration_date)
    select ${SUB_ID}, 'WSIB', 'E2E WSIB certificate', 0, '2099-01-01'
    where not exists (
      select 1 from public.subcontractor_wsib_insurance_documents where subid = ${SUB_ID}
    )`
}

async function cleanupReference(workOrderIds: number[], emails: string[]): Promise<void> {
  for (const id of workOrderIds) {
    // Audit rows have no foreign key to the record, so delete them explicitly.
    await sql!`delete from app.work_order_notifications where work_order_id = ${id}`
    await sql!`delete from app.audit_log where entity_type = 'work_order' and entity_id = ${String(id)}`
    await sql!`delete from app.work_orders where id = ${id}`
  }
  for (const email of emails) {
    await sql!`delete from app.users where email = ${email}`
  }
  await sql!`delete from public.subcontractor_wsib_insurance_documents where subid = ${SUB_ID}`
  await sql!`delete from public.subcontractor where id = ${SUB_ID}`
  await sql!`delete from public.sites where id = ${SITE_ID}`
  await sql!`delete from public.customer where id = ${CUSTOMER_ID}`
}

test.describe('work orders', () => {
  // Both tests share the same reference rows and clean up in `finally`; running
  // them in parallel lets one test delete rows the other is using.
  test.describe.configure({ mode: 'serial', timeout: 120_000 })

  test.skip(!e2eConfigured(), 'Neon admin credentials and E2E database are required.')

  test('create → dispatch → capture → complete → invoice-ready snapshot', async ({ page }) => {
    page.setDefaultTimeout(15_000)
    const email = `e2e-wo-${Date.now()}@example.invalid`
    const password = randomBytes(24).toString('base64url')
    const workOrderIds: number[] = []
    let authUserId: string | null = null

    try {
      await seedReference()
      const authUser = await createThrowaway(email, password)
      authUserId = authUser.id
      await sql!`
        insert into app.users (email, username, display_name, role)
        values (${email}, ${`e2e${Date.now()}`}, 'E2E Admin', 'admin')`

      await page.goto('/login')
      await page.getByLabel('Username or email').fill(email)
      await page.getByLabel('Password').fill(password)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page).toHaveURL(/\/$/)

      await page.goto('/work-orders/new')
      await page.getByPlaceholder('Search sites or customers…').fill('E2E Site')
      await page.getByRole('button', { name: /E2E Site/ }).click()
      await page.getByLabel('Service type').selectOption({ label: 'Exterior' })
      await page.getByLabel('Priority').selectOption({ label: 'High' })
      await page
        .getByLabel('Service required')
        .fill('Replace the exterior ballast and confirm the circuit.')
      await page.getByLabel('Customer PO').fill('PO-E2E-1')
      await page.getByPlaceholder('Search subcontractors…').fill('E2E Subcontractor')
      await page.getByRole('button', { name: /E2E Subcontractor/ }).click()
      await page.getByRole('button', { name: 'Create work order' }).click()

      await expect(page).toHaveURL(/\/work-orders\/\d+/)
      const id = Number(page.url().match(/\/work-orders\/(\d+)/)?.[1])
      expect(id).toBeGreaterThan(0)
      workOrderIds.push(id)
      await expect(page.getByRole('heading', { level: 1 })).toContainText('E2E Site')

      await page.getByRole('button', { name: 'Dispatch' }).click()
      await expect(page.getByText(/^dispatched$/i).first()).toBeVisible()

      await page.getByRole('tab', { name: 'Labour' }).click()
      await page.getByLabel('Hours').fill('2')
      await page.getByLabel('Rate', { exact: true }).fill('85')
      await page.getByRole('button', { name: 'Add labour' }).click()
      await expect(page.getByRole('cell', { name: '2.00', exact: true })).toBeVisible()

      await page.getByRole('tab', { name: 'Parts' }).click()
      await page.getByLabel('Part').fill('BALLAST-1')
      await page.getByLabel('Qty').first().fill('3')
      await page.getByLabel('Price').first().fill('12.99')
      await page.getByLabel('Description', { exact: true }).fill('E2E ballast')
      await page.getByRole('button', { name: 'Add part' }).click()
      await expect(page.getByRole('cell', { name: 'BALLAST-1' })).toBeVisible()

      await page.getByRole('button', { name: 'Mark complete' }).click()
      await expect(page.getByText(/^complete$/i).first()).toBeVisible()

      await page.getByRole('tab', { name: 'Invoice ready' }).click()
      await expect(page.getByText('$208.97')).toBeVisible()
      await expect(page.getByText('$236.14')).toBeVisible()
    } finally {
      await cleanupReference(workOrderIds, [email])
      if (authUserId) await deleteThrowaway(authUserId)
    }
  })

  test('technician cannot read an unassigned work order', async ({ page }) => {
    const email = `e2e-tech-${Date.now()}@example.invalid`
    const password = randomBytes(24).toString('base64url')
    const workOrderId = 900900 + Math.floor(Math.random() * 90)
    let authUserId: string | null = null

    try {
      await seedReference()
      await sql!`
        insert into app.work_orders (id, series, site_id, service_type_id, priority_id, status, service_required)
        values (${workOrderId}, 1, ${SITE_ID}, 1, 1, 1, 'Unassigned scope check')`

      const authUser = await createThrowaway(email, password)
      authUserId = authUser.id
      await sql!`
        insert into app.users (email, username, display_name, role)
        values (${email}, ${`e2etech${Date.now()}`}, 'E2E Technician', 'technician')`

      await page.goto('/login')
      await page.getByLabel('Username or email').fill(email)
      await page.getByLabel('Password').fill(password)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page).toHaveURL(/\/$/)

      await page.goto(`/work-orders/${workOrderId}`)
      await expect(page.getByText(/couldn.t load this/i)).toBeVisible()
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(0)
    } finally {
      await cleanupReference([workOrderId], [email])
      if (authUserId) await deleteThrowaway(authUserId)
    }
  })
})
