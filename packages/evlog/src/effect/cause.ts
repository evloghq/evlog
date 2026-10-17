import { Cause, Predicate } from 'effect'
import type { AuditableLogger } from '../audit'

/** Client-closed-request status, recorded for a unit of work that was interrupted. */
const CANCELLED_STATUS = 499

function namedError(name: string, message: string): Error {
  const error = new Error(message)
  error.name = name
  return error
}

/**
 * @internal Convert a failure value to an `Error`. Only an `Error`, a string or a
 * string `_tag` reaches the wide event: failure values can carry prompts and tool
 * payloads, so nothing else of the value is copied or serialized.
 */
export function errorFromFailure(value: unknown): Error {
  if (value instanceof Error) return value
  if (typeof value === 'string') return new Error(value)
  if (Predicate.hasProperty(value, '_tag') && typeof value._tag === 'string') return namedError(value._tag, value._tag)
  return namedError('UnknownError', 'A failure value that is not an Error was raised')
}

function reasonError(reason: Cause.Fail<unknown> | Cause.Die): Error {
  return errorFromFailure(reason._tag === 'Fail' ? reason.error : reason.defect)
}

/**
 * @internal Record the failure of a unit of work on its wide event: the primary
 * failure as `error` (an expected failure before a defect, as `Cause.squash` ranks
 * them), the others as `error.suppressed`, or the cancelled status for a pure
 * interruption.
 */
export function recordCause(
  logger: AuditableLogger,
  cause: Cause.Cause<unknown>,
  options?: { skipDefect?: (defect: unknown) => boolean },
): void {
  const reasons = cause.reasons.filter((reason): reason is Cause.Fail<unknown> | Cause.Die =>
    Cause.isFailReason(reason) || (Cause.isDieReason(reason) && !options?.skipDefect?.(reason.defect)))
  const primary = reasons.find(Cause.isFailReason) ?? reasons.find(Cause.isDieReason)
  if (primary === undefined) {
    if (cause.reasons.some(Cause.isInterruptReason) && logger.getContext().status === undefined) {
      logger.set({ status: CANCELLED_STATUS })
    }
    return
  }
  logger.error(reasonError(primary))
  const suppressed = reasons.filter(reason => reason !== primary).map((reason) => {
    const { name, message } = reasonError(reason)
    return { name, message }
  })
  if (suppressed.length > 0) logger.set({ error: { suppressed } })
}
