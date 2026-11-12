/**
 * Client-safe decision vocabulary and view shapes.
 *
 * Kept out of `decisions.server.ts` so the page can name the three decisions
 * without pulling the database and audit code into the browser bundle.
 */

export const FINDING_DECISIONS = ['accepted', 'fixed_externally', 'excluded'] as const
export type FindingDecision = (typeof FINDING_DECISIONS)[number]

export const DECISION_LABELS: Record<FindingDecision, string> = {
  accepted: 'Accepted',
  fixed_externally: 'Fixed externally',
  excluded: 'Excluded',
}

export interface FindingView {
  id: number
  runId: number
  code: string
  severity: string
  docType: string | null
  docId: string | null
  externalRef: string | null
  contactId: string | null
  expected: string | null
  actual: string | null
  /** The jsonb detail, pre-serialised: server functions must ship plain values. */
  detail: string | null
  owner: string
  decision: string
  decisionNote: string | null
  decidedAt: string | null
  decidedBy: string | null
}

export interface RunView {
  id: number
  mode: string
  phase: string | null
  baselineId: string | null
  status: string
  startedAt: string
  finishedAt: string | null
  findings: number
  blockers: number
  warnings: number
  divergenceTotal: string | null
  signedAt: string | null
  signedNote: string | null
  error: string | null
}

export interface ReconciliationView {
  runs: RunView[]
  /** Findings with no decision yet, newest runs first, blockers before warnings. */
  open: FindingView[]
  /** The last decisions, so the page is not write-only. */
  decided: FindingView[]
  /** Runs that could not compare anything. */
  errors: RunView[]
}
