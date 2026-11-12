/**
 * Finding decisions: the write path that stops findings being write-only.
 *
 * Admin-only, a reason is mandatory, and every decision leaves an audit row with
 * the previous state. These tests use their own run rows and delete them.
 */
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { ForbiddenError, ValidationError } from '@cls/core'
import { getConfig } from '@cls/core/env.server'
import { getDb } from '@cls/db'
import {
  auditLog,
  sageReconciliationFindings,
  sageReconciliationRuns,
  users,
} from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import { decideFindingCore, listReconciliation } from './decisions.server'

function databaseConfigured(): boolean {
  try {
    return Boolean(getConfig().databaseUrl)
  } catch {
    return false
  }
}

const READY = databaseConfigured()
const ADMIN_ID = crypto.randomUUID()
const RUN_TAG = `test-decisions-${crypto.randomUUID().slice(0, 8)}`

function session(id: string, role: 'admin' | 'technician'): AuthSessionView {
  return {
    id: crypto.randomUUID(),
    expiresAt: new Date(Date.now() + 3_600_000),
    lastSeenAt: new Date(),
    user: {
      id,
      email: `${role}@example.test`,
      username: role === 'admin' ? 'admin-tester' : 'tech-tester',
      displayName: role === 'admin' ? 'Admin Tester' : 'Tech Tester',
      role,
      subcontractorId: null,
      grants: [{ key: 'sage:reconcile', scopeSubcontractorId: null }],
    },
  }
}

let runId: number | null = null
let findingId: number | null = null

async function seedAdmin(): Promise<void> {
  await getDb()
    .insert(users)
    .values({
      id: ADMIN_ID,
      email: `${RUN_TAG}@example.test`,
      username: RUN_TAG,
      displayName: 'Decision Tester',
      role: 'admin',
    })
    .onConflictDoNothing()
}

async function seed(): Promise<void> {
  const db = getDb()
  const [run] = await db
    .insert(sageReconciliationRuns)
    .values({
      mode: 'manual',
      status: 'failed',
      startedAt: new Date(),
      finishedAt: new Date(),
      findings: 1,
      blockers: 1,
      report: { tag: RUN_TAG },
    })
    .returning({ id: sageReconciliationRuns.id })
  runId = run!.id
  const [finding] = await db
    .insert(sageReconciliationFindings)
    .values({
      runId: runId,
      code: 'TAX_MISMATCH',
      severity: 'blocker',
      docType: 'sales_invoice',
      externalRef: `cls:${RUN_TAG}:sales_invoice:1`,
      expected: '113.00',
      actual: '112.99',
      detail: { field: 'total_amount' },
      owner: 'module-owner',
    })
    .returning({ id: sageReconciliationFindings.id })
  findingId = finding!.id
}

async function clean(): Promise<void> {
  if (!READY) return
  const db = getDb()
  if (runId !== null) {
    await db.delete(sageReconciliationRuns).where(eq(sageReconciliationRuns.id, runId))
  }
  await db.delete(auditLog).where(inArray(auditLog.entityId, [String(findingId ?? 0)]))
  runId = null
  findingId = null
}

beforeAll(async () => {
  if (!READY) return
  await seedAdmin()
  await seed()
})

afterAll(async () => {
  if (!READY) return
  await clean()
  await getDb().delete(users).where(eq(users.id, ADMIN_ID))
})

describe.skipIf(!READY)('decideFindingCore', () => {
  test('an admin records a decision with its reason, and the audit keeps both states', async () => {
    await clean()
    await seed()
    const db = getDb()

    const updated = await db.transaction((tx) =>
      decideFindingCore(
        tx,
        {
          findingId: findingId!,
          decision: 'fixed_externally',
          note: 'Corrected in the ledger by the accountant on 12 Nov.',
        },
        session(ADMIN_ID, 'admin'),
      ),
    )

    expect(updated.id).toBe(findingId)
    expect(updated.decision).toBe('fixed_externally')
    expect(updated.decisionNote).toContain('accountant')
    expect(updated.decidedAt).not.toBeNull()
    expect(updated.decidedBy).toBe(ADMIN_ID)

    const audit = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, String(findingId)))
    const decisionAudit = audit.filter((row) => row.action === 'sage.finding.decide')
    expect(decisionAudit).toHaveLength(1)
    expect(decisionAudit[0]?.before).toMatchObject({ decision: 'open' })
    expect(decisionAudit[0]?.after).toMatchObject({ decision: 'fixed_externally' })
  })

  test('a non-admin cannot decide, even with the permission key', async () => {
    await expect(
      getDb().transaction((tx) =>
        decideFindingCore(
          tx,
          { findingId: findingId!, decision: 'accepted', note: 'looks fine' },
          session(crypto.randomUUID(), 'technician'),
        ),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  test('a decision without a reason is refused', async () => {
    await expect(
      getDb().transaction((tx) =>
        decideFindingCore(
          tx,
          { findingId: findingId!, decision: 'accepted', note: ' x ' },
          session(ADMIN_ID, 'admin'),
        ),
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  test('re-deciding is allowed and audited again, so a change of mind is visible', async () => {
    const db = getDb()
    await db.transaction((tx) =>
      decideFindingCore(
        tx,
        { findingId: findingId!, decision: 'excluded', note: 'Test data from the rehearsal.' },
        session(ADMIN_ID, 'admin'),
      ),
    )
    const audit = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, String(findingId)))
    const decisions = audit.filter((row) => row.action === 'sage.finding.decide')
    expect(decisions).toHaveLength(2)
    expect(decisions.some((row) => JSON.stringify(row.before).includes('fixed_externally'))).toBe(true)
  })

  test('the page query shows decided findings and no longer lists them as open', async () => {
    const view = await listReconciliation(getDb())
    expect(view.runs.some((run) => run.id === runId)).toBe(true)
    expect(view.open.some((finding) => finding.id === findingId)).toBe(false)
    expect(view.decided.some((finding) => finding.id === findingId)).toBe(true)
    const decided = view.decided.find((finding) => finding.id === findingId)
    expect(decided?.decisionNote).toContain('rehearsal')
    // The detail ships pre-serialised, because a server function cannot return jsonb.
    expect(typeof decided?.detail).toBe('string')
  })
})
