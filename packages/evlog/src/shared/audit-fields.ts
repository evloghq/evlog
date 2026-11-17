import type { AuditFields, WideEvent } from '../types'
import type { AuditInput } from '../audit-action'

/**
 * Current version of the audit envelope. Bumped when `AuditFields` evolves
 * in a backward-incompatible way so downstream pipelines can branch on it.
 */
export const AUDIT_SCHEMA_VERSION = 1

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  if (Object.prototype.toString.call(value) !== '[object Object]') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || value.constructor === Object
}

/**
 * @internal Stable JSON stringification with deterministic key order.
 * Used by `idempotencyKey` and `hash-chain` so the same logical event always
 * produces the same digest, regardless of how object keys were added.
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

/**
 * @internal Sync, isomorphic 32-bit FNV-1a. Used to derive the idempotency
 * key without pulling `node:crypto` into the static import graph (which would
 * break browser / Cloudflare Workers bundles that import `evlog` for types
 * or shared utilities). Idempotency keys are dedup tokens, not security
 * primitives — collision resistance at 128 bits is more than sufficient.
 */
function fnv1a32(input: string, seed: number): number {
  let h = seed >>> 0
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i) & 0xff
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/**
 * @internal Compute the deterministic idempotency key for an audit event.
 * Includes `action`, `actor.{type,id}`, `target.{type,id}`, `outcome`, and
 * `timestamp` rounded to the second so retries within the same second collapse.
 *
 * Uses four interleaved FNV-1a 32-bit hashes (128-bit output, 32 hex chars)
 * so the implementation stays sync and isomorphic across Node, browsers,
 * Bun, Deno, and Cloudflare Workers.
 */
function computeIdempotencyKey(audit: AuditFields, timestamp: string): string {
  const seconds = timestamp.slice(0, 19)
  const payload = stableStringify({
    action: audit.action,
    actor: { type: audit.actor.type, id: audit.actor.id },
    target: audit.target ? { type: audit.target.type, id: audit.target.id } : undefined,
    outcome: audit.outcome,
    timestamp: seconds,
  })
  const a = fnv1a32(payload, 0x811c9dc5).toString(16).padStart(8, '0')
  const b = fnv1a32(payload, 0xdeadbeef).toString(16).padStart(8, '0')
  const c = fnv1a32(payload, 0x1f83d9ab).toString(16).padStart(8, '0')
  const d = fnv1a32(payload, 0x5be0cd19).toString(16).padStart(8, '0')
  return a + b + c + d
}

/**
 * Build a normalised {@link AuditFields} from caller input. Defaults:
 * - `outcome` → `'success'`
 * - `version` → {@link AUDIT_SCHEMA_VERSION}
 *
 * `idempotencyKey` is filled at emit time with the event timestamp so retries
 * stay deterministic.
 */
export function buildAuditFields(input: AuditInput): AuditFields {
  return {
    action: input.action,
    actor: input.actor,
    target: input.target,
    outcome: input.outcome ?? 'success',
    reason: input.reason,
    changes: input.changes,
    causationId: input.causationId,
    correlationId: input.correlationId,
    version: input.version ?? AUDIT_SCHEMA_VERSION,
  }
}

/**
 * @internal Test-collector hook installed by `mockAudit`. When set, every
 * audit event flowing through `log.audit()` / `audit()` is also pushed to it.
 */
let _testCollector: AuditCollector | null = null

type AuditCollector = (event: AuditFields, wide: WideEvent | null) => void

/** @internal Install the `mockAudit` collector; returns the one it replaced. */
export function setAuditTestCollector(collector: AuditCollector | null): AuditCollector | null {
  const previous = _testCollector
  _testCollector = collector
  return previous
}

/** @internal Emit-time decoration: assign timestamp-based idempotency key. */
function decorateAudit(audit: AuditFields, timestamp: string): AuditFields {
  if (audit.idempotencyKey) return audit
  return { ...audit, idempotencyKey: computeIdempotencyKey(audit, timestamp) }
}

/**
 * @internal Hook used by `RequestLogger.emit()` to detect audit-driven
 * force-keep flags on the accumulated context. Returns whether the event was
 * marked by `log.audit()` and clears the flag.
 */
export function consumeAuditForceKeep(context: Record<string, unknown>): boolean {
  if (context._auditForceKeep) {
    delete context._auditForceKeep
    return true
  }
  if (context.audit) return true
  return false
}

/** @internal True when `audit` has the minimum fields required before emit decoration. */
function isCompleteAuditFields(a: unknown): a is AuditFields {
  if (!a || typeof a !== 'object') return false
  const audit = a as AuditFields
  return typeof audit.action === 'string'
    && typeof audit.actor?.type === 'string'
    && typeof audit.actor?.id === 'string'
}

/**
 * @internal Decorate the audit field on an event right before drain — fills
 * in the deterministic idempotency key. Called by the logger pipeline so
 * it works for both `log.audit()` and direct `log.set({ audit })` paths.
 * Skips partial/legacy shapes that omit required actor fields.
 */
export function finalizeAudit(event: WideEvent): void {
  const a = event.audit as AuditFields | undefined
  if (!isCompleteAuditFields(a)) return
  const decorated = decorateAudit(a, String(event.timestamp))
  event.audit = decorated
  _testCollector?.(decorated, event)
}
