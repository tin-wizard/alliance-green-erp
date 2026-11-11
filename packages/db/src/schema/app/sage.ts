/**
 * Sage connection and quota state.
 *
 * Nothing here holds a readable token: `access_token_sealed` and
 * `refresh_token_sealed` are AES-256-GCM ciphertexts bound to
 * `environment|business_id`, and the fingerprints exist only so a mismatch is
 * detectable without decrypting.
 *
 * The posting ledger itself (`sage_postings`, `sage_links`) belongs to the
 * invoicing module and is unchanged by this pass.
 */
import {
  bigserial,
  date,
  index,
  integer,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { app } from './base'

/**
 * One row per environment. `sandbox` and `production` never share a token: the
 * AAD binds the ciphertext to the environment, so copying a row between rows
 * fails to decrypt rather than posting to the wrong company.
 */
export const sageConnections = app.table(
  'sage_connections',
  {
    environment: text('environment').primaryKey(),
    businessId: text('business_id'),
    accessTokenSealed: text('access_token_sealed').notNull(),
    refreshTokenSealed: text('refresh_token_sealed').notNull(),
    accessTokenFingerprint: text('access_token_fingerprint'),
    refreshTokenFingerprint: text('refresh_token_fingerprint'),
    accessExpiresAt: timestamp('access_expires_at', { withTimezone: true }).notNull(),
    refreshExpiresAt: timestamp('refresh_expires_at', { withTimezone: true }).notNull(),
    lastRefreshAt: timestamp('last_refresh_at', { withTimezone: true }).notNull(),
    /** disconnected | needs_reauth | verified | degraded | error */
    state: text('state').notNull().default('disconnected'),
    message: text('message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('sage_connections_state_idx').on(table.state),
    index('sage_connections_refresh_expires_idx').on(table.refreshExpiresAt),
  ],
)

/** OAuth `state` values: stored hashed, single use, ten-minute expiry. */
export const sageOauthStates = app.table(
  'sage_oauth_states',
  {
    stateHash: text('state_hash').primaryKey(),
    environment: text('environment').notNull(),
    requestedBy: text('requested_by'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('sage_oauth_states_expires_idx').on(table.expiresAt)],
)

/**
 * Daily call accounting, one row per (UTC day, quota class). The guard reads the
 * counter rather than a local clock, so a wrong reset boundary costs a day of
 * headroom instead of a failed post.
 */
export const sageQuotaUsage = app.table(
  'sage_quota_usage',
  {
    usageDay: date('usage_day').notNull(),
    /** posting | sync | payment_poll | reconcile | probe */
    class: text('class').notNull(),
    used: integer('used').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sage_quota_usage_day_class_unique').on(table.usageDay, table.class),
  ],
)

/**
 * Pause state survives a serverless invocation. Counters are kept so "three
 * consecutive 5xx" and "422 above 5%" mean the same thing at 03:00 as at 09:00.
 */
export const sagePauseState = app.table(
  'sage_pause_state',
  {
    environment: text('environment').primaryKey(),
    /** quota | needs_reauth | server_errors | rejections | month_end */
    reason: text('reason'),
    message: text('message'),
    since: timestamp('since', { withTimezone: true }),
    /** Null means a human must act; a timestamp means the pause lifts itself. */
    until: timestamp('until', { withTimezone: true }),
    consecutiveServerErrors: smallint('consecutive_server_errors').notNull().default(0),
    windowAttempts: integer('window_attempts').notNull().default(0),
    windowRejections: integer('window_rejections').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('sage_pause_state_reason_idx').on(table.reason)],
)

/**
 * One row per keep-alive or health assertion. This is what turns "was the token
 * alive last Tuesday" into a query instead of log archaeology, and it backs the
 * 30-day token-age sparkline.
 */
export const sageHealthSamples = app.table(
  'sage_health_samples',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
    daysSinceRefresh: integer('days_since_refresh').notNull(),
    refreshExpiresAt: timestamp('refresh_expires_at', { withTimezone: true }).notNull(),
    /** disabled | disconnected | needs_reauth | verified | degraded | error */
    state: text('state').notNull(),
    detail: text('detail'),
  },
  (table) => [index('sage_health_samples_checked_idx').on(sql`${table.checkedAt} desc`)],
)

export type SageConnectionRow = typeof sageConnections.$inferSelect
export type SagePauseRow = typeof sagePauseState.$inferSelect
export type SageHealthSampleRow = typeof sageHealthSamples.$inferSelect
