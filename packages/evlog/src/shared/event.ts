/**
 * Helpers for building / mutating wide events from inside enrichers and adapters.
 */

import type { WideEvent } from '../types'

/**
 * Whether a value is a plain object, and so safe to walk field by field.
 * A `Date`, a `Map`, or a class instance is treated as a leaf.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Flatten nested plain objects into dotted keys — `user.id`, `ai.costUsd`.
 * Arrays and non-plain values are kept as they are; an empty object stays a
 * leaf rather than disappearing.
 */
export function flattenRecord(
  source: Record<string, unknown>,
  prefix = '',
  out: Record<string, unknown> = {},
): Record<string, unknown> {
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (isPlainObject(value) && Object.keys(value).length > 0) {
      flattenRecord(value, path, out)
      continue
    }
    out[path] = value
  }
  return out
}

/**
 * One-line summary of a wide event — `POST /api/checkout (500)`.
 *
 * Limited to the request shape and its outcome: `method`, `path`, `status`.
 * Returns an empty string when the event carries none of them, leaving the
 * caller to pick its own fallback.
 */
export function formatEventSummary(event: WideEvent): string {
  const method = typeof event.method === 'string' ? event.method : ''
  const path = typeof event.path === 'string' ? event.path : ''
  const status = typeof event.status === 'number' ? event.status : undefined

  const head = [method, path].filter(part => part.length > 0).join(' ')
  if (head) return status !== undefined ? `${head} (${status})` : head
  return status !== undefined ? `(${status})` : ''
}

/**
 * Merge a computed value onto an existing event field. By default, existing
 * object values win over computed ones — so `log.set({ geo: ... })` keeps
 * precedence over an enricher's automatic detection.
 */
export function mergeEventField<T>(
  existing: unknown,
  computed: T,
  overwrite?: boolean,
): T {
  if (overwrite) return computed
  if (typeof computed !== 'object' || computed === null) {
    return existing === undefined || existing === null ? computed : existing as T
  }
  if (existing === undefined || existing === null || typeof existing !== 'object') {
    return computed
  }
  return { ...computed, ...(existing as T) }
}

/** Typed attribute used when flattening events for OTLP/Sentry/Datadog/PostHog. */
export type AttributeValueKind = 'string' | 'integer' | 'double' | 'boolean'

export interface TypedAttributeValue {
  value: string | number | boolean
  type: AttributeValueKind
}

/** Convert a JS value to a {@link TypedAttributeValue}. Objects are JSON-serialized. */
export function toTypedAttributeValue(value: unknown): TypedAttributeValue | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string') return { value, type: 'string' }
  if (typeof value === 'boolean') return { value, type: 'boolean' }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return { value, type: 'integer' }
    return { value, type: 'double' }
  }
  return { value: JSON.stringify(value), type: 'string' }
}

/** OTLP `AnyValue` subset evlog emits: primitives and homogeneous primitive arrays. */
export type OtlpAttributeValue =
  | { stringValue: string }
  | { boolValue: boolean }
  | { intValue: string }
  | { doubleValue: number }
  | { arrayValue: { values: OtlpAttributeValue[] } }

function toOtlpArrayValue(values: unknown[]): OtlpAttributeValue | undefined {
  if (values.length === 0) return undefined
  const kind = typeof values[0]
  if (!values.every(v => typeof v === kind)) return undefined
  if (kind === 'string') return { arrayValue: { values: (values as string[]).map(v => ({ stringValue: v })) } }
  if (kind === 'boolean') return { arrayValue: { values: (values as boolean[]).map(v => ({ boolValue: v })) } }
  if (kind !== 'number') return undefined
  const numbers = values as number[]
  if (!numbers.every(Number.isFinite)) return undefined
  // An OTLP array must hold a single value type, so one fractional element makes every element a double.
  if (numbers.every(Number.isInteger)) return { arrayValue: { values: numbers.map(v => ({ intValue: String(v) })) } }
  return { arrayValue: { values: numbers.map(v => ({ doubleValue: v })) } }
}

/**
 * Convert a JS value to the OTLP `AnyValue` shape. Numbers map to `intValue`
 * or `doubleValue`, non-empty arrays of one primitive type to `arrayValue`.
 * Everything else, including non-finite numbers, is sent as a string.
 */
export function toOtlpAttributeValue(value: unknown): OtlpAttributeValue {
  if (typeof value === 'boolean') return { boolValue: value }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return { intValue: String(value) }
    if (Number.isFinite(value)) return { doubleValue: value }
    return { stringValue: String(value) }
  }
  if (Array.isArray(value)) {
    const array = toOtlpArrayValue(value)
    if (array) return array
  }
  return { stringValue: JSON.stringify(value) }
}
