import type { AuditFields, WideEvent } from '../types'
import type { AuditInput } from '../audit-action'

/**
 * Current version of the audit envelope. Bumped when `AuditFields` evolves
 * in a backward-incompatible way so downstream pipelines can branch on it.
 */
export const AUDIT_SCHEMA_VERSION = 2

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  if (Object.prototype.toString.call(value) !== '[object Object]') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || value.constructor === Object
}

/**
 * @internal Stable JSON stringification with deterministic key order, so the
 * `hash-chain` and `hmac` digests of one record do not depend on key order.
 */
export function stableStringify(value: unknown, ancestors = new WeakSet<object>()): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  // Track only the current recursion path: shared (diamond) references are fine, true cycles are not.
  if (ancestors.has(value)) return '"[Circular]"'
  if (!Array.isArray(value) && !isPlainObject(value)) return JSON.stringify(value)
  ancestors.add(value)
  const out = Array.isArray(value)
    ? `[${value.map(v => stableStringify(v, ancestors)).join(',')}]`
    : `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k], ancestors)}`).join(',')}}`
  ancestors.delete(value)
  return out
}

let lastMs = 0
let sequence = 0

/**
 * @internal RFC 9562 UUIDv7. The 12 bits after the version hold a counter that
 * starts at a random value below 2048 each millisecond, so ids made in one
 * process sort in creation order even within the same millisecond.
 */
export function uuidv7(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let ms = Date.now()
  if (ms > lastMs) {
    lastMs = ms
    sequence = ((bytes[6] & 0x07) << 8) | bytes[7]
  } else {
    ms = lastMs
    sequence++
    if (sequence > 0xfff) {
      ms = ++lastMs
      sequence = ((bytes[6] & 0x07) << 8) | bytes[7]
    }
  }
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms % 256
    ms = Math.floor(ms / 256)
  }
  bytes[6] = 0x70 | (sequence >> 8)
  bytes[7] = sequence & 0xff
  bytes[8] = 0x80 | (bytes[8] & 0x3f)
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Build an {@link AuditFields} record from caller input, with a fresh `id` and
 * `timestamp`, `outcome` defaulting to `'success'` and `version` set to
 * {@link AUDIT_SCHEMA_VERSION}. `log.audit()` and `audit()` call it for you; use
 * it directly to write a record to your own store without emitting an event.
 */
export function buildAuditFields(input: AuditInput): AuditFields {
  return {
    id: uuidv7(),
    timestamp: new Date().toISOString(),
    action: input.action,
    actor: input.actor,
    target: input.target,
    tenantId: input.tenantId,
    outcome: input.outcome ?? 'success',
    reason: input.reason,
    changes: input.changes,
    metadata: input.metadata,
    causationId: input.causationId,
    correlationId: input.correlationId,
    version: AUDIT_SCHEMA_VERSION,
  }
}

type AuditCollector = (event: AuditFields, wide: WideEvent | null) => void

/**
 * @internal Test-collector hook installed by `mockAudit`. When set, every
 * record made by `log.audit()` / `audit()` is also pushed to it.
 */
let _testCollector: AuditCollector | null = null

/** @internal Install the `mockAudit` collector; returns the one it replaced. */
export function setAuditTestCollector(collector: AuditCollector | null): AuditCollector | null {
  const previous = _testCollector
  _testCollector = collector
  return previous
}

/** @internal Report a record to the `mockAudit` collector, if one is installed. */
export function collectAudit(record: AuditFields, event: WideEvent): void {
  _testCollector?.(record, event)
}

/**
 * Marks an event `log.audit()` or `audit()` emitted, holding the record as an
 * audit store keeps it. Non-enumerable, so spreads, JSON and drains that
 * serialize the event never carry it.
 */
const AUDIT_RECORD = Symbol.for('evlog.auditRecord')

/** @internal Attach the record an audit store receives to the emitted event. */
export function markAuditEvent(event: WideEvent, record: AuditFields): void {
  Object.defineProperty(event, AUDIT_RECORD, { value: record, enumerable: false, configurable: true })
}

/**
 * @internal The record an audit store receives, or `undefined` when `event` was
 * not emitted by `log.audit()` or `audit()` in this process.
 */
export function getAuditRecord(event: WideEvent): AuditFields | undefined {
  return (event as WideEvent & { [AUDIT_RECORD]?: AuditFields })[AUDIT_RECORD]
}
