import type { SignalInput } from './define'

const PATTERNS: Array<[RegExp, string]> = [
  [/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g, '<time>'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>'],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>'],
  [/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{8,}\b/gi, '<id>'],
  [/\b[a-z]+_[A-Za-z0-9]{6,}\b/g, '<id>'],
  [/\d+(?:\.\d+)?/g, '<n>'],
]

/**
 * A cache key for error signals: the error's name and its message with
 * timestamps, UUIDs, emails, hex and prefixed ids (`ch_3Pq…`) and numbers
 * replaced by placeholders. `upstream timeout after 3012ms for req 8c1f…`
 * and the same message from the next request share one key, so a storm of
 * messages that differ only by ids costs one model call. Returns `undefined`
 * for an event without an `error`, which skips caching.
 *
 * @example
 * ```ts
 * defineSignal({ name: 'retryable', when: e => (e.status ?? 0) >= 500, ask: '…', cacheKey: errorFingerprint })
 * ```
 */
export function errorFingerprint(event: SignalInput): string | undefined {
  const error = event.error as { name?: unknown, message?: unknown } | undefined
  if (typeof error !== 'object' || error === null) return undefined
  let message = String(error.message ?? '')
  for (const [pattern, placeholder] of PATTERNS) message = message.replace(pattern, placeholder)
  return JSON.stringify([String(error.name ?? 'Error'), message])
}
