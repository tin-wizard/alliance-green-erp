/**
 * Cutover mode's app half (`SAGE-RECONCILIATION.md` §8).
 *
 * The pure evaluator decides what agrees and what diverges. This file does the
 * three things a human cannot: read every baseline document back from the
 * ledger, enforce that the two phases run in order against the same baseline,
 * and write the run plus findings that finance signs.
 *
 * Signing is deliberately narrow: only the allocation-phase run, only when it
 * passed, only once. The signature is the artefact; it must not be possible to
 * sign a half-converted ledger.
 */
import { and, eq } from 'drizzle-orm'
import { getDb } from '@cls/db'
import {
  auditLog,
  sageLinks,
  sageReconciliationRuns,
} from '@cls/db/schema'
import {
  QUIRK_NOTES,
  evaluateCutover,
  type CutoverBaseline,
  type CutoverPhase,
  type CutoverReading,
  type Finding,
} from '@cls/sage'
import { getSageHttp, sageConfig, sageCredentialsPresent } from './gateway.server'
import { COLLECTIONS, cents, getJson, money, type ReconcileHttp } from './reconcile.shared'
import { persistFindings } from './reconcile.server'

export interface CutoverOptions {
  baseline: CutoverBaseline
  phase: CutoverPhase
  /** Injected only by the rehearsal and tests; production reads the shared client. */
  http?: ReconcileHttp
  now?: Date
  dryRun?: boolean
  /** Baseline contact ref → ledger contact id, from the harness row map. */
  contactMap?: Record<string, string>
  maxDocuments?: number
  maxLedgerOnly?: number
}

export interface CutoverResult {
  runId: number | null
  status: 'passed' | 'failed' | 'error'
  findings: number
  blockers: number
  warnings: number
  divergenceTotalCents: number
  quirkCounts: Record<string, number>
  allocationsPending: number
  balanceDifferences: { contactRef: string; expectedCents: number; actualCents: number }[]
  passable: boolean
  reason: string | null
}

const MAX_DOCUMENTS = 200
const MAX_LEDGER_ONLY = 50

