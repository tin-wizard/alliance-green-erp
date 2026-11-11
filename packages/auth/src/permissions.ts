import type { Role } from '@cls/core'

/**
 * Pure permission evaluation. No database, no request, no clock injection
 * surprises: `now` is a parameter so the rules are testable.
 *
 * Rule (mirrors the legacy tables):
 *   - Start from the role's default grants.
 *   - An explicit, unexpired user grant adds a permission.
 *   - An explicit, unexpired user deny removes it.
 *   - An expired user row is ignored entirely (falls back to the role default).
 *   - An explicit deny beats a role grant.
 */
export interface UserGrantRow {
  permissionKey: string
  isAllowed: boolean
  expiresAt: Date | null
  scopeSubcontractorId: number | null
}

export interface EffectiveGrant {
  key: string
  /** For scoped grants such as the WSIB override. Null = global. */
  scopeSubcontractorId: number | null
}

export interface EvaluateInput {
  role: Role
  roleGrants: readonly string[]
  userGrants: readonly UserGrantRow[]
  now?: Date
}

export function evaluatePermissions(input: EvaluateInput): EffectiveGrant[] {
  const now = input.now ?? new Date()
  const effective = new Map<string, EffectiveGrant>()

  for (const key of input.roleGrants) {
    effective.set(key, { key, scopeSubcontractorId: null })
  }

  for (const grant of input.userGrants) {
    if (grant.expiresAt && grant.expiresAt.getTime() <= now.getTime()) continue
    if (grant.isAllowed) {
      effective.set(grant.permissionKey, {
        key: grant.permissionKey,
        scopeSubcontractorId: grant.scopeSubcontractorId ?? null,
      })
    } else {
      effective.delete(grant.permissionKey)
    }
  }

  return [...effective.values()].sort((a, b) => a.key.localeCompare(b.key))
}

export function grantsInclude(grants: readonly EffectiveGrant[], key: string): boolean {
  return grants.some((grant) => grant.key === key)
}

/**
 * Scoped check for `workorder:override_wsib_hold`. A global grant covers every
 * subcontractor; a scoped grant covers only that vendor id.
 */
export function grantsIncludeScoped(
  grants: readonly EffectiveGrant[],
  key: string,
  scopeId: number,
): boolean {
  return grants.some(
    (grant) =>
      grant.key === key &&
      (grant.scopeSubcontractorId === null || grant.scopeSubcontractorId === scopeId),
  )
}
