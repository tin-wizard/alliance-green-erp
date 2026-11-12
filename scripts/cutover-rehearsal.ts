/* eslint-disable no-console -- the rehearsal's printed report is its product. */
/**
 * Cutover rehearsal: run both phases of `cutover` mode against dev data.
 *
 * Purpose: rehearse the mechanics and produce the evidence-pack rows (one run
 * per phase plus findings) before the client's live dump exists. The baseline is
 * built from the documents already in this database when there are any, and
 * topped up with synthetic documents so every documented legacy quirk is
 * classified at least once. The "ledger" side is a stub in this file: nothing is
 * sent to Sage, so the rehearsal cannot touch a tenant.
 *
 * Usage:
 *   node --env-file=.env --import tsx scripts/cutover-rehearsal.ts
 *   node --env-file=.env --import tsx scripts/cutover-rehearsal.ts --dry
 *
 * `--dry` computes and prints without writing run rows, and runs only the
 * document phase (the allocation phase requires a real document-phase row). It
 * still (re)seeds the rehearsal link rows, because a converted document without
 * a link is indistinguishable from a missing one.
 */
import { eq, like } from 'drizzle-orm'
import { getDb } from '@cls/db'
import { sageLinks, sagePostings } from '@cls/db/schema'
import type { CutoverBaseline, CutoverPhase } from '@cls/sage'
import type { ReconcileHttp } from '../apps/web/src/modules/sage/server/reconcile.shared'
import {
  runCutoverReconciliation,
  type CutoverResult,
} from '../apps/web/src/modules/sage/server/cutover.server'

interface RehearsalDocument {
  externalRef: string
  docType: string
  contactRef: string
  period: string
  /** Converted values, which is what the ledger will report. */
  net: number
  tax: number
  total: number
  /** Legacy values, which is what the signed extract says. */
  legacyTax: number
  legacyTotal: number
  settledInSource: boolean
  multiAuthority: boolean
  /** Only in the ledger (a zero-tax sale the legacy could not post). */
  ledgerOnly: boolean
}

function syntheticDocuments(): RehearsalDocument[] {
  // The five quirks from SAGE50-MIGRATION §6.5, one document each, plus a clean
  // control document that must produce no finding at all.
  return [
    {
      externalRef: 's50:rehearsal:sales_invoice:1',
      docType: 'sales_invoice',
      contactRef: 's50-contact:rehearsal-1',
      period: '2026-09',
      net: 10_000,
      tax: 500,
      total: 10_500,
      // Legacy hard-coded 13% on a 5% document.
      legacyTax: 1_300,
      legacyTotal: 11_300,
      settledInSource: true,
      multiAuthority: false,
      ledgerOnly: false,
    },
    {
      externalRef: 's50:rehearsal:purchase_invoice:2',
      docType: 'purchase_invoice',
      contactRef: 's50-contact:rehearsal-2',
      period: '2026-09',
      net: 200_000,
      tax: 24_001,
      total: 224_001,
      legacyTax: 23_998,
      legacyTotal: 223_998,
      settledInSource: false,
      multiAuthority: true,
      ledgerOnly: false,
    },
    {
      externalRef: 's50:rehearsal:sales_invoice:3',
      docType: 'sales_invoice',
      contactRef: 's50-contact:rehearsal-3',
      period: '2026-10',
      net: 102_019_615,
      tax: 13_262_850,
      total: 115_282_465,
      legacyTax: 13_262_849,
      legacyTotal: 115_282_464,
      settledInSource: false,
      multiAuthority: false,
      ledgerOnly: false,
    },
    {
      externalRef: 's50:rehearsal:sales_invoice:4',
      docType: 'sales_invoice',
      contactRef: 's50-contact:rehearsal-4',
      period: '2026-10',
      net: 5_000,
      tax: 0,
      total: 5_000,
      legacyTax: 0,
      legacyTotal: 5_000,
      settledInSource: false,
      multiAuthority: false,
      // The legacy could not post a zero-tax sale; this exists only in the cloud.
      ledgerOnly: true,
    },
    {
      externalRef: 's50:rehearsal:sales_invoice:5',
      docType: 'sales_invoice',
      contactRef: 's50-contact:rehearsal-5',
      period: '2026-10',
      net: 20_000,
      tax: 2_600,
      total: 22_600,
      legacyTax: 2_600,
      legacyTotal: 22_600,
      settledInSource: false,
      multiAuthority: false,
      ledgerOnly: false,
    },
  ]
}