export async function runCutoverReconciliation(
  options: CutoverOptions,
): Promise<CutoverResult> {
  const config = sageConfig()
  const now = options.now ?? new Date()
  const db = getDb()
  const baselineId = options.baseline.snapshotId

  if (!config.enabled && !options.http) {
    return recordError(options, 'Sage is disabled; there is no ledger to compare against.')
  }
  if (!sageCredentialsPresent() && !options.http) {
    return recordError(options, 'Sage is unconfigured; the cutover comparison needs a connection.')
  }

  if (options.phase === 'allocations') {
    const [documentsRun] = await db
      .select({ id: sageReconciliationRuns.id, status: sageReconciliationRuns.status })
      .from(sageReconciliationRuns)
      .where(
        and(
          eq(sageReconciliationRuns.mode, 'cutover'),
          eq(sageReconciliationRuns.baselineId, baselineId),
          eq(sageReconciliationRuns.phase, 'documents'),
        ),
      )
      .orderBy(sageReconciliationRuns.id)
      .limit(1)
    if (!documentsRun || documentsRun.status === 'error') {
      return recordError(
        options,
        `The allocation phase needs a completed document-phase run for baseline ${baselineId} first.`,
      )
    }
  }

  const http = options.http ?? getSageHttp()
  const runId = options.dryRun
    ? null
    : ((
        await db
          .insert(sageReconciliationRuns)
          .values({
            mode: 'cutover',
            baselineId,
            phase: options.phase,
            startedAt: now,
            status: 'running',
          })
          .returning({ id: sageReconciliationRuns.id })
      )[0]?.id ?? null)

  try {
    const links = await db
      .select({
        externalRef: sageLinks.externalRef,
        apiId: sageLinks.externalId,
        docType: sageLinks.docType,
      })
      .from(sageLinks)
    const byRef = new Map(links.map((link) => [link.externalRef, link]))
    const readErrors: string[] = []

    const read = async (
      externalRef: string,
      link: { apiId: string; docType: string } | undefined,
    ): Promise<CutoverReading> => {
      if (!link) {
        return {
          externalRef,
          totalCents: null,
          taxCents: null,
          netCents: null,
          allocatedCents: null,
          outstandingCents: null,
          contactId: null,
        }
      }
      const collection = COLLECTIONS[link.docType] ?? 'sales_invoices'
      try {
        const document = (await getJson(
          http,
          `${collection}/${link.apiId}?show_payments_allocations=true`,
        )) as Record<string, unknown> | null
        const allocations = Array.isArray(document?.payments_allocations)
          ? (document?.payments_allocations as Record<string, unknown>[])
          : []
        return {
          externalRef,
          totalCents: cents(document?.total_amount),
          taxCents: cents(document?.tax_amount),
          netCents: cents(document?.net_amount),
          allocatedCents: allocations.reduce((sum, row) => sum + (cents(row.amount) ?? 0), 0),
          outstandingCents: cents(document?.outstanding_amount),
          contactId: document?.contact_id === undefined ? null : String(document.contact_id),
        }
      } catch (error) {
        readErrors.push(
          `${externalRef}: ${error instanceof Error ? error.message : String(error)}`,
        )
        return {
          externalRef,
          totalCents: null,
          taxCents: null,
          netCents: null,
          allocatedCents: null,
          outstandingCents: null,
          contactId: null,
        }
      }
    }

    const documents = options.baseline.documents.slice(0, options.maxDocuments ?? MAX_DOCUMENTS)
    const readings: CutoverReading[] = []
    for (const document of documents) {
      readings.push(await read(document.externalRef, byRef.get(document.externalRef)))
    }

    const baselineRefs = new Set(options.baseline.documents.map((row) => row.externalRef))
    const ledgerOnly: CutoverReading[] = []
    for (const link of links.filter((row) => !baselineRefs.has(row.externalRef))) {
      if (ledgerOnly.length >= (options.maxLedgerOnly ?? MAX_LEDGER_ONLY)) break
      ledgerOnly.push(await read(link.externalRef, link))
    }

    const evaluation = evaluateCutover({
      phase: options.phase,
      baseline: { ...options.baseline, documents },
      readings,
      ledgerOnly,
      contactMap: options.contactMap,
    })

    const findings: Finding[] = [...evaluation.findings]
    if (readErrors.length > 0 && readings.every((row) => row.totalCents === null)) {
      findings.push({
        code: 'MISSING_IN_SAGE',
        severity: 'blocker',
        owner: 'platform',
        detail: { reason: 'every read failed', errors: readErrors.slice(0, 5) },
      })
    }

    const blockers = findings.filter((finding) => finding.severity === 'blocker').length
    const warnings = findings.filter((finding) => finding.severity === 'warning').length
    const passable = blockers === 0 && evaluation.allocationsPending === 0
    const status: 'passed' | 'failed' = passable ? 'passed' : 'failed'

    if (runId !== null) {
      await persistFindings(runId, findings)
      await db
        .update(sageReconciliationRuns)
        .set({
          finishedAt: new Date(),
          status,
          docCount: evaluation.documentsChecked,
          moneyTotal: money(evaluation.months.reduce((sum, month) => sum + month.ledgerTotalCents, 0)),
          divergenceTotal: money(evaluation.divergenceTotalCents),
          findings: findings.length,
          blockers,
          warnings,
          report: {
            baseline: {
              snapshotId: baselineId,
              capturedAt: options.baseline.capturedAt,
              capturedBy: options.baseline.capturedBy,
              source: options.baseline.source,
              verifiedQueries: options.baseline.verifiedQueries,
            },
            phase: options.phase,
            months: evaluation.months,
            quirkCounts: evaluation.quirkCounts,
            quirkNotes: QUIRK_NOTES,
            allocationsPending: evaluation.allocationsPending,
            balanceDifferences: evaluation.balanceDifferences,
            ledgerOnly: ledgerOnly.length,
            readErrors,
          },
        })
        .where(eq(sageReconciliationRuns.id, runId))
    }

    return {
      runId,
      status,
      findings: findings.length,
      blockers,
      warnings,
      divergenceTotalCents: evaluation.divergenceTotalCents,
      quirkCounts: evaluation.quirkCounts,
      allocationsPending: evaluation.allocationsPending,
      balanceDifferences: evaluation.balanceDifferences,
      passable,
      reason: passable
        ? null
        : blockers > 0
          ? `${blockers} blocker(s); the divergence cannot be signed.`
          : `${evaluation.allocationsPending} source-settled document(s) are still unallocated.`,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (runId !== null) {
      await db
        .update(sageReconciliationRuns)
        .set({ finishedAt: new Date(), status: 'error', error: message })
        .where(eq(sageReconciliationRuns.id, runId))
    }
    return {
      runId,
      status: 'error',
      findings: 0,
      blockers: 0,
      warnings: 0,
      divergenceTotalCents: 0,
      quirkCounts: {},
      allocationsPending: 0,
      balanceDifferences: [],
      passable: false,
      reason: message,
    }
  }
}

async function recordError(options: CutoverOptions, message: string): Promise<CutoverResult> {
  let runId: number | null = null
  if (!options.dryRun) {
    const [row] = await getDb()
      .insert(sageReconciliationRuns)
      .values({
        mode: 'cutover',
        baselineId: options.baseline.snapshotId,
        phase: options.phase,
        startedAt: options.now ?? new Date(),
        finishedAt: new Date(),
        status: 'error',
        error: message,
      })
      .returning({ id: sageReconciliationRuns.id })
    runId = row?.id ?? null
  }
  return {
    runId,
    status: 'error',
    findings: 0,
    blockers: 0,
    warnings: 0,
    divergenceTotalCents: 0,
    quirkCounts: {},
    allocationsPending: 0,
    balanceDifferences: [],
    passable: false,
    reason: message,
  }
}

export interface SignCutoverInput {
  runId: number
  signedBy: string
  note: string
  actor?: { id?: string | null; label?: string | null; role?: string | null }
  now?: Date
}

/**
 * Record the finance owner's acceptance of the divergence.
 *
 * Refusals are the point: a documents-phase run, a run with blockers, a rerun of
 * a drifted ledger and a second signature are all rejected. What is signed is
 * one allocation-phase run whose findings agreed.
 */
export async function signCutoverRun(
  input: SignCutoverInput,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const db = getDb()
  const [run] = await db
    .select()
    .from(sageReconciliationRuns)
    .where(eq(sageReconciliationRuns.id, input.runId))
    .limit(1)
  if (!run) return { ok: false, reason: 'No such run.' }
  if (run.mode !== 'cutover') return { ok: false, reason: 'Only a cutover run can be signed.' }
  if (run.phase !== 'allocations') {
    return { ok: false, reason: 'Sign the allocation-phase run; the document phase is a rehearsal.' }
  }
  if (run.status !== 'passed') {
    return { ok: false, reason: `The run is ${run.status}; a failed run cannot be signed.` }
  }
  if (run.blockers > 0) return { ok: false, reason: 'The run has open blockers.' }
  if (run.signedAt) return { ok: false, reason: 'This run was already signed.' }
  if (!input.note.trim()) return { ok: false, reason: 'A signature needs a note.' }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.signedBy)) {
    return { ok: false, reason: 'A signature needs the signing user, identified by their user id.' }
  }

  const signedAt = input.now ?? new Date()
  await db
    .update(sageReconciliationRuns)
    .set({ signedBy: input.signedBy, signedAt, signedNote: input.note.trim() })
    .where(eq(sageReconciliationRuns.id, input.runId))
  await db.insert(auditLog).values({
    actorUserId: input.actor?.id ?? null,
    actorLabel: input.actor?.label ?? input.signedBy,
    actorRole: input.actor?.role ?? null,
    action: 'sage.cutover.sign',
    entityType: 'sage_reconciliation_run',
    entityId: String(input.runId),
    summary: `Signed cutover divergence ${run.divergenceTotal ?? '0.00'} for baseline ${run.baselineId ?? 'unknown'}`,
    before: { signedBy: null, signedNote: null, divergenceTotal: run.divergenceTotal },
    after: { signedBy: input.signedBy, signedNote: input.note.trim(), signedAt: signedAt.toISOString() },
  })

  return { ok: true }
}
