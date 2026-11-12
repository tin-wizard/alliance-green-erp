/**
 * Cutover mode, end to end: two phases against one baseline, the divergence
 * written down, and a signature that refuses everything it should.
 */
import { eq, like } from 'drizzle-orm'
import { afterAll, describe, expect, test } from 'vitest'

import { getConfig } from '@cls/core/env.server'
import { getDb } from '@cls/db'
import {
  auditLog,
  sageLinks,
  sageReconciliationFindings,
  sageReconciliationRuns,
} from '@cls/db/schema'
import type { CutoverBaseline } from '@cls/sage'
import type { ReconcileHttp } from './reconcile.shared'
import { runCutoverReconciliation, signCutoverRun } from './cutover.server'

const PREFIX = 's50:test-cutover:'
const SIGNER = crypto.randomUUID()
const BASELINE_ID = `test-baseline-${crypto.randomUUID().slice(0, 8)}`

function databaseConfigured(): boolean {
  try {
    return Boolean(getConfig().databaseUrl)
  } catch {
    return false
  }
}

const READY = databaseConfigured()

const documents: CutoverBaseline['documents'] = [
  {
    externalRef: `${PREFIX}sales_invoice:1`,
    docType: 'sales_invoice',
    period: '2026-09',
    contactRef: 's50-contact:1',
    subtotalCents: 10_000,
    taxCents: 1_300,
    totalCents: 11_300,
    settledInSource: true,
    allocatedInSourceCents: 11_300,
  },
  {
    // The legacy 13% document: 5% tenant, tax differs by 800 cents.
    externalRef: `${PREFIX}sales_invoice:2`,
    docType: 'sales_invoice',
    period: '2026-09',
    contactRef: 's50-contact:1',
    subtotalCents: 10_000,
    taxCents: 1_300,
    totalCents: 11_300,
  },
]

function baseline(): CutoverBaseline {
  return {
    snapshotId: BASELINE_ID,
    capturedAt: '2026-11-12T09:00:00Z',
    capturedBy: 'finance-owner',
    source: 's50-extract:2026-11-12',
    verifiedQueries: ['verify-1', 'verify-2', 'verify-3'],
    documents,
    // The source ageing: document 1 settled, document 2 open at its legacy total.
    receivables: [{ contactRef: 's50-contact:1', cents: 11_300 }],
    payables: [],
  }
}

/** What the ledger reports, after conversion. */
interface LedgerDoc {
  total: string
  tax: string
  net: string
  allocated: string
  outstanding: string
}

const LEDGER: Record<string, LedgerDoc> = {
  [`${PREFIX}sales_invoice:1`]: { total: '113.00', tax: '13.00', net: '100.00', allocated: '113.00', outstanding: '0.00' },
  // Converted at 5%: tax 5.00, total 105.00 against the legacy 113.00.
  [`${PREFIX}sales_invoice:2`]: { total: '105.00', tax: '5.00', net: '100.00', allocated: '0.00', outstanding: '105.00' },
}

function stubHttp(phase: 'documents' | 'allocations' = 'allocations'): ReconcileHttp {
  return {
    async request({ path }) {
      const collection = path.split('/')[0]!
      const apiId = path.split('/')[1]!.split('?')[0]!
      // apiId encodes the baseline ref tail, so the stub can answer by reference.
      const ref = `${PREFIX}${collection === 'sales_invoices' ? 'sales_invoice' : 'purchase_invoice'}:${apiId}`
      const doc = LEDGER[ref]
      // After the document pass nothing is allocated yet: the ledger shows the
      // document open, exactly as the source ageing implies at that point.
      const documentPhase = phase === 'documents'
      const json = doc
        ? {
            id: apiId,
            total_amount: doc.total,
            tax_amount: doc.tax,
            net_amount: doc.net,
            outstanding_amount: documentPhase ? doc.total : doc.outstanding,
            contact_id: 'ledger-contact-1',
            payments_allocations: documentPhase ? [] : [{ amount: doc.allocated }],
          }
        : null
      return { status: 200, body: JSON.stringify(json), json, headers: new Headers() }
    },
  }
}

async function clear(): Promise<void> {
  if (!READY) return
  const db = getDb()
  await db.delete(sageReconciliationRuns).where(eq(sageReconciliationRuns.baselineId, BASELINE_ID))
  await db.delete(sageLinks).where(like(sageLinks.externalRef, `${PREFIX}%`))
  await db.delete(auditLog).where(like(auditLog.summary, `%${BASELINE_ID}%`))
}

async function seedLinks(): Promise<void> {
  const db = getDb()
  await db.insert(sageLinks).values([
    {
      docType: 'sales_invoice',
      docId: 990_101,
      externalRef: `${PREFIX}sales_invoice:1`,
      externalId: '1',
    },
    {
      docType: 'sales_invoice',
      docId: 990_102,
      externalRef: `${PREFIX}sales_invoice:2`,
      externalId: '2',
    },
  ])
}

afterAll(async () => {
  await clear()
})

