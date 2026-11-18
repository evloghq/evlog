import { defineState } from 'eve/context'
import type { AuditInput } from 'evlog'

export interface RecordedError {
  name: string
  message: string
  code?: string
  status?: number
  why?: string
  fix?: string
  link?: string
  stack?: string
}

/** One `useLogger()` call, replayed onto the turn's logger when the turn settles. */
export type RecordedCall =
  | { op: 'set', fields: Record<string, unknown> }
  | { op: 'info' | 'warn', message: string, context?: Record<string, unknown> }
  | { op: 'error', error: RecordedError, context?: Record<string, unknown> }
  | { op: 'audit', input: AuditInput }

export interface TurnSlot {
  turnId?: string
  calls: RecordedCall[]
  /** Every evlog error built during the turn, thrown or not; paired with failed calls at the end. */
  created: RecordedError[]
}

/**
 * What tools add to the running turn. eve keeps state with the session, so the
 * calls survive a resume in another process; one turn runs at a time per
 * session, and `turn.started` resets the slot.
 */
export const turnSlot = defineState<TurnSlot>('turn', () => ({ calls: [], created: [] }))
