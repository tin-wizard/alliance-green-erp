/**
 * Work-order number collision source.
 *
 * SERVER ONLY. The legacy `confirm_woid_not_used()` checked `tcustr.sSource` and
 * `tProject.sName` because it was writing into Sage 50 (BUSINESS-RULES C3). Since
 * D18 the ledger's numbers are the ledger's; the number that matters is ours, so
 * this delegates to the Sage module's `numberInUse`, which checks work orders,
 * quotes and invoices. `null` still means "cannot verify" and preserves the
 * allocator's existing behaviour when the database is unavailable.
 */
import {
  describeNumberSource,
  numberInUse,
} from '../../sage/server/number-in-use.server'

export interface SageNumberCollisionSource {
  /** True = used, false = free, null = cannot verify. */
  has(id: number): Promise<boolean | null>
  describe(): string
}

let override: SageNumberCollisionSource | undefined

export function getSageNumberCollisionSource(): SageNumberCollisionSource {
  if (override) return override
  return {
    has: (id) => numberInUse(id),
    describe: () => describeNumberSource(),
  }
}

/** Test seam. Pass undefined to restore the real source. */
export function setSageNumberCollisionSourceForTests(
  next: SageNumberCollisionSource | undefined,
): void {
  override = next
}
