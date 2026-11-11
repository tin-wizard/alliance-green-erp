/**
 * Work-order number allocation — the `wo_next_pid` replacement.
 *
 * Contract (BUSINESS-RULES C1-C4, C8; fixtures/wo-numbering.json):
 *
 *  1. take `work_order_number_series.next_id` for the series (1 main, 2
 *     maintenance);
 *  2. skip while the candidate is used by an app work order, Sage
 *     `tcustr.sSource` or Sage `tProject.sName`;
 *  3. persist every skip (the allocator reports the counter it reached);
 *  4. never return null. If the number cannot be allocated safely, throw and
 *     let the create path fail with a clear message.
 *
 * The C4 defect: the legacy app-side check runs on the Sage connection, sees no
 * `workorder` table, and silently passes. The intended behaviour checks both
 * sides. That fix is behind `WORKORDER_NUMBERING_STRICT`:
 *
 *  - default (false) preserves legacy-permissive numbering: an app-side
 *    collision is not silently renumbered; allocation refuses with an
 *    actionable error, and an unverifiable Sage side is a warning;
 *  - strict (true) skips app-side collisions (the fixture's intended 900501
 *    case) and refuses when the Sage side cannot be verified.
 *
 * Nothing here touches the database; `server/numbering.server.ts` supplies the
 * usage checker inside the transaction.
 */

export type WorkOrderSeriesNumber = 1 | 2

export interface NumberUsageChecker {
  /** True when `app.work_orders.id` already uses this number. */
  appHas(id: number): boolean | Promise<boolean>
  /** True when Sage uses it; null when the Sage side cannot be verified. */
  sageHas(id: number): boolean | null | Promise<boolean | null>
}

export interface NumberingPlanInput {
  series: WorkOrderSeriesNumber
  /** Current `next_id` for the series. */
  counter: number
  usage: NumberUsageChecker
  /** C4 fix switch. Default false = legacy-permissive. */
  enforceAppCollisions?: boolean
  maxSkips?: number
}

export interface NumberingPlan {
  number: number
  series: WorkOrderSeriesNumber
  skipped: number[]
  /** Counter value the allocator reached. The caller writes `number + 1` after insert. */
  counterAfter: number
  warnings: string[]
  sageVerified: boolean
}

export class WorkOrderNumberingError extends Error {
  readonly code = 'workorder_numbering_failed'

  constructor(message: string) {
    super(message)
    this.name = 'WorkOrderNumberingError'
  }
}

const DEFAULT_MAX_SKIPS = 1000

export function numberingPolicyFromEnv(
  env: Record<string, string | undefined> = process.env,
): { enforceAppCollisions: boolean; refuseUnverifiedSage: boolean } {
  const strict = (env.WORKORDER_NUMBERING_STRICT ?? '').trim().toLowerCase()
  const enabled = strict === '1' || strict === 'true' || strict === 'yes'
  return { enforceAppCollisions: enabled, refuseUnverifiedSage: enabled }
}

/**
 * Pure planner. Async only because the real usage checker reads the database.
 */
export async function planWorkOrderNumber(input: NumberingPlanInput): Promise<NumberingPlan> {
  const enforce = input.enforceAppCollisions ?? false
  const maxSkips = input.maxSkips ?? DEFAULT_MAX_SKIPS
  let candidate = input.counter
  if (!Number.isInteger(candidate) || candidate < 0) {
    throw new WorkOrderNumberingError(
      `The ${input.series === 2 ? 'maintenance' : 'main'} work-order counter is invalid (${input.counter}).`,
    )
  }

  const skipped: number[] = []
  const warnings: string[] = []
  let sageVerified = true

  for (;;) {
    if (skipped.length >= maxSkips) {
      throw new WorkOrderNumberingError(
        `Could not allocate a free ${input.series === 2 ? 'maintenance' : 'main'} work-order number after ${maxSkips} attempts.`,
      )
    }

    const appUsed = await input.usage.appHas(candidate)
    if (appUsed) {
      if (!enforce) {
        // Legacy-permissive default: do not silently renumber live work.
        throw new WorkOrderNumberingError(
          `Work order ${candidate} is already in use. Fix the ${input.series === 2 ? 'maintenance' : 'main'} counter or enable strict numbering (WORKORDER_NUMBERING_STRICT=true).`,
        )
      }
      skipped.push(candidate)
      candidate += 1
      continue
    }

    const sage = await input.usage.sageHas(candidate)
    if (sage === null) {
      sageVerified = false
      if (enforce) {
        throw new WorkOrderNumberingError(
          `Cannot verify work order ${candidate} against Sage (tcustr.sSource / tProject.sName). Strict numbering refuses to allocate.`,
        )
      }
      warnings.push(
        `Sage collision check unavailable for ${candidate}; allocated under legacy-permissive numbering.`,
      )
    } else if (sage) {
      skipped.push(candidate)
      candidate += 1
      continue
    }

    return {
      number: candidate,
      series: input.series,
      skipped,
      counterAfter: candidate,
      warnings,
      sageVerified,
    }
  }
}

/** The caller writes this after a successful insert, in the same transaction. */
export function counterAfterInsert(plan: NumberingPlan): number {
  return plan.number + 1
}