describe.skipIf(!READY)('cutover mode', () => {
  test('the allocation phase refuses to run before the document phase', async () => {
    await clear()
    const result = await runCutoverReconciliation({
      baseline: baseline(),
      phase: 'allocations',
      http: stubHttp(),
    })
    expect(result.status).toBe('error')
    expect(result.reason).toContain('document-phase run')
  })

  test('the document phase fails while a source-settled document is unallocated', async () => {
    await clear()
    await seedLinks()
    const result = await runCutoverReconciliation({
      baseline: baseline(),
      phase: 'documents',
      http: stubHttp('documents'),
      contactMap: { 's50-contact:1': 'ledger-contact-1' },
    })

    expect(result.status).toBe('failed')
    expect(result.allocationsPending).toBe(1)
    expect(result.reason).toContain('unallocated')
    // The 13% quirk is recorded, and its 800 cents are the divergence.
    expect(result.quirkCounts.HARDCODED_13_PERCENT_LOCAL_LINES).toBe(1)
    expect(result.divergenceTotalCents).toBe(800)

    const findings = await getDb()
      .select()
      .from(sageReconciliationFindings)
      .where(eq(sageReconciliationFindings.runId, result.runId!))
    const quirk = findings.find((finding) => finding.code === 'TAX_QUIRK')
    expect(quirk?.expected).toBe('13.00')
    expect(quirk?.actual).toBe('5.00')
    expect(quirk?.decision).toBe('open')
  })

  test('the allocation phase passes after allocations, and the divergence is signed once', async () => {
    await clear()
    await seedLinks()
    const base = baseline()
    // The document phase first: the ledger has no allocations yet.
    await runCutoverReconciliation({
      baseline: base,
      phase: 'documents',
      http: stubHttp('documents'),
      contactMap: { 's50-contact:1': 'ledger-contact-1' },
    })

    const allocations = await runCutoverReconciliation({
      baseline: base,
      phase: 'allocations',
      http: stubHttp('allocations'),
      contactMap: { 's50-contact:1': 'ledger-contact-1' },
    })
    expect(allocations.status).toBe('passed')
    expect(allocations.allocationsPending).toBe(0)
    expect(allocations.divergenceTotalCents).toBe(800)

    const [run] = await getDb()
      .select()
      .from(sageReconciliationRuns)
      .where(eq(sageReconciliationRuns.id, allocations.runId!))
    expect(run?.divergenceTotal).toBe('8.00')
    expect(run?.phase).toBe('allocations')

    const signed = await signCutoverRun({
      runId: allocations.runId!,
      signedBy: SIGNER,
      note: 'Legacy 13% quirk on two historical invoices; accepted.',
    })
    expect(signed.ok).toBe(true)

    const [afterSign] = await getDb()
      .select()
      .from(sageReconciliationRuns)
      .where(eq(sageReconciliationRuns.id, allocations.runId!))
    expect(afterSign?.signedAt).not.toBeNull()
    expect(afterSign?.signedNote).toContain('13%')

    const audit = await getDb()
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'sage.cutover.sign'))
    expect(audit.some((row) => row.entityId === String(allocations.runId))).toBe(true)

    // A second signature on the same run is refused.
    const again = await signCutoverRun({
      runId: allocations.runId!,
      signedBy: SIGNER,
      note: 'second attempt',
    })
    expect(again.ok).toBe(false)
  })

  test('a document-phase run cannot be signed', async () => {
    await clear()
    await seedLinks()
    const phase1 = await runCutoverReconciliation({
      baseline: baseline(),
      phase: 'documents',
      http: stubHttp('documents'),
      contactMap: { 's50-contact:1': 'ledger-contact-1' },
    })
    const result = await signCutoverRun({
      runId: phase1.runId!,
      signedBy: SIGNER,
      note: 'rehearsal',
    })
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ reason: expect.stringContaining('allocation-phase') })
  })

  test('a ledger that has drifted beyond the quirks cannot be signed', async () => {
    await clear()
    await seedLinks()
    const drifted: Record<string, LedgerDoc> = {
      ...LEDGER,
      [`${PREFIX}sales_invoice:1`]: {
        total: '113.01',
        tax: '13.00',
        net: '100.01',
        allocated: '113.01',
        outstanding: '0.00',
      },
    }
    const http: ReconcileHttp = {
      async request({ path }) {
        const apiId = path.split('/')[1]!.split('?')[0]!
        const doc = drifted[`${PREFIX}sales_invoice:${apiId}`]
        const json = doc
          ? { ...doc, id: apiId, contact_id: 'ledger-contact-1', payments_allocations: [{ amount: doc.allocated }] }
          : null
        return { status: 200, body: JSON.stringify(json), json, headers: new Headers() }
      },
    }
    await runCutoverReconciliation({
      baseline: baseline(),
      phase: 'documents',
      http,
      contactMap: { 's50-contact:1': 'ledger-contact-1' },
    })
    const allocations = await runCutoverReconciliation({
      baseline: baseline(),
      phase: 'allocations',
      http,
      contactMap: { 's50-contact:1': 'ledger-contact-1' },
    })
    expect(allocations.status).toBe('failed')
    const signed = await signCutoverRun({
      runId: allocations.runId!,
      signedBy: SIGNER,
      note: 'drift',
    })
    expect(signed.ok).toBe(false)
    expect(signed).toMatchObject({ reason: expect.stringContaining('failed') })
  })
})
