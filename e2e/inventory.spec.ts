import { expect, test } from '@playwright/test'
import postgres from 'postgres'
import { randomBytes } from 'node:crypto'
import { createThrowaway, deleteThrowaway, e2eConfigured } from './support/throwaway'

/**
 * Inventory primary path with real signed-in sessions:
 * adjust stock → hold the global price lock → save a price → sub-stock
 * visibility (including a subignore part that must stay hidden).
 */
try {
  process.loadEnvFile('.env')
} catch {
  // Skip guard below explains what is missing.
}

const DATABASE_URL = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
const sql = DATABASE_URL ? postgres(DATABASE_URL, { prepare: false, max: 2 }) : null
const SUB_ID = 980_501

test.describe('inventory', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 })
  test.skip(!e2eConfigured(), 'Neon admin credentials and E2E database are required.')

  test('adjust stock, edit a price under the lock, and scope sub-stock visibility', async ({
    page,
    browser,
  }) => {
    page.setDefaultTimeout(20_000)
    const suffix = Date.now()
    const adminAEmail = `e2e-inv-a-${suffix}@example.invalid`
    const adminBEmail = `e2e-inv-b-${suffix}@example.invalid`
    const subEmail = `e2e-inv-sub-${suffix}@example.invalid`
    const password = randomBytes(24).toString('base64url')
    const partNo = `E2E-INV-${suffix}`
    const hiddenPartNo = `E2E-INV-HIDDEN-${suffix}`
    const created: string[] = []
    const emails = [adminAEmail, adminBEmail, subEmail]

    try {
      await sql!`insert into app.subcontractors (id, name, province) values (${SUB_ID}, ${`E2E Inventory Sub ${suffix}`}, 'ON') on conflict (id) do nothing`
      await sql!`update app.part_price_locks set is_locked = false, locked_by = null, locked_by_name = null, lock_time = null, heartbeat_at = null, expires_at = null where id = 1`

      const adminAAuth = await createThrowaway(adminAEmail, password)
      const adminBAuth = await createThrowaway(adminBEmail, password)
      const subAuth = await createThrowaway(subEmail, password)
      created.push(adminAAuth.id, adminBAuth.id, subAuth.id)
      await sql!`
        insert into app.users (email, username, display_name, role, subcontractor_id)
        values (${adminAEmail}, ${`e2einva${suffix}`}, 'E2E Inventory Admin A', 'admin', null),
               (${adminBEmail}, ${`e2einvb${suffix}`}, 'E2E Inventory Admin B', 'admin', null),
               (${subEmail}, ${`e2einvsub${suffix}`}, 'E2E Inventory Sub', 'subcontractor', ${SUB_ID})`

      // Adjust stock through the signed-in UI; the unknown part is auto-created (E3).
      await page.goto('/login')
      await page.getByLabel('Username or email').fill(adminAEmail)
      await page.getByLabel('Password').fill(password)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page).toHaveURL(/\/$/)

      await page.goto('/inventory/adjustments')
      await page.getByLabel('Part number').fill(partNo)
      await page.getByLabel('Quantity (signed)').fill('5.00')
      await page.getByLabel('Reason').fill('E2E cycle count')
      await page.getByRole('button', { name: 'Post adjustment' }).click()
      await expect(page.getByTestId('adjustment-result')).toContainText('Current stock')

      await page.goto('/inventory')
      await page.getByLabel('Search parts').fill(partNo)
      await page.getByRole('button', { name: 'Search', exact: true }).click()
      await expect(page.getByTestId(`stock-current-${partNo}`)).toContainText('5.00')

      // Acquire the global lock, then change a price while holding it.
      await page.goto('/inventory/prices')
      await page.getByTestId('price-lock-acquire').click()
      await expect(page.getByTestId('price-lock-status')).toContainText('You hold the editor lock')
      await page.getByTestId('price-part-search').fill(partNo)
      await page.getByRole('button', { name: 'Search', exact: true }).click()
      await page.getByTestId(`price-part-${partNo}`).click()
      await page.getByTestId('price-cost').fill('12.34')
      await page.getByTestId('price-sell').fill('19.99')
      await page.getByTestId('price-save').click()
      await expect(page.getByTestId('price-save-result')).toContainText('Saved')

      const [adminA] = await sql!`select id from app.users where email = ${adminAEmail}`
      const priceRows = await sql!`
        select field_name, last_value, new_value, changed_by
        from app.part_price_history
        where part_id = (select id from app.parts where part_number = ${partNo})
        order by id`
      expect(priceRows.map((row) => row.field_name).sort()).toEqual(['cost', 'sellPrice'])
      expect(priceRows.every((row) => row.changed_by === adminA!.id)).toBe(true)
      const [priceLock] =
        await sql!`select is_locked, locked_by from app.part_price_locks where id = 1`
      expect(priceLock!.is_locked).toBe(true)
      expect(priceLock!.locked_by).toBe(adminA!.id)

      // A second admin sees the lock held by the first and cannot acquire it while live.
      const secondContext = await browser.newContext()
      const secondPage = await secondContext.newPage()
      secondPage.setDefaultTimeout(20_000)
      await secondPage.goto('/login')
      await secondPage.getByLabel('Username or email').fill(adminBEmail)
      await secondPage.getByLabel('Password').fill(password)
      await secondPage.getByRole('button', { name: 'Sign in' }).click()
      await expect(secondPage).toHaveURL(/\/$/)
      await secondPage.goto('/inventory/prices')
      await expect(secondPage.getByTestId('price-lock-status')).toContainText(
        'E2E Inventory Admin A',
      )
      await expect(secondPage.getByTestId('price-lock-acquire')).toBeDisabled()
      await secondContext.close()

      // A hidden part must not reach the subcontractor portal.
      await sql!`insert into app.parts (id, part_number, name, subignore) values (${-980_501 - (suffix % 1000)}, ${hiddenPartNo}, 'Hidden from subs', true) on conflict (part_number) do update set subignore = true`
      await sql!`
        insert into app.sub_stock_messages (subcontractor_id, username, subject, message)
        values (${SUB_ID}, 'E2E Inventory Admin A', 'E2E stock note', 'Please count aisle 4.')`

      const subContext = await browser.newContext()
      const subPage = await subContext.newPage()
      subPage.setDefaultTimeout(20_000)
      await subPage.goto('/login')
      await subPage.getByLabel('Username or email').fill(subEmail)
      await subPage.getByLabel('Password').fill(password)
      await subPage.getByRole('button', { name: 'Sign in' }).click()
      await expect(subPage).toHaveURL(/\/$/)
      await subPage.goto('/portal/sub/stock')
      await expect(subPage.getByTestId(`sub-stock-part-${partNo}`)).toBeVisible()
      await expect(subPage.getByTestId(`sub-stock-part-${hiddenPartNo}`)).toHaveCount(0)
      await expect(subPage.getByText('E2E stock note')).toBeVisible()
      await subPage.getByRole('button', { name: 'Mark read' }).click()
      await expect(subPage.getByText('read', { exact: true })).toBeVisible()
      await subPage.getByTestId('sub-stock-subscribe').click()
      await expect(subPage.getByRole('button', { name: 'Turn notifications off' })).toBeVisible()
      const [message] = await sql!`
        select is_read from app.sub_stock_messages
        where subcontractor_id = ${SUB_ID} and subject = 'E2E stock note'`
      expect(message!.is_read).toBe(true)
      const [subscription] = await sql!`
        select contain_stock from app.sub_stock_notifications where subcontractor_id = ${SUB_ID}`
      expect(subscription!.contain_stock).toBe(true)
      await subContext.close()
    } finally {
      await sql!`delete from app.part_price_history where part_id in (select id from app.parts where part_number in (${partNo}, ${hiddenPartNo}))`
      await sql!`delete from app.inventory_movements where part_no in (${partNo}, ${hiddenPartNo})`
      await sql!`delete from app.part_stock_adjustments where part_no in (${partNo}, ${hiddenPartNo})`
      await sql!`delete from app.parts where part_number in (${partNo}, ${hiddenPartNo})`
      await sql!`delete from app.sub_stock_messages where subcontractor_id = ${SUB_ID}`
      await sql!`delete from app.sub_stock_notifications where subcontractor_id = ${SUB_ID}`
      await sql!`update app.part_price_locks set is_locked = false, locked_by = null, locked_by_name = null, lock_time = null, heartbeat_at = null, expires_at = null where id = 1`
      for (const email of emails) {
        await sql!`delete from app.audit_log where actor_user_id in (select id from app.users where email = ${email})`
        await sql!`delete from app.users where email = ${email}`
      }
      await sql!`delete from app.subcontractors where id = ${SUB_ID}`
      for (const id of created) await deleteThrowaway(id)
    }
  })
})
