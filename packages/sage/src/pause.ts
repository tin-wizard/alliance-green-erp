/**
 * Automatic pause conditions.
 *
 * A paused worker is not a failed worker: nothing is lost, the queue holds, and
 * the health payload says why. Four conditions are automatic:
 *
 * | Condition | Trigger | Resumes |
 * |---|---|---|
 * | `quota` | daily quota exhausted | at the UTC reset |
 * | `needs_reauth` | token dead or 401 after one refresh | when a human authorises |
 * | `server_errors` | three consecutive 5xx or timeouts | after 30 minutes |
 * | `rejections` | 422 rate above 5% over the last 100 attempts (min 5) | when a human fixes the mapping |
 *
 * Counters live in a store so a new serverless invocation does not forget them.
 */

export type PauseReason = 'quota' | 'needs_reauth' | 'server_errors' | 'rejections' | 'month_end'

export interface PauseState {
  reason: PauseReason | null
  message: string | null
  since: string | null
  /** Set for conditions that lift on their own; null means a human must act. */
  until: string | null
  consecutiveServerErrors: number
  /** Rolling window of recent attempts: total and permanent (422) rejections. */
  windowAttempts: number
  windowRejections: number
}

export interface PauseStore {
  load(): Promise<PauseState | null>
  save(state: PauseState): Promise<void>
}

export function emptyPauseState(): PauseState {
  return {
    reason: null,
    message: null,
    since: null,
    until: null,
    consecutiveServerErrors: 0,
    windowAttempts: 0,
    windowRejections: 0,
  }
}

export class MemoryPauseStore implements PauseStore {
  #state: PauseState | null = null

  async load(): Promise<PauseState | null> {
    return this.#state ? structuredClone(this.#state) : null
  }

  async save(state: PauseState): Promise<void> {
    this.#state = structuredClone(state)
  }
}

export interface PauseReport {
  paused: boolean
  reason: PauseReason | null
  message: string
}

export class PauseGovernor {
  readonly #store: PauseStore
  readonly #now: () => Date
  readonly #serverErrorThreshold: number
  readonly #cooldownMs: number
  readonly #rejectionRate: number
  readonly #rejectionWindow: number
  readonly #rejectionMinimum: number

  constructor(options: {
    store: PauseStore
    now?: () => Date
    serverErrorThreshold?: number
    cooldownMs?: number
    rejectionRate?: number
    rejectionWindow?: number
    rejectionMinimum?: number
  }) {
    this.#store = options.store
    this.#now = options.now ?? (() => new Date())
    this.#serverErrorThreshold = options.serverErrorThreshold ?? 3
    this.#cooldownMs = options.cooldownMs ?? 30 * 60 * 1000
    this.#rejectionRate = options.rejectionRate ?? 0.05
    this.#rejectionWindow = options.rejectionWindow ?? 100
    this.#rejectionMinimum = options.rejectionMinimum ?? 5
  }

  async report(): Promise<PauseReport> {
    const state = (await this.#store.load()) ?? emptyPauseState()
    if (!state.reason) return { paused: false, reason: null, message: 'ok' }
    if (state.until && Date.parse(state.until) <= this.#now().getTime()) {
      // A timed pause expired: clear it and let work resume on its own.
      await this.#store.save({ ...state, reason: null, message: null, since: null, until: null })
      return { paused: false, reason: null, message: 'ok' }
    }
    return { paused: true, reason: state.reason, message: state.message ?? state.reason }
  }

  async pause(reason: PauseReason, message: string, until: Date | null = null): Promise<void> {
    const state = (await this.#store.load()) ?? emptyPauseState()
    if (state.reason === reason) return
    await this.#store.save({
      ...state,
      reason,
      message,
      since: this.#now().toISOString(),
      until: until ? until.toISOString() : null,
    })
  }

  async resume(): Promise<void> {
    const state = (await this.#store.load()) ?? emptyPauseState()
    await this.#store.save({
      ...state,
      reason: null,
      message: null,
      since: null,
      until: null,
      consecutiveServerErrors: 0,
      windowAttempts: 0,
      windowRejections: 0,
    })
  }

  async noteSuccess(): Promise<void> {
    const state = (await this.#store.load()) ?? emptyPauseState()
    await this.#store.save({
      ...state,
      consecutiveServerErrors: 0,
      windowAttempts: Math.min(state.windowAttempts + 1, this.#rejectionWindow),
    })
  }

  async noteServerError(): Promise<void> {
    const state = (await this.#store.load()) ?? emptyPauseState()
    const consecutive = state.consecutiveServerErrors + 1
    const next = { ...state, consecutiveServerErrors: consecutive }
    if (consecutive >= this.#serverErrorThreshold && !state.reason) {
      next.reason = 'server_errors'
      next.message = `${consecutive} consecutive server errors; retrying after the cooldown.`
      next.since = this.#now().toISOString()
      next.until = new Date(this.#now().getTime() + this.#cooldownMs).toISOString()
    }
    await this.#store.save(next)
  }

  async noteRejection(): Promise<void> {
    const state = (await this.#store.load()) ?? emptyPauseState()
    const windowAttempts = Math.min(state.windowAttempts + 1, this.#rejectionWindow)
    const windowRejections = Math.min(state.windowRejections + 1, this.#rejectionWindow)
    const next = { ...state, windowAttempts, windowRejections, consecutiveServerErrors: 0 }
    const rate = windowRejections / Math.max(windowAttempts, 1)
    if (
      !state.reason &&
      windowAttempts >= this.#rejectionMinimum &&
      rate > this.#rejectionRate
    ) {
      next.reason = 'rejections'
      next.message = `${windowRejections} of the last ${windowAttempts} postings were rejected (${(
        rate * 100
      ).toFixed(1)}%); a human must fix the mapping before the queue drains again.`
      next.since = this.#now().toISOString()
      next.until = null
    }
    await this.#store.save(next)
  }
}
