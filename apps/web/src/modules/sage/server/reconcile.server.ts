/**
 * The reconciliation run: gather, check, report.
 *
 * The app half does three things and refuses a fourth:
 *
 * 1. **gathers** rows from our tables and documents from Sage;
 * 2. **checks** them with the pure functions in `@cls/sage/reconcile`;
 * 3. **writes** one run row and one row per finding, so finance signs a query;
 * 4. it never repairs. The only automatic repairs are re-linking by external
 *    reference (not built here yet — it is a `MISSING_IN_SAGE` finding until the
 *    operator chooses) and advancing a watermark, and a watermark advances only
 *    after the batch was applied.
 *
 * A run that cannot compare anything is `error` with a reason, never `passed`.
 */
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm'
import { getDb } from '@cls/db'
import {
  sageLinks,
  sagePostings,
  sageReconciliationFindings,
  sageReconciliationRuns,
  sageSyncState,
} from '@cls/db/schema'
import {
  checkAmounts,
  checkBalances,
  checkExternalChanges,
  checkLinkIntegrity,
  checkQueueHealth,
  checkTaxPeriods,
  isSageError,
  summariseRun,
  type DocumentComparison,
  type ExternalEvent,
  type Finding,
  type LinkRow,
  type PostingRow,
  type RunStatus,
  type SageRequest,
  type SageResponse,
  type TaxPeriodComparison,
} from '@cls/sage'
import { getPauseGovernor, getQuotaGovernor, getSageHttp, getTokenService, sageConfig, sageCredentialsPresent } from './gateway.server'

/** The sliver of the HTTP client a run needs. Keeps runs testable without a socket. */
export interface ReconcileHttp {
  request(request: SageRequest): Promise<SageResponse>
}

export type ReconciliationMode = 'daily' | 'cutover' | 'manual'

export interface RunReconciliationOptions {
  mode?: ReconciliationMode
  now?: Date
  http?: ReconcileHttp
  dryRun?: boolean
  /** Caps, so a first run on a large tenant cannot spend the whole quota. */
  maxDocuments?: number
  maxContacts?: number
}

export interface ReconciliationResult {
  runId: number | null
  status: RunStatus
  findings: number
  blockers: number
  warnings: number
  checked: number
  reason: string | null
}

const COLLECTIONS: Record<string, string> = {
  sales_invoice: 'sales_invoices',
  purchase_invoice: 'purchase_invoices',
  purchase_credit_note: 'purchase_credit_notes',
}