/** Replaces the stub's answers for refs the database already has. */
async function documentsFromDatabase(): Promise<RehearsalDocument[]> {
  const db = getDb()
  const rows = await db
    .select({
      externalRef: sagePostings.externalRef,
      docType: sagePostings.docType,
      payload: sagePostings.payload,
      requestedAt: sagePostings.requestedAt,
    })
    .from(sagePostings)
    .where(eq(sagePostings.status, 'sent'))
    .limit(50)
  const links = await db.select({ externalRef: sageLinks.externalRef }).from(sageLinks)
  const linked = new Set(links.map((link) => link.externalRef))

  return rows
    .filter((row) => linked.has(row.externalRef))
    .map((row, index) => {
      const payload = row.payload as { subtotal?: string; tax?: string; total?: string }
      const net = Math.round(Number(payload.subtotal ?? 0) * 100)
      const tax = Math.round(Number(payload.tax ?? 0) * 100)
      const total = Math.round(Number(payload.total ?? 0) * 100)
      return {
        externalRef: row.externalRef,
        docType: row.docType,
        contactRef: `s50-contact:dev-${index + 1}`,
        period: row.requestedAt.toISOString().slice(0, 7),
        net,
        tax,
        total,
        legacyTax: tax,
        legacyTotal: total,
        settledInSource: false,
        multiAuthority: false,
        ledgerOnly: false,
      }
    })
}

function buildBaseline(
  documents: RehearsalDocument[],
  source: string,
): CutoverBaseline {
  const receivables = documents
    .filter((document) => !document.ledgerOnly && document.docType === 'sales_invoice')
    .map((document) => ({
      contactRef: document.contactRef,
      cents: document.settledInSource ? 0 : document.legacyTotal,
    }))
  const payables = documents
    .filter((document) => !document.ledgerOnly && document.docType !== 'sales_invoice')
    .map((document) => ({
      contactRef: document.contactRef,
      cents: document.settledInSource ? 0 : document.legacyTotal,
    }))
  return {
    snapshotId: `rehearsal-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`,
    capturedAt: new Date().toISOString(),
    capturedBy: 'cutover-rehearsal',
    source,
    verifiedQueries: [
      'VERIFY 1: live row counts vs extract (not run: rehearsal)',
      'VERIFY 2: tax totals by code and period (not run: rehearsal)',
      'VERIFY 3: open items by contact (not run: rehearsal)',
    ],
    // A ledger-only document (the zero-tax addition) is not in the extract at
    // all; it is discovered through its link, which is how the runner finds it.
    documents: documents.filter((document) => !document.ledgerOnly).map((document) => ({
      externalRef: document.externalRef,
      docType: document.docType,
      period: document.period,
      contactRef: document.contactRef,
      subtotalCents: document.net,
      taxCents: document.legacyTax,
      totalCents: document.legacyTotal,
      settledInSource: document.settledInSource,
      allocatedInSourceCents: document.settledInSource ? document.legacyTotal : undefined,
      multiAuthority: document.multiAuthority,
    })),
    receivables,
    payables,
  }
}

function stubLedger(
  documents: RehearsalDocument[],
  phase: CutoverPhase,
): ReconcileHttp {
  const byRef = new Map(documents.map((document) => [document.externalRef, document]))
  return {
    async request({ path }) {
      const collection = path.split('/')[0]!
      const apiId = path.split('/')[1]!.split('?')[0]!
      const ref = `s50:rehearsal:${collection === 'purchase_invoices' ? 'purchase_invoice' : 'sales_invoice'}:${apiId}`
      const document = byRef.get(ref)
      if (!document) {
        return { status: 200, body: 'null', json: null, headers: new Headers() }
      }
      // After the document pass the ledger shows the document open; the
      // allocation pass shows the source allocation applied.
      const settled = phase === 'allocations' && document.settledInSource
      const json = {
        id: apiId,
        total_amount: (document.total / 100).toFixed(2),
        tax_amount: (document.tax / 100).toFixed(2),
        net_amount: (document.net / 100).toFixed(2),
        outstanding_amount: settled ? '0.00' : (document.total / 100).toFixed(2),
        contact_id: document.contactRef.replace('s50-contact:', 'ledger-contact:'),
        payments_allocations: settled ? [{ amount: (document.legacyTotal / 100).toFixed(2) }] : [],
      }
      return { status: 200, body: JSON.stringify(json), json, headers: new Headers() }
    },
  }
}

