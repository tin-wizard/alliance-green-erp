/**
 * Sage-side work-order number collision source.
 *
 * SERVER ONLY. The legacy `confirm_woid_not_used()` checks `tcustr.sSource` and
 * `tProject.sName` on the Sage connection (BUSINESS-RULES C3). `@cls/sage`
 * currently exposes discovery and health only — it deliberately has no business
 * reads — so this module looks for an optional capability and otherwise reports
 * "unverifiable" instead of pretending the check passed.
 *
 * When the Sage module adds a `numberInUse(id)` capability, this file starts
 * using it with no change to the allocator. Until then strict numbering refuses
 * and legacy-permissive numbering records a warning.
 */
import { getSageAdapter } from '@cls/sage'

export interface SageNumberCollisionSource {
  /** True = used, false = free, null = cannot verify. */
  has(id: number): Promise<boolean | null>
  describe(): string
}

interface SageNumberCapability {
  numberInUse?: (id: number) => Promise<boolean> | boolean
}

let override: SageNumberCollisionSource | undefined

export function getSageNumberCollisionSource(): SageNumberCollisionSource {
  if (override) return override

  let capability: SageNumberCapability | undefined
  try {
    capability = getSageAdapter() as unknown as SageNumberCapability
  } catch {
    capability = undefined
  }

  if (capability && typeof capability.numberInUse === 'function') {
    return {
      has: async (id) => capability.numberInUse!(id),
      describe: () => 'Sage tcustr.sSource / tProject.sName via @cls/sage',
    }
  }

  return {
    has: async () => null,
    describe: () =>
      '@cls/sage has no business-query capability yet (discovery/health only); Sage collision check unavailable',
  }
}

/** Test seam. Pass undefined to restore the real source. */
export function setSageNumberCollisionSourceForTests(
  next: SageNumberCollisionSource | undefined,
): void {
  override = next
}
