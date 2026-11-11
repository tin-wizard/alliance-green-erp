/**
 * The two quotas, and the accounting that stops a busy month from starving
 * reconciliation or posting.
 *
 * - Minute quota: a token bucket of 90 (headroom under the documented 100),
 *   refilled per 60 s, per process. A 429 drains it.
 * - Daily quota: 2,500 calls, counted per class in a store the app persists in
 *   `app.sage_quota_usage`, so a restart does not reset the budget.
 *
 * Thresholds: at 90% every class except `posting` stops; at 98% posting stops
 * too and the queue holds. Both transitions are reported so the caller can
 * write `QUOTA_NEAR_LIMIT` / `QUOTA_EXHAUSTED` findings.
 */
import { SageError } from './errors'
import type { SageQuotaSnapshot } from './types'

export type QuotaClass = 'posting' | 'sync' | 'payment_poll' | 'reconcile' | 'probe'

export const DAILY_LIMIT = 2500
export const MINUTE_LIMIT = 90

export const CLASS_BUDGETS: Record<QuotaClass, number> = {
  posting: 1500,
  sync: 500,
  payment_poll: 300,
  reconcile: 150,
  probe: 50,
}

export type QuotaThreshold = 'ok' | 'near_limit' | 'exhausted'

export interface QuotaUsage {
  /** UTC day key, `YYYY-MM-DD`. */
  day: string
  used: number
  byClass: Record<QuotaClass, number>
}

export interface DailyQuotaStore {
  load(day: string): Promise<QuotaUsage | null>
  save(usage: QuotaUsage): Promise<void>
}

export function utcDayKey(now: Date): string {
  return now.toISOString().slice(0, 10)
}

export function resetsAtFor(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
}

function emptyUsage(day: string): QuotaUsage {
  return {
    day,
    used: 0,
    byClass: { posting: 0, sync: 0, payment_poll: 0, reconcile: 0, probe: 0 },
  }
}

export class MemoryQuotaStore implements DailyQuotaStore {
  readonly #days = new Map<string, QuotaUsage>()

  async load(day: string): Promise<QuotaUsage | null> {
    const found = this.#days.get(day)
    return found ? structuredClone(found) : null
  }

  async save(usage: QuotaUsage): Promise<void> {
    this.#days.set(usage.day, structuredClone(usage))
  }
}

export class MinuteBucket {
  readonly #capacity: number
  readonly #refillMs: number
  #tokens: number
  #updatedAt: number

  constructor(options: { capacity?: number; refillMs?: number; now?: () => number } = {}) {
    this.#capacity = options.capacity ?? MINUTE_LIMIT
    this.#refillMs = options.refillMs ?? 60_000
    this.#tokens = this.#capacity
    this.#updatedAt = (options.now ?? Date.now)()
    this.now = options.now ?? Date.now
  }

  private readonly now: () => number

  #refill(): void {
    const now = this.now()
    const elapsed = now - this.#updatedAt
    if (elapsed <= 0) return
    const gained = (elapsed / this.#refillMs) * this.#capacity
    this.#tokens = Math.min(this.#capacity, this.#tokens + gained)
    this.#updatedAt = now
  }