function cents(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

function money(centsValue: number | null): string | null {
  return centsValue === null ? null : (centsValue / 100).toFixed(2)
}

function itemsOf(json: unknown): Record<string, unknown>[] {
  const record = json as Record<string, unknown> | null
  const items = record?.$items ?? record?.items
  return Array.isArray(items) ? (items as Record<string, unknown>[]) : []
}

function isoOrEpoch(value: Date | null): string {
  return (value ?? new Date(0)).toISOString()
}

async function getJson(http: ReconcileHttp, path: string): Promise<unknown> {
  const response = await http.request({ method: 'GET', path, quotaClass: 'reconcile' })
  return response.json
}

export async function runReconciliation(
  options: RunReconciliationOptions = {},
): Promise<ReconciliationResult> {
  const config = sageConfig()
  const now = options.now ?? new Date()
  const mode = options.mode ?? 'daily'
  const db = getDb()

  if (!config.enabled || !sageCredentialsPresent()) {
    return recordError(mode, now, 'Sage is disabled or unconfigured; nothing could be compared.', options)
  }

  const http = options.http ?? getSageHttp()
  const startedAt = now
  const runId = options.dryRun
    ? null
    : ((
        await db
          .insert(sageReconciliationRuns)
          .values({ mode, startedAt, status: 'running' })
          .returning({ id: sageReconciliationRuns.id })
      )[0]?.id ?? null)

  try {
    const [postings, links, previousUndecided] = await Promise.all([
      db
        .select({
          docType: sagePostings.docType,
          docId: sagePostings.docId,
          externalRef: sagePostings.externalRef,
          status: sagePostings.status,
          attempts: sagePostings.attempt,
          updatedAt: sagePostings.updatedAt,
          payload: sagePostings.payload,
        })
        .from(sagePostings),
      db
        .select({
          docType: sageLinks.docType,
          docId: sageLinks.docId,
          externalRef: sageLinks.externalRef,
          apiId: sageLinks.externalId,
        })
        .from(sageLinks),
      undecidedWarnings(db, runId),
    ])

    const postingRows: PostingRow[] = postings.map((row) => ({
      docType: row.docType,
      docId: String(row.docId),
      externalRef: row.externalRef,
      status: row.status,
      attempts: row.attempts,
      updatedAt: row.updatedAt,
    }))
    const linkRows: LinkRow[] = links.map((row) => ({
      docType: row.docType,
      docId: String(row.docId),
      externalRef: row.externalRef,
      apiId: row.apiId,
    }))

    const findings: Finding[] = []
    const linkCheck = checkLinkIntegrity({ postings: postingRows, links: linkRows, now })
    findings.push(...linkCheck.findings)

    const quota = await getQuotaGovernor().snapshot()
    const connection = await getTokenService().status()
    const queueCheck = checkQueueHealth({
      postings: postingRows,
      quota: { used: quota.used, limit: quota.limit },
      connection: { state: connection.state, daysSinceRefresh: connection.daysSinceRefresh },
      now,
    })
    findings.push(...queueCheck.findings)

    // §4.2 and §4.5 read the documents we linked, newest first, up to a cap.
    const payloadByRef = new Map(postings.map((row) => [row.externalRef, row.payload]))
    const comparisons: DocumentComparison[] = []
    const taxPeriods = new Map<string, TaxPeriodComparison>()
    const contactIds = new Set<string>()
    const externalEvents: ExternalEvent[] = []
    const readErrors: string[] = []

    const linked = links.filter((link) => COLLECTIONS[link.docType])
    const readLimit = options.maxDocuments ?? 50
    for (const link of linked.slice(0, readLimit)) {
      const collection = COLLECTIONS[link.docType]!
      try {
        const json = await getJson(http, `${collection}/${link.apiId}`)
        const document = (json ?? {}) as Record<string, unknown>
        const payload = payloadByRef.get(link.externalRef) as Record<string, unknown> | undefined
        if (!payload) {
          externalEvents.push({ kind: 'matched', apiId: link.apiId, externalRef: link.externalRef })
          continue
        }
        const expected = {
          totalCents: cents(payload.total) ?? 0,
          taxCents: cents(payload.tax) ?? 0,
          netCents: cents(payload.subtotal) ?? 0,
        }
        const actual = {
          totalCents: cents(document.total_amount),
          taxCents: cents(document.tax_amount),
          netCents: cents(document.net_amount),
        }
        comparisons.push({
          docType: link.docType,
          docId: String(link.docId),
          externalRef: link.externalRef,
          apiId: link.apiId,
          expected,
          actual,
        })

        const contactId = document.contact_id === undefined ? '' : String(document.contact_id)
        if (contactId) contactIds.add(contactId)

        const period = String(document.date ?? '').slice(0, 7) || 'unknown'
        const key = `${period}|all`
        const existing = taxPeriods.get(key) ?? {
          period,
          rateId: 'all',
          expectedCents: 0,
          actualCents: 0,
        }
        existing.expectedCents += expected.taxCents
        existing.actualCents += actual.taxCents ?? 0
        taxPeriods.set(key, existing)
      } catch (error) {
        if (isSageError(error) && error.status === 404) {
          externalEvents.push({
            kind: 'deleted',
            apiId: link.apiId,
            externalRef: link.externalRef,
          })
        } else {
          readErrors.push(
            `${link.docType}:${link.docId}: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
    }

    findings.push(...checkAmounts({ documents: comparisons }).findings)

    // §4.3 — the ledger's documents and allocations against its own outstanding.
    const balances: Parameters<typeof checkBalances>[0]['contacts'] = []
    for (const contactId of [...contactIds].slice(0, options.maxContacts ?? 20)) {
      try {
        const invoices = await getJson(
          http,
          `sales_invoices?contact_id=${encodeURIComponent(contactId)}&items_per_page=200&show_payments_allocations=true`,
        )
        let expectedCents = 0
        for (const invoice of itemsOf(invoices)) {
          const total = cents(invoice.total_amount) ?? 0
          const allocations = Array.isArray(invoice.payments_allocations)
            ? (invoice.payments_allocations as Record<string, unknown>[])
            : []
          const allocated = allocations.reduce((sum, row) => sum + (cents(row.amount) ?? 0), 0)
          expectedCents += total - allocated
        }
        const contact = (await getJson(http, `contacts/${encodeURIComponent(contactId)}`)) as Record<
          string,
          unknown
        > | null
        balances.push({
          contactId,
          expectedCents,
          actualCents: cents(contact?.outstanding_amount),
          // Our opening balance and payments tables arrive with the cutover
          // loader; until then our side is the ledger's own documents.
          source: 'sage-documents',
        })
      } catch (error) {
        balances.push({
          contactId,
          expectedCents: null,
          actualCents: null,
          source: `unreadable: ${error instanceof Error ? error.message : String(error)}`,
        })
      }
    }
    findings.push(...checkBalances({ contacts: balances }).findings)

    // §4.4 — the change feed, classified. Watermarks advance only on success.
    const feed = await pollResourceFeeds(http, now, options.dryRun ?? false)
    externalEvents.push(...feed.events)
    readErrors.push(...feed.errors)
    findings.push(...checkExternalChanges({ events: externalEvents }).findings)
    findings.push(...checkTaxPeriods({ periods: [...taxPeriods.values()] }).findings)

    const summary = summariseRun({
      findings,
      checked: postingRows.length + comparisons.length + balances.length,
      moneyTotalCents: comparisons.reduce((sum, row) => sum + row.expected.totalCents, 0),
      error: readErrors.length > 0 && comparisons.length === 0 ? readErrors.join('; ') : null,
      undecidedPreviousWarnings: previousUndecided,
    })

    if (runId !== null) {
      await persistFindings(runId, findings)
      await db
        .update(sageReconciliationRuns)
        .set({
          finishedAt: new Date(),
          status: summary.status,
          docCount: summary.checked,
          moneyTotal: money(summary.moneyTotalCents),
          findings: summary.findings,
          blockers: summary.blockers,
          warnings: summary.warnings,
          error: summary.reason,
          report: {
            mode,
            checked: summary.checked,
            comparisons: comparisons.length,
            contacts: balances.length,
            readErrors,
            pauses: await getPauseGovernor().report(),
          },
        })
        .where(eq(sageReconciliationRuns.id, runId))
    }

    return {
      runId,
      status: summary.status,
      findings: summary.findings,
      blockers: summary.blockers,
      warnings: summary.warnings,
      checked: summary.checked,
      reason: summary.reason,
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
      checked: 0,
      reason: message,
    }
  }
}

async function recordError(
  mode: string,
  now: Date,
  message: string,
  options: RunReconciliationOptions,
): Promise<ReconciliationResult> {
  let runId: number | null = null
  if (!options.dryRun) {
    const db = getDb()
    const [row] = await db
      .insert(sageReconciliationRuns)
      .values({ mode, startedAt: now, finishedAt: new Date(), status: 'error', error: message })
      .returning({ id: sageReconciliationRuns.id })
    runId = row?.id ?? null
  }
  return { runId, status: 'error', findings: 0, blockers: 0, warnings: 0, checked: 0, reason: message }
}

async function undecidedWarnings(db: ReturnType<typeof getDb>, runId: number | null): Promise<number> {
  if (runId === null) return 0
  const [previous] = await db
    .select({ id: sageReconciliationRuns.id })
    .from(sageReconciliationRuns)
    .where(and(lt(sageReconciliationRuns.id, runId), inArray(sageReconciliationRuns.status, ['passed', 'failed'])))
    .orderBy(desc(sageReconciliationRuns.id))
    .limit(1)
  if (!previous) return 0
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sageReconciliationFindings)
    .where(
      and(
        eq(sageReconciliationFindings.runId, previous.id),
        eq(sageReconciliationFindings.severity, 'warning'),
        eq(sageReconciliationFindings.decision, 'open'),
      ),
    )
  return row?.count ?? 0
}

async function persistFindings(runId: number, findings: Finding[]): Promise<void> {
  if (findings.length === 0) return
  const db = getDb()
  await db.insert(sageReconciliationFindings).values(
    findings.map((finding) => ({
      runId,
      code: finding.code,
      severity: finding.severity,
      docType: finding.docType ?? null,
      docId: finding.docId ?? null,
      externalRef: finding.externalRef ?? null,
      contactId: finding.contactId ?? null,
      expected: money(finding.expectedCents ?? null),
      actual: money(finding.actualCents ?? null),
      detail: finding.detail,
      owner: finding.owner,
      decision: 'open',
    })),
  )
}

interface FeedResult {
  events: ExternalEvent[]
  errors: string[]
}

/**
 * §4.4's fetch half, shared by the daily run and the 30-minute poll.
 *
 * A resource's watermark advances only when every document in the window was
 * classified as matched. Anything that needs a human leaves the watermark where
 * it is, so the next poll reports the same document instead of losing it.
 */
export async function pollResourceFeeds(
  http: ReconcileHttp,
  now: Date,
  dryRun: boolean,
): Promise<FeedResult> {
  const db = getDb()
  const events: ExternalEvent[] = []
  const errors: string[] = []
  const resources = ['sales_invoices', 'purchase_invoices', 'contact_payments'] as const

  const links = await db
    .select({ externalRef: sageLinks.externalRef, apiId: sageLinks.externalId })
    .from(sageLinks)
  const byRef = new Map(links.map((link) => [link.externalRef, link.apiId]))
  const knownApiIds = new Set(links.map((link) => link.apiId))

  for (const resource of resources) {
    const [state] = await db
      .select({ watermark: sageSyncState.watermark })
      .from(sageSyncState)
      .where(eq(sageSyncState.resource, resource))
      .limit(1)
    const since = isoOrEpoch(state?.watermark ?? null)
    try {
      const json = await getJson(
        http,
        `${resource}?updated_or_created_since=${encodeURIComponent(since)}&items_per_page=50`,
      )
      let pending = false
      for (const item of itemsOf(json)) {
        const reference = typeof item.reference === 'string' ? item.reference : ''
        const apiId = item.id === undefined ? '' : String(item.id)
        if (!reference.startsWith('cls:')) continue
        if (!byRef.has(reference)) {
          events.push({ kind: 'orphan', apiId, externalRef: reference })
          pending = true
        } else if (byRef.get(reference) !== apiId) {
          events.push({ kind: 'changed', apiId, externalRef: reference, field: 'id' })
          pending = true
        } else {
          events.push({ kind: 'matched', apiId, externalRef: reference })
        }
      }

      const deleted = await getJson(
        http,
        `${resource}?deleted_since=${encodeURIComponent(since)}&items_per_page=50`,
      )
      for (const item of itemsOf(deleted)) {
        const apiId = item.id === undefined ? '' : String(item.id)
        if (knownApiIds.has(apiId)) {
          events.push({ kind: 'deleted', apiId })
          pending = true
        }
      }

      if (!dryRun && !pending) await advanceWatermark(resource, now, null)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`${resource}: ${message}`)
      if (!dryRun) await advanceWatermark(resource, state?.watermark ?? null, message)
    }
  }

  return { events, errors }
}

async function advanceWatermark(
  resource: string,
  watermark: Date | null,
  error: string | null,
): Promise<void> {
  const db = getDb()
  await db
    .insert(sageSyncState)
    .values({ resource, watermark, lastRunAt: new Date(), lastError: error })
    .onConflictDoUpdate({
      target: sageSyncState.resource,
      set: { watermark, lastRunAt: new Date(), lastError: error },
    })
}

/** The 30-minute poll: fetch and classify, no run row, no findings. */
export async function pollExternal(options: {
  now?: Date
  http?: ReconcileHttp
  dryRun?: boolean
} = {}): Promise<{ events: number; errors: number }> {
  const config = sageConfig()
  if (!config.enabled || !sageCredentialsPresent()) {
    return { events: 0, errors: 0 }
  }
  const result = await pollResourceFeeds(
    options.http ?? getSageHttp(),
    options.now ?? new Date(),
    options.dryRun ?? false,
  )
  return { events: result.events.length, errors: result.errors.length }
}