function contactMapFor(documents: RehearsalDocument[]): Record<string, string> {
  return Object.fromEntries(
    documents.map((document) => [
      document.contactRef,
      document.contactRef.replace('s50-contact:', 'ledger-contact:'),
    ]),
  )
}

function printResult(label: string, result: CutoverResult): void {
  console.log(`\n${label}`)
  console.log(`  status            ${result.status}`)
  console.log(`  run id            ${result.runId ?? '(dry run, not stored)'}`)
  console.log(`  divergence        $${(result.divergenceTotalCents / 100).toFixed(2)}`)
  console.log(`  allocations due   ${result.allocationsPending}`)
  const quirks = Object.entries(result.quirkCounts).filter(([, count]) => count > 0)
  console.log(
    `  quirks classified ${quirks.length === 0 ? 'none' : quirks.map(([name, count]) => `${name}=${count}`).join(', ')}`,
  )
  console.log(`  findings          ${result.findings} (${result.blockers} blocker, ${result.warnings} warning)`)
  if (result.reason) console.log(`  reason            ${result.reason}`)
}

/**
 * Cutover compares documents that the converter linked. The rehearsal's fixture
 * documents therefore get link rows in a reserved doc-id range, replaced on
 * every run so a rerun shows the same result.
 */
async function seedRehearsalLinks(documents: RehearsalDocument[]): Promise<void> {
  const db = getDb()
  await db.delete(sageLinks).where(like(sageLinks.externalRef, 's50:rehearsal:%'))
  const fixtures = documents.filter((document) => document.externalRef.startsWith('s50:rehearsal:'))
  if (fixtures.length === 0) return
  await db.insert(sageLinks).values(
    fixtures.map((document, index) => ({
      docType: document.docType,
      docId: 995_001 + index,
      externalRef: document.externalRef,
      externalId: String(index + 1),
    })),
  )
}

async function main(): Promise<void> {
  const dry = process.argv.includes('--dry')
  const fromDatabase = await documentsFromDatabase()
  const synthetic = syntheticDocuments()
  const documents = [...fromDatabase, ...synthetic]
  const source = fromDatabase.length > 0
    ? `dev-data (${fromDatabase.length} sent document(s)) + rehearsal fixtures (${synthetic.length})`
    : `rehearsal fixtures only (${synthetic.length}); no sent documents in this database`

  await seedRehearsalLinks(documents)
  const baseline = buildBaseline(documents, source)
  console.log(`Baseline ${baseline.snapshotId}`)
  console.log(`  source   ${source}`)
  console.log(`  documents ${baseline.documents.length}, receivables ${baseline.receivables.length}, payables ${baseline.payables.length}`)

  const httpDocuments = stubLedger(documents, 'documents')
  const httpAllocations = stubLedger(documents, 'allocations')

  const documentPhase = await runCutoverReconciliation({
    baseline,
    phase: 'documents',
    http: httpDocuments,
    contactMap: contactMapFor(documents),
    dryRun: dry,
  })
  printResult('Phase 1 — after the document pass', documentPhase)

  if (dry) {
    console.log('\n--dry: allocation phase skipped (it requires a stored document-phase run).')
    return
  }

  const allocationPhase = await runCutoverReconciliation({
    baseline,
    phase: 'allocations',
    http: httpAllocations,
    contactMap: contactMapFor(documents),
  })
  printResult('Phase 2 — after the allocation pass', allocationPhase)

  console.log('\nEvidence rows: app.sage_reconciliation_runs (mode=cutover) with their findings.')
  if (allocationPhase.status === 'passed') {
    console.log(
      `Sign with signCutoverRun({ runId: ${allocationPhase.runId}, signedBy: <user uuid>, note: '...' }) once finance has read the divergence.`,
    )
  } else {
    console.log('The allocation phase did not pass; nothing can be signed.')
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
