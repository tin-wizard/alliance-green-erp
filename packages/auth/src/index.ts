/**
 * @cls/auth — SERVER ONLY.
 *
 * Importing this package from a React component would pull `node:crypto`, the
 * JWT verifier and the database driver into the client graph. Client code needs
 * only types and permission keys, which live in `@cls/core`.
 */
export * from './permissions'
export * from './neon-auth'
export * from './session-cookie'
export * from './audit'
export * from './rate-limit'
export { readCookie } from './session-token'
export {
  getNeonAuth,
  isNeonAuthConfigured,
  loadEffectiveGrants,
  loadSessionFromRequest,
  resetNeonAuthForTests,
  resolveAppUser,
  type AppUser,
  type AuthSession,
  type SessionUser,
} from './session'
