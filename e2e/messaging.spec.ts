import { expect, test } from '@playwright/test'
import postgres from 'postgres'
import { randomBytes, randomUUID } from 'node:crypto'
import { createThrowaway, deleteThrowaway, e2eConfigured } from './support/throwaway'

/**
 * Messaging primary path with real signed-in sessions: a seeded outbox
 * notification is read in the centre, then a staff thread is started and shown.
 */
try {
  process.loadEnvFile('.env')
} catch {
  // The skip guard explains what is missing.
}

const DATABASE_URL = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
const sql = DATABASE_URL ? postgres(DATABASE_URL, { prepare: false, max: 2 }) : null

test.describe('messaging', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 })
  test.skip(!e2eConfigured(), 'Neon admin credentials and E2E database are required.')

  test('notification centre and an internal thread', async ({ page }) => {
    page.setDefaultTimeout(20_000)
    const suffix = Date.now()
    const aliceId = randomUUID()
    const bobId = randomUUID()
    const aliceEmail = `e2e-message-a-${suffix}@example.invalid`
    const bobEmail = `e2e-message-b-${suffix}@example.invalid`
    const password = randomBytes(24).toString('base64url')
    const subject = `E2E notification ${suffix}`
    const threadSubject = `E2E thread ${suffix}`
    const created: string[] = []

    try {
      const aliceAuth = await createThrowaway(aliceEmail, password)
      const bobAuth = await createThrowaway(bobEmail, password)
      created.push(aliceAuth.id, bobAuth.id)
      await sql!`
        insert into app.users (id, email, username, display_name, role)
        values
          (${aliceId}, ${aliceEmail}, ${`e2emsga${suffix}`}, 'E2E Messaging Alice', 'admin'),
          (${bobId}, ${bobEmail}, ${`e2emsgb${suffix}`}, 'E2E Messaging Bob', 'technician')`
      await sql!`
        insert into app.notifications
          (kind, template_key, recipient_user_id, recipient_email, subject, body_text, status, dedupe_key)
        values ('system', 'system-e2e', ${aliceId}, ${aliceEmail}, ${subject}, 'E2E notification body', 'sent', ${`e2e:${suffix}`})`

      await page.goto('/login')
      await page.getByLabel('Username or email').fill(aliceEmail)
      await page.getByLabel('Password').fill(password)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page).toHaveURL(/\/$/)

      await page.goto('/messages')
      await page.getByRole('button', { name: 'Notifications' }).click()
      await expect(page.getByTestId('notification-list')).toContainText(subject)
      await page.getByRole('button', { name: 'Mark read' }).click()
      await expect(page.getByRole('button', { name: 'Mark read' })).toHaveCount(0)

      await page.getByRole('button', { name: 'Threads' }).click()
      await page.getByRole('button', { name: 'New thread' }).click()
      await page.getByLabel('Subject').fill(threadSubject)
      await page.getByLabel('E2E Messaging Bob').check()
      await page.getByLabel('Opening message').fill('Opening body for the E2E thread.')
      await page.getByRole('button', { name: 'Start thread' }).click()
      await expect(page.getByTestId('message-thread')).toContainText(threadSubject)
      await expect(page.getByTestId('message-thread')).toContainText('Opening body for the E2E thread.')
      await expect(page.getByTestId('message-threads')).toContainText('E2E Messaging Bob')
    } finally {
      await sql!`delete from app.audit_log where actor_user_id in (${aliceId}, ${bobId})`
      await sql!`delete from app.message_threads where created_by = ${aliceId}`
      await sql!`delete from app.notifications where recipient_user_id = ${aliceId}`
      await sql!`delete from app.users where id in (${aliceId}, ${bobId})`
      for (const user of created) await deleteThrowaway(user).catch(() => undefined)
    }
  })
})
