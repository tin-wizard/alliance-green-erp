import type { Role } from '@cls/core'

/**
 * Structural types shared between the client-visible server-function files and
 * the server-only implementations. Client-safe: types only, no runtime imports.
 */
export interface SessionGrant {
  key: string
  scopeSubcontractorId: number | null
}

export interface SessionUserView {
  id: string
  email: string
  username: string
  displayName: string
  role: Role
  subcontractorId: number | null
  grants: SessionGrant[]
}

export interface AuthSessionView {
  id: string
  expiresAt: Date
  lastSeenAt: Date
  user: SessionUserView
}

export interface SessionView {
  user: SessionUserView
  expiresAt: string
}
