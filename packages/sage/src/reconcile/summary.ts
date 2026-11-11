/**
 * What a run reports, and when it passes.
 *
 * `passed` needs zero blockers **and** no undecided warning left from the
 * previous run. Warnings do not block their own run; an ignored one blocks the
 * next, which is the only way a report avoids becoming wallpaper.
 */
import type { Finding } from './types'

export type RunStatus = 'passed' | 'failed' | 'error'

export interface RunSummary {
  status: RunStatus
  findings: number
  blockers: number
  warnings: number
  checked: number
  moneyTotalCents: number
  reason: string | null
}

export function summariseRun(input: {
  findings: Finding[]
  checked: number
  moneyTotalCents?: number
  /** Set when a check could not run at all (no token, Sage unreachable). */
  error?: string | null
  /** Warnings from the last run that nobody has decided. */
  undecidedPreviousWarnings?: number
}): RunSummary {
  const blockers = input.findings.filter((finding) => finding.severity === 'blocker').length
  const warnings = input.findings.filter((finding) => finding.severity === 'warning').length
  const base = {
    findings: input.findings.length,
    blockers,
    warnings,
    checked: input.checked,
    moneyTotalCents: input.moneyTotalCents ?? 0,
  }

  if (input.error) {
    return { ...base, status: 'error', reason: input.error }
  }
  if (blockers > 0) {
    return { ...base, status: 'failed', reason: `${blockers} blocker(s) need a decision.` }
  }
  const undecided = input.undecidedPreviousWarnings ?? 0
  if (undecided > 0) {
    return {
      ...base,
      status: 'failed',
      reason: `${undecided} warning(s) from the previous run are still undecided.`,
    }
  }
  return { ...base, status: 'passed', reason: null }
}