  available(): number {
    this.#refill()
    return Math.floor(this.#tokens)
  }

  tryTake(): boolean {
    this.#refill()
    if (this.#tokens < 1) return false
    this.#tokens -= 1
    return true
  }

  /** A 429 means the server is stricter than us: empty the bucket. */
  drain(): void {
    this.#tokens = 0
    this.#updatedAt = this.now()
  }

  /** Test seam: pretend the clock moved. */
  setNowForTests(now: number): void {
    this.#updatedAt = now
  }
}

export interface QuotaDecision {
  allowed: boolean
  threshold: QuotaThreshold
  reason: string
  snapshot: SageQuotaSnapshot
}

export class QuotaGovernor {
  readonly #store: DailyQuotaStore
  readonly #limit: number
  readonly #dayBudgets: Record<QuotaClass, number>
  readonly #minute: MinuteBucket
  readonly #now: () => Date
  #lastThreshold: QuotaThreshold = 'ok'

  constructor(options: {
    store: DailyQuotaStore
    limit?: number
    dayBudgets?: Partial<Record<QuotaClass, number>>
    minute?: MinuteBucket
    now?: () => Date
  }) {
    this.#store = options.store
    this.#limit = options.limit ?? DAILY_LIMIT
    this.#dayBudgets = { ...CLASS_BUDGETS, ...options.dayBudgets }
    this.#minute = options.minute ?? new MinuteBucket()
    this.#now = options.now ?? (() => new Date())
  }

  async snapshot(): Promise<SageQuotaSnapshot> {
    const now = this.#now()
    const usage = (await this.#store.load(utcDayKey(now))) ?? emptyUsage(utcDayKey(now))
    return { used: usage.used, limit: this.#limit, resetsAt: resetsAtFor(now) }
  }

  /**
   * Reserve one call. Throws a `paused` SageError when the class budget, the
   * daily limit or the minute bucket says no — a paused job is not a failure.
   */
  async reserve(klass: QuotaClass): Promise<QuotaDecision> {
    const now = this.#now()
    const day = utcDayKey(now)
    const usage = (await this.#store.load(day)) ?? emptyUsage(day)
    const threshold = this.#thresholdFor(usage.used)

    if (threshold === 'exhausted') {
      return this.#refuse(usage, threshold, 'Daily quota exhausted; posting is paused.')
    }
    if (threshold === 'near_limit' && klass !== 'posting') {
      return this.#refuse(
        usage,
        threshold,
        `Daily quota near its limit; ${klass} calls are paused so posting keeps its headroom.`,
      )
    }
    if (usage.byClass[klass] >= this.#dayBudgets[klass]) {
      return this.#refuse(usage, threshold, `Class budget for ${klass} is spent for today.`)
    }
    if (!this.#minute.tryTake()) {
      return this.#refuse(usage, threshold, 'Minute quota spent; retry after the bucket refills.')
    }

    usage.used += 1
    usage.byClass[klass] += 1
    await this.#store.save(usage)
    return { allowed: true, threshold, reason: 'ok', snapshot: this.#snapshot(usage, now) }
  }

  /** Called after a 429 so we stop before the server does the counting. */
  noteRateLimited(): void {
    this.#minute.drain()
  }

  /** Returns the threshold crossing once, so the caller writes one finding. */
  async takeThresholdTransition(): Promise<QuotaThreshold | null> {
    const now = this.#now()
    const usage = (await this.#store.load(utcDayKey(now))) ?? emptyUsage(utcDayKey(now))
    const current = this.#thresholdFor(usage.used)
    if (current === this.#lastThreshold) return null
    this.#lastThreshold = current
    return current === 'ok' ? null : current
  }

  #thresholdFor(used: number): QuotaThreshold {
    const share = used / this.#limit
    if (share >= 0.98) return 'exhausted'
    if (share >= 0.9) return 'near_limit'
    return 'ok'
  }

  #snapshot(usage: QuotaUsage, now: Date): SageQuotaSnapshot {
    return { used: usage.used, limit: this.#limit, resetsAt: resetsAtFor(now) }
  }

  #refuse(
    usage: QuotaUsage,
    threshold: QuotaThreshold,
    message: string,
  ): QuotaDecision {
    return {
      allowed: false,
      threshold,
      reason: message,
      snapshot: this.#snapshot(usage, this.#now()),
    }
  }
}

export function quotaPausedError(decision: QuotaDecision): SageError {
  return new SageError('paused', 'SAGE_QUOTA_PAUSED', decision.reason, {
    details: { threshold: decision.threshold, quota: decision.snapshot },
  })
}
