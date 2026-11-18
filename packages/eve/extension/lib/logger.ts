import type { AuditInput } from 'evlog'
import type { RecordedCall, RecordedError } from './state'
import { turnSlot } from './state'

export interface EveTurnLogger {
  /** Adds fields to the turn's event. Objects merge as with any evlog logger. */
  set: (fields: Record<string, unknown>) => void
  info: (message: string, context?: Record<string, unknown>) => void
  warn: (message: string, context?: Record<string, unknown>) => void
  /**
   * Records the error on the turn and keeps going. A thrown evlog error needs
   * no call: the turn records it with its code, status, why, fix and link.
   */
  error: <TError extends Error>(error: TError, context?: Record<string, unknown>) => TError
  /** Records who did what on which resource. The turn's event is then kept past sampling. */
  audit: ((input: AuditInput) => void) & {
    deny: (reason: string, input: Omit<AuditInput, 'outcome' | 'reason'>) => void
  }
}

function record(call: RecordedCall): void {
  turnSlot.update(slot => ({ ...slot, calls: [...slot.calls, call] }))
}

export function toRecordedError(error: Error): RecordedError {
  const { code, status, why, fix, link, stack } = error as Error & Partial<Omit<RecordedError, 'name' | 'message'>>
  return {
    name: error.name,
    message: error.message,
    ...(stack !== undefined && { stack }),
    ...(code !== undefined && { code }),
    ...(status !== undefined && { status }),
    ...(why !== undefined && { why }),
    ...(fix !== undefined && { fix }),
    ...(link !== undefined && { link }),
  }
}

/**
 * The logger of the running turn, for tools and the code they call. eve
 * stores what it records with the session, so it reaches the turn's event even
 * when the turn resumes in another process.
 *
 * @example
 * ```ts
 * import { useLogger } from '@evlog/eve/logger'
 *
 * useLogger().set({ order: { id, amount } })
 * ```
 */
export function useLogger(): EveTurnLogger {
  const audit = (input: AuditInput) => record({ op: 'audit', input })
  audit.deny = (reason: string, input: Omit<AuditInput, 'outcome' | 'reason'>) => audit({ ...input, outcome: 'denied', reason })
  return {
    audit,
    set: fields => record({ op: 'set', fields }),
    info: (message, context) => record({ op: 'info', message, ...(context && { context }) }),
    warn: (message, context) => record({ op: 'warn', message, ...(context && { context }) }),
    error(error, context) {
      record({ op: 'error', error: toRecordedError(error), ...(context && { context }) })
      return error
    },
  }
}
