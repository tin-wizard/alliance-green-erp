/**
 * Reconciliation vocabulary and the pure six checks.
 *
 * Nothing here touches a database or a socket: each check receives plain rows and
 * returns findings. The app gathers the rows, writes the run and decides nothing;
 * the thresholds and severity rules live here, where a fixture can exercise them.
 *
 * The standing rule from `SAGE-RECONCILIATION.md` §1 is encoded in the return type:
 * a check reports, it never repairs. The only automatic repairs are re-linking by
 * external reference and advancing a watermark, and both are the app's job.
 */

export type FindingSeverity = 'blocker' | 'warning' | 'info'

export type FindingOwner = 'platform' | 'finance' | 'module-owner'

export type FindingCode =
  | 'MISSING_IN_SAGE'
  | 'DUPLICATE_IN_SAGE'
  | 'STUCK_POSTING'
  | 'AMOUNT_MISMATCH'
  | 'TAX_MISMATCH'
  | 'BALANCE_MISMATCH'
  | 'BALANCE_ROLLFORWARD_UNAVAILABLE'
  | 'EXTERNAL_CHANGE'
  | 'ORPHAN_IN_SAGE'
  | 'DELETED_IN_SAGE'
  | 'PAYMENT_UNMATCHED'
  | 'TAX_PERIOD_MISMATCH'
  | 'TAX_QUIRK'
  | 'QUEUE_BACKLOG'
  | 'QUOTA_NEAR_LIMIT'
  | 'QUOTA_EXHAUSTED'
  | 'REAUTH_REQUIRED'
  | 'TOKEN_STALE'

export interface Finding {
  code: FindingCode
  severity: FindingSeverity
  owner: FindingOwner
  docType?: string
  docId?: string
  externalRef?: string
  contactId?: string
  /** Money in cents; the database column is numeric(14,2). */
  expectedCents?: number
  actualCents?: number
  detail: Record<string, unknown>
}

export interface CheckResult {
  findings: Finding[]
  /** Rows compared, for the run report. */
  checked: number
}

const OWNERS: Record<FindingCode, FindingOwner> = {
  MISSING_IN_SAGE: 'platform',
  DUPLICATE_IN_SAGE: 'platform',
  STUCK_POSTING: 'platform',
  AMOUNT_MISMATCH: 'module-owner',
  TAX_MISMATCH: 'module-owner',
  BALANCE_MISMATCH: 'finance',
  BALANCE_ROLLFORWARD_UNAVAILABLE: 'platform',
  EXTERNAL_CHANGE: 'finance',
  ORPHAN_IN_SAGE: 'platform',
  DELETED_IN_SAGE: 'finance',
  PAYMENT_UNMATCHED: 'finance',
  TAX_PERIOD_MISMATCH: 'finance',
  TAX_QUIRK: 'finance',
  QUEUE_BACKLOG: 'platform',
  QUOTA_NEAR_LIMIT: 'platform',
  QUOTA_EXHAUSTED: 'platform',
  REAUTH_REQUIRED: 'platform',
  TOKEN_STALE: 'platform',
}

export interface SeverityContext {
  /** Absolute money difference in cents, for codes with an amount threshold. */
  amountCents?: number
  /** Consecutive failed attempts, for STUCK_POSTING. */
  attempts?: number
  /** Days since the last successful refresh, for TOKEN_STALE. */
  daysSinceRefresh?: number
}

/**
 * Severity is a property of the code and, for three codes, of the amount:
 * a dollar of monthly tax is a blocker, a cent is not; a stuck posting becomes a
 * blocker only after two searches have failed; stale tokens become blockers at 21
 * days, ten days before the refresh token dies.
 */
export function severityFor(code: FindingCode, context: SeverityContext = {}): FindingSeverity {
  switch (code) {
    case 'TAX_PERIOD_MISMATCH':
      return Math.abs(context.amountCents ?? 0) > 100 ? 'blocker' : 'warning'
    case 'STUCK_POSTING':
      return (context.attempts ?? 0) >= 4 ? 'blocker' : 'warning'
    case 'TOKEN_STALE':
      return (context.daysSinceRefresh ?? 0) >= 21 ? 'blocker' : 'warning'
    case 'EXTERNAL_CHANGE':
    case 'ORPHAN_IN_SAGE':
    case 'PAYMENT_UNMATCHED':
    case 'QUEUE_BACKLOG':
    case 'QUOTA_NEAR_LIMIT':
    case 'BALANCE_ROLLFORWARD_UNAVAILABLE':
    case 'TAX_QUIRK':
      return 'warning'
    default:
      return 'blocker'
  }
}

export function findingFor(
  code: FindingCode,
  input: Omit<Finding, 'code' | 'severity' | 'owner'> & { severityContext?: SeverityContext },
): Finding {
  const { severityContext, ...rest } = input
  return {
    code,
    severity: severityFor(code, severityContext),
    owner: OWNERS[code],
    ...rest,
  }
}
