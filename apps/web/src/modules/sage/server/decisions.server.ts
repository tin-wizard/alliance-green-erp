/**
 * Finding decisions (`SAGE-RECONCILIATION.md` §5).
 *
 * A finding starts `open`. It passes the next run only when every warning from
 * the previous run carries one of three decisions and a name:
 *
 * - `accepted` — the difference is real and we live with it;
 * - `fixed_externally` — someone corrected it in the ledger or the source;
 * - `excluded` — the finding is not about this business (test data, a mapping
 *   artefact) and should not appear again.
 *
 * Decisions are admin-only and audited. The note is not optional: "accepted"
 * with no reason is exactly the wallpaper §5 exists to prevent.
 */
import { desc, eq, inArray } from 'drizzle-orm'
import type { AuthSessionView } from '../../../server/auth.types'
import { ForbiddenError, NotFoundError, ValidationError } from '@cls/core'
import { getDb, type Db, type Tx } from '@cls/db'
import { sageReconciliationFindings, sageReconciliationRuns } from '@cls/db/schema'
import { writeAudit } from '@cls/auth'
import {
  FINDING_DECISIONS,
  type FindingDecision,
  type FindingView,
  type ReconciliationView,
  type RunView,
} from '../lib/decisions'

export {
  DECISION_LABELS,
  FINDING_DECISIONS,
  type FindingDecision,
  type FindingView,
  type ReconciliationView,
  type RunView,
} from '../lib/decisions'

function toFinding(row: typeof sageReconciliationFindings.$inferSelect): FindingView {
  return {
    id: row.id,
    runId: row.runId,
    code: row.code,
    severity: row.severity,
    docType: row.docType,
    docId: row.docId,
    externalRef: row.externalRef,
    contactId: row.contactId,
    expected: row.expected,
    actual: row.actual,
    detail: row.detail ? JSON.stringify(row.detail, null, 2) : null,
    owner: row.owner,
    decision: row.decision,
    decisionNote: row.decisionNote,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    decidedBy: row.decidedBy,
  }
}

function toRun(row: typeof sageReconciliationRuns.$inferSelect): RunView {
  return {
    id: row.id,
    mode: row.mode,
    phase: row.phase,
    baselineId: row.baselineId,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    findings: row.findings,
    blockers: row.blockers,
    warnings: row.warnings,
    divergenceTotal: row.divergenceTotal,
    signedAt: row.signedAt ? row.signedAt.toISOString() : null,
    signedNote: row.signedNote,
    error: row.error,
  }
}

export async function listReconciliation(db: Db = getDb()): Promise<ReconciliationView> {
  const runs = await db
    .select()
    .from(sageReconciliationRuns)
    .orderBy(desc(sageReconciliationRuns.startedAt), desc(sageReconciliationRuns.id))
    .limit(12)

  const runIds = runs.map((run) => run.id)
  const findings = runIds.length === 0
    ? []
    : await db
        .select()
        .from(sageReconciliationFindings)
        .where(inArray(sageReconciliationFindings.runId, runIds))
        .orderBy(desc(sageReconciliationFindings.runId), sageReconciliationFindings.id)

  const open = findings
    .filter((finding) => finding.decision === 'open')
    .sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === 'blocker' ? -1 : 1
      return b.id - a.id
    })
    .map(toFinding)

  const decided = findings
    .filter((finding) => finding.decision !== 'open')
    .sort((a, b) => (b.decidedAt?.getTime() ?? 0) - (a.decidedAt?.getTime() ?? 0))
    .slice(0, 30)
    .map(toFinding)

  return {
    runs: runs.map(toRun),
    open,
    decided,
    errors: runs.filter((run) => run.status === 'error').map(toRun),
  }
}

export interface DecideFindingInput {
  findingId: number
  decision: FindingDecision
  note: string
}

/**
 * Record one decision. The transaction carries the row change and the audit row
 * together, so a decision can never exist without its evidence.
 */
export async function decideFindingCore(
  tx: Tx,
  input: DecideFindingInput,
  session: AuthSessionView,
): Promise<FindingView> {
  if (session.user.role !== 'admin') {
    throw new ForbiddenError('Only an administrator can decide a reconciliation finding.')
  }
  if (!FINDING_DECISIONS.includes(input.decision)) {
    throw new ValidationError('Unknown decision.', { allowed: FINDING_DECISIONS })
  }
  const note = input.note.trim()
  if (note.length < 3) {
    throw new ValidationError('A decision needs a reason: at least three characters.')
  }
  if (note.length > 500) {
    throw new ValidationError('Keep the reason under 500 characters.')
  }

  const [existing] = await tx
    .select()
    .from(sageReconciliationFindings)
    .where(eq(sageReconciliationFindings.id, input.findingId))
    .limit(1)
  if (!existing) throw new NotFoundError('That finding does not exist.')

  const decidedAt = new Date()
  const [updated] = await tx
    .update(sageReconciliationFindings)
    .set({
      decision: input.decision,
      decisionNote: note,
      decidedAt,
      decidedBy: session.user.id,
    })
    .where(eq(sageReconciliationFindings.id, input.findingId))
    .returning()
  if (!updated) throw new NotFoundError('That finding does not exist.')

  await writeAudit(tx, {
    action: 'sage.finding.decide',
    actorUserId: session.user.id,
    actorLabel: session.user.username,
    actorRole: session.user.role,
    entityType: 'sage_reconciliation_finding',
    entityId: String(input.findingId),
    summary: `${existing.code} on run ${existing.runId}: ${existing.decision} → ${input.decision}`,
    before: {
      decision: existing.decision,
      decisionNote: existing.decisionNote,
      decidedAt: existing.decidedAt ? existing.decidedAt.toISOString() : null,
    },
    after: {
      decision: input.decision,
      decisionNote: note,
      decidedAt: decidedAt.toISOString(),
      severity: existing.severity,
      externalRef: existing.externalRef,
    },
  })

  return toFinding(updated)
}
