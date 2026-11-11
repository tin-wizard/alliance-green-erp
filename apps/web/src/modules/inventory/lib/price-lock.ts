/**
 * Price-editor lock decisions (E5/E6).
 *
 * The legacy lock expired after an hour with no signal to the holder. These
 * rules keep the lock visible: another holder is a hard block, an expired lock
 * is still shown and needs an explicit, justified takeover, and only the holder
 * can refresh.
 */
export type LockAction = 'acquire' | 'blocked' | 'takeover_needs_reason' | 'takeover'

export interface LockDecisionInput {
  isLocked: boolean
  holderId: string | null
  holderName: string | null
  expiresAt: Date | null
  userId: string
  takeOver: boolean
  reason: string | null
  now: Date
}

export interface LockDecision {
  action: LockAction
  message?: string
}

export function decideLockAction(input: LockDecisionInput): LockDecision {
  if (!input.isLocked || !input.holderId) return { action: 'acquire' }
  if (input.holderId === input.userId) return { action: 'acquire' }

  const name = input.holderName ?? input.holderId
  const expired = input.expiresAt === null || input.expiresAt.getTime() <= input.now.getTime()
  if (!expired) {
    return {
      action: 'blocked',
      message: `The price editor is locked by ${name} until ${input.expiresAt!.toISOString()}.`,
    }
  }
  if (!input.takeOver) {
    return {
      action: 'blocked',
      message: `The price lock held by ${name} expired at ${
        input.expiresAt?.toISOString() ?? 'an unknown time'
      }. Confirm takeover to continue; it was not cleared automatically.`,
    }
  }
  if (!input.reason?.trim()) {
    return {
      action: 'takeover_needs_reason',
      message: 'Taking over an expired price lock needs a reason.',
    }
  }
  return { action: 'takeover' }
}
