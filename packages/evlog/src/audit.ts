import type { AuditActor, AuditFields, AuditPatchOp, AuditTarget, DrainContext, EnrichContext, RedactConfig, RequestLogger, WideEvent } from './types'
import { recordAudit } from './logger'
import { compileRedactPathMatchers, escapePointerSegment, isFieldRecord, redactValueByPaths } from './redact'
import { getAuditRecord, setAuditTestCollector, stableStringify } from './shared/audit-fields'
import type { AuditInput } from './audit-action'

export { defineAuditAction, type AuditInput, type DefineAuditActionOptions, type DefinedAuditAction } from './audit-action'
export { AUDIT_SCHEMA_VERSION, buildAuditFields } from './shared/audit-fields'

/**
 * Add audit semantics to an existing {@link RequestLogger}.
 *
 * Mutates the logger in place by adding an `audit` method (with a `.deny()`
 * sub-method) that records through the app-wide pipeline, like {@link audit},
 * with the logger's `requestId`, `method` and `path`. Idempotent: calling twice
 * on the same logger only attaches the methods once.
 *
 * @example
 * ```ts
 * const log = withAuditMethods(createLogger())
 * await log.audit({
 *   action: 'invoice.refund',
 *   actor: { type: 'user', id: user.id },
 *   target: { type: 'invoice', id: 'inv_889' },
 * })
 * ```
 */
export function withAuditMethods<T extends object = Record<string, unknown>>(logger: RequestLogger<T>): AuditableLogger<T> {
  const target = logger as AuditableLogger<T>
  if ((target as { audit?: AuditMethod<T> }).audit) return target

  const audit = function audit(input: AuditInput): Promise<void> {
    return recordAudit(input, target.getContext())
  } as AuditMethod<T>

  audit.deny = function deny(reason: string, input: Omit<AuditInput, 'outcome' | 'reason'>): Promise<void> {
    return audit({ ...input, outcome: 'denied', reason })
  }

  target.audit = audit
  return target
}

/**
 * Logger augmented with `.audit()` / `.audit.deny()` helpers.
 */
export type AuditableLogger<T extends object = Record<string, unknown>> = RequestLogger<T> & { audit: AuditMethod<T> }

/**
 * Request logger that a framework integration hands to route code (`c.get('log')`,
 * `req.log`, `context.log`, …). {@link RequestLogger.fork} is always present on it.
 */
export type ForkableLogger<T extends object = Record<string, unknown>> = AuditableLogger<T> & Required<Pick<RequestLogger<T>, 'fork'>>

/**
 * Method shape attached to {@link AuditableLogger}.
 *
 * Each call records one audit and emits it right away as its own event, with
 * the request's `requestId`, `traceId`, IP and user agent, through the
 * integration's enrichers and drains. Call it as often as the request needs.
 * Sampling, `discard()` and route filters do not apply to it.
 *
 * The promise resolves once every drain has handled the event, so awaiting it
 * stores the record before the response. It never rejects: a failing drain is
 * reported on the console. Without `await`, evlog keeps the runtime alive with
 * `waitUntil` (Vercel, Cloudflare) until the drains finish.
 */
export interface AuditMethod<T extends object = Record<string, unknown>> {
  (input: AuditInput): Promise<void>
  /**
   * Record an AuthZ-denied action. Forces `outcome: 'denied'` and requires
   * a human-readable `reason`. Most teams forget to log denials — they are
   * exactly what auditors and security teams ask for.
   */
  deny: (reason: string, input: Omit<AuditInput, 'outcome' | 'reason'>) => Promise<void>
}

/**
 * Record an audit outside a request (jobs, scripts, CLIs, Nitro tasks).
 *
 * Emits one event through the app-wide pipeline: plugins and the `initLogger`
 * drain, or the `evlog:enrich` and `evlog:drain` hooks in a Nitro or Nuxt app.
 * Resolves once every drain has handled it and never rejects. Does nothing when
 * logging is disabled.
 *
 * @example
 * ```ts
 * import { audit } from 'evlog'
 *
 * await audit({
 *   action: 'cron.cleanup',
 *   actor: { type: 'system', id: 'cron' },
 *   target: { type: 'job', id: 'cleanup-stale-sessions' },
 * })
 * ```
 */
export function audit(input: AuditInput): Promise<void> {
  return recordAudit(input, {})
}

/**
 * Wrap a function so its outcome (success / failure / denied) is automatically
 * audited.
 *
 * Behaviour:
 * - If `fn` resolves, an audit event with `outcome: 'success'` is emitted.
 * - If `fn` throws an `EvlogError` (or any error) with `status === 403`, the
 *   audit event is recorded as `'denied'` with the error message as `reason`.
 * - Any other thrown error produces `outcome: 'failure'` and re-throws.
 *
 * Use {@link AuditDeniedError} to signal denial without an HTTP status.
 *
 * @example
 * ```ts
 * const refundInvoice = withAudit(
 *   { action: 'invoice.refund', target: (input) => ({ type: 'invoice', id: input.id }) },
 *   async (input: { id: string }, ctx: { actor: AuditActor }) => {
 *     await db.invoices.refund(input.id)
 *   }
 * )
 *
 * await refundInvoice({ id: 'inv_889' }, { actor: { type: 'user', id: user.id } })
 * ```
 */
export function withAudit<TInput, TOutput>(
  options: WithAuditOptions<TInput>,
  fn: (input: TInput, ctx: WithAuditContext) => Promise<TOutput> | TOutput,
): (input: TInput, ctx: WithAuditContext) => Promise<TOutput> {
  return async (input, ctx) => {
    const target = typeof options.target === 'function' ? options.target(input) : options.target
    const { actor, tenantId, causationId, correlationId } = ctx
    try {
      const result = await fn(input, ctx)
      await audit({ action: options.action, actor, target, tenantId, outcome: 'success', causationId, correlationId })
      return result
    } catch (err) {
      const error = err as Error & { status?: number; statusCode?: number }
      const status = error.status ?? error.statusCode
      const denied = err instanceof AuditDeniedError || status === 403
      await audit({
        action: options.action,
        actor,
        target,
        tenantId,
        outcome: denied ? 'denied' : 'failure',
        reason: error.message,
        causationId,
        correlationId,
      })
      throw err
    }
  }
}

/**
 * Throw inside a {@link withAudit} body to mark the action as `outcome: 'denied'`
 * regardless of the underlying HTTP status. The constructor message becomes the
 * audit `reason`.
 */
export class AuditDeniedError extends Error {

  constructor(reason: string) {
    super(reason)
    this.name = 'AuditDeniedError'
  }

}

/** Options for {@link withAudit}. `target` may be derived from the input. */
export interface WithAuditOptions<TInput> {
  action: string
  target?: AuditTarget | ((input: TInput) => AuditTarget | undefined)
}

/**
 * Runtime context required by a {@link withAudit}-wrapped function.
 * The actor is always required; the tenant and correlation IDs are optional.
 */
export interface WithAuditContext {
  actor: AuditActor
  tenantId?: string
  causationId?: string
  correlationId?: string
}

/**
 * @internal Equality for the values `auditDiff` does not recurse into:
 * `Date` by timestamp, `RegExp` by source and flags, `Set` and `Map` by content.
 * Anything else is equal only when it is the same reference.
 */
function isSameNonPlainValue(a: unknown, b: unknown, seen = new Map<object, Set<object>>()): boolean {
  if (Object.is(a, b)) return true
  if (a instanceof Date && b instanceof Date) return Object.is(a.getTime(), b.getTime())
  if (a instanceof RegExp && b instanceof RegExp) return String(a) === String(b)
  if (a instanceof Set && b instanceof Set) {
    return a.size === b.size && [...a].every(v => b.has(v))
  }
  if (a instanceof Map && b instanceof Map) {
    // A pair already being compared is assumed equal, so self-referential Maps terminate.
    const pairs = seen.get(a) ?? seen.set(a, new Set()).get(a)!
    if (pairs.has(b)) return true
    pairs.add(b)
    return a.size === b.size && [...a].every(([k, v]) => b.has(k) && isSameNonPlainValue(v, b.get(k), seen))
  }
  return false
}

/**
 * Compute a compact, redact-aware diff between two objects for the
 * `changes` field. Output is a JSON Patch-style array (RFC 6902 subset:
 * `add`, `remove`, `replace`) — small enough to ship over the wire.
 *
 * Fields matching `redactPaths` glob patterns (e.g. `'password'`, `'**.password'`,
 * `'*_token'`, `'user.email'`) are replaced with `'[REDACTED]'` so PII
 * never leaks through the diff.
 *
 * @example
 * ```ts
 * log.audit({
 *   action: 'user.update',
 *   actor: { type: 'user', id: user.id },
 *   target: { type: 'user', id: 'usr_42' },
 *   changes: auditDiff(before, after, { redactPaths: ['password'] }),
 * })
 * ```
 */
export function auditDiff(
  before: unknown,
  after: unknown,
  options: AuditDiffOptions = {},
): { before?: unknown, after?: unknown, patch: AuditPatchOp[] } {
  const replacement = options.replacement ?? '[REDACTED]'
  const pathMatchers = compileRedactPathMatchers(options.redactPaths) ?? {
    exactPaths: new Set<string>(),
    pathGlobs: [],
    keyGlobs: [],
    caseInsensitiveLeaves: new Set<string>(),
  }
  const patch: AuditPatchOp[] = []
  // Record pairs being diffed on the current path, so self-referential objects terminate.
  const ancestors = new Map<object, Set<object>>()

  function diff(a: unknown, b: unknown, path: string): void {
    if (a === b) return

    if (a === undefined && b !== undefined) {
      patch.push({ op: 'add', path, value: redactValue(b, path) })
      return
    }
    if (a !== undefined && b === undefined) {
      patch.push({ op: 'remove', path })
      return
    }

    if (isFieldRecord(a) && isFieldRecord(b)) {
      const pairs = ancestors.get(a) ?? ancestors.set(a, new Set()).get(a)!
      if (pairs.has(b)) return
      pairs.add(b)
      const keys = new Set([...Object.keys(a), ...Object.keys(b)])
      for (const key of keys) {
        diff(a[key], b[key], `${path}/${escapePointerSegment(key)}`)
      }
      pairs.delete(b)
      return
    }

    if (isSameNonPlainValue(a, b)) return

    patch.push({ op: 'replace', path, value: redactValue(b, path) })
  }

  function redactValue(value: unknown, path: string): unknown {
    return redactValueByPaths(value, pathMatchers, replacement, path)
  }

  diff(before, after, '')
  const result: { before?: unknown, after?: unknown, patch: AuditPatchOp[] } = { patch }
  if (options.includeBefore) result.before = redactValue(before, '')
  if (options.includeAfter) result.after = redactValue(after, '')
  return result
}

export type { AuditPatchOp } from './types'

/** Options for {@link auditDiff}. */
export interface AuditDiffOptions {
  /** Path globs (same syntax as `RedactConfig.paths`) whose values are replaced with `[REDACTED]`. */
  redactPaths?: string[]
  /** Custom replacement string. @default '[REDACTED]' */
  replacement?: string
  /** Include the full redacted `before` snapshot alongside the patch. */
  includeBefore?: boolean
  /** Include the full redacted `after` snapshot alongside the patch. */
  includeAfter?: boolean
}

/**
 * Test helper that captures every audit event emitted while it is active.
 *
 * Returns `{ events, restore, toIncludeAuditOf, assertAudit }`:
 * - `events` — live array of captured `AuditFields`, populated as audits fire.
 * - `restore()` — uninstall the collector. Call from `afterEach()`.
 * - `toIncludeAuditOf(matcher)` — returns `true` if at least one captured event matches.
 * - `assertAudit(matcher)` — returns the matched event or throws with a readable summary.
 *
 * Captures every record `log.audit()` and `audit()` make, with its `id`, as
 * soon as the call is made.
 *
 * @example
 * ```ts
 * const captured = mockAudit()
 * await refundInvoice('inv_889')
 * expect(captured.events).toHaveLength(1)
 * expect(captured.toIncludeAuditOf({ action: 'invoice.refund' })).toBe(true)
 * captured.restore()
 * ```
 */
export function mockAudit(): MockAudit {
  const events: AuditFields[] = []
  const previous = setAuditTestCollector((event) => {
    events.push(event)
  })

  return {
    events,
    restore() {
      setAuditTestCollector(previous)
    },
    toIncludeAuditOf(matcher) {
      return events.some(event => matchesAudit(event, matcher))
    },
    assertAudit(matcher) {
      const match = events.find(event => matchesAudit(event, matcher))
      if (!match) {
        const summary = events.map(e => ({ action: e.action, outcome: e.outcome }))
        const matcherStr = JSON.stringify(matcher, (_k, v) => (v instanceof RegExp ? v.toString() : v))
        throw new Error(
          `No audit event matched ${matcherStr}. Captured ${events.length} event(s): ${JSON.stringify(summary)}`,
        )
      }
      return match
    },
  }
}

/** Result of {@link mockAudit}. */
export interface MockAudit {
  events: AuditFields[]
  restore: () => void
  toIncludeAuditOf: (matcher: AuditMatcher) => boolean
  /** Throws when no captured event matches; returns the matched event otherwise. */
  assertAudit: (matcher: AuditMatcher) => AuditFields
}

/** Partial structural matcher for {@link MockAudit.toIncludeAuditOf}. */
export interface AuditMatcher {
  action?: string | RegExp
  outcome?: AuditFields['outcome']
  tenantId?: string
  actor?: Partial<AuditActor>
  target?: Partial<AuditTarget>
}

function matchesAudit(event: AuditFields, matcher: AuditMatcher): boolean {
  if (matcher.action !== undefined) {
    if (matcher.action instanceof RegExp) {
      if (!matcher.action.test(event.action)) return false
    } else if (event.action !== matcher.action) {
      return false
    }
  }
  if (matcher.outcome !== undefined && event.outcome !== matcher.outcome) return false
  if (matcher.tenantId !== undefined && event.tenantId !== matcher.tenantId) return false
  if (matcher.actor) {
    for (const [k, v] of Object.entries(matcher.actor)) {
      if ((event.actor as unknown as Record<string, unknown>)[k] !== v) return false
    }
  }
  if (matcher.target) {
    if (!event.target) return false
    for (const [k, v] of Object.entries(matcher.target)) {
      if ((event.target as Record<string, unknown>)[k] !== v) return false
    }
  }
  return true
}

/** Options for {@link auditEnricher}. */
export interface AuditEnricherOptions {
  /**
   * Resolve the tenant of the current request. Fills `event.audit.tenantId`
   * when the call that recorded the audit did not pass one.
   */
  tenantId?: (ctx: EnrichContext) => string | undefined
}

/**
 * Fill `event.audit.tenantId` from the request, for apps where every audit of a
 * request belongs to the same tenant. Events without an audit pass through.
 * Request context (`requestId`, `traceId`, IP, user agent) is recorded by
 * `log.audit()` itself and needs no enricher.
 */
export function auditEnricher(options: AuditEnricherOptions = {}): (ctx: EnrichContext) => void {
  return (ctx) => {
    const record = ctx.event.audit
    if (!record || record.tenantId !== undefined || !options.tenantId) return
    const tenantId = options.tenantId(ctx)
    if (tenantId !== undefined) record.tenantId = tenantId
  }
}

/** Drain function signature accepted by all wrappers. Matches `LoggerConfig['drain']`. */
export type DrainFn = (ctx: DrainContext) => void | Promise<void>

/**
 * Wrap a drain so it becomes an audit store: it receives only the events
 * `log.audit()` and `audit()` emitted in this process, one per record, and
 * the caller's `await` waits for it.
 *
 * The record it receives keeps the identities an audit exists to record:
 * redaction still applies `paths`, `secrets`, custom `patterns` and the
 * credential and card maskers, but not the `email`, `ipv4` and `phone` maskers.
 * Every other drain receives the fully masked event. Events rebuilt from JSON,
 * such as client events or replays, are not audit records and are skipped.
 *
 * @example
 * ```ts
 * import { initLogger, auditOnly } from 'evlog'
 * import { composeDrains } from 'evlog/toolkit'
 * import { createAxiomDrain } from 'evlog/axiom'
 * import { createFsDrain } from 'evlog/fs'
 *
 * initLogger({
 *   drain: composeDrains([
 *     createAxiomDrain({ dataset: 'logs' }),
 *     auditOnly(createFsDrain({ dir: '.audit' })),
 *   ]),
 * })
 * ```
 */
export function auditOnly(drain: DrainFn): DrainFn {
  return async (ctx) => {
    const record = getAuditRecord(ctx.event)
    if (!record) return
    await drain({ ...ctx, event: { ...ctx.event, audit: record } })
  }
}

/** One stored audit record and its position in the app's store. */
export interface RelayAuditEntry<TCursor> {
  cursor: TCursor
  record: AuditFields
}

/** Options for {@link relayAudit}. */
export interface RelayAuditOptions<TCursor> {
  /** The position of the last record the destination accepted; `undefined` to start from the oldest. */
  cursor: TCursor | undefined
  /**
   * Up to `limit` records stored after `after`, oldest first. Return only
   * records whose position is final: with a database sequence, leave out rows
   * written in the last few seconds, since concurrent inserts commit out of order.
   */
  read: (after: TCursor | undefined, limit: number) => Promise<RelayAuditEntry<TCursor>[]>
  /** Deliver the records in order; throw when the destination did not accept them all. */
  send: (records: AuditFields[]) => Promise<void>
  /**
   * Store the new position. Throw when another run already moved it (a
   * compare-and-set that matched no row) to stop this one.
   */
  save: (cursor: TCursor) => Promise<void>
  /** Records per `read` and `send`. @default 100 */
  limit?: number
  /** Stops the run between batches, such as `AbortSignal.timeout(50_000)` on a serverless function. */
  signal?: AbortSignal
}

/** What {@link relayAudit} did. `error` is set when it stopped at a failure. */
export interface RelayAuditResult<TCursor> {
  cursor: TCursor | undefined
  delivered: number
  error?: unknown
}

/**
 * Forward stored audit records to a destination, such as a tenant's webhook,
 * in the order they were stored. Reads a batch after `cursor`, sends it, saves
 * the new cursor, and repeats until the store has nothing newer, `signal`
 * aborts, or a step fails. Never throws: a failure is returned in `error` with
 * the cursor still on the last delivered batch, so the next run resends from
 * there. Delivery is at least once; receivers dedupe on `record.id`.
 *
 * The app owns scheduling, leases and backoff between runs.
 *
 * @example
 * ```ts
 * import { relayAudit } from 'evlog'
 * import { sendAuditWebhook } from 'evlog/webhook'
 *
 * const result = await relayAudit({
 *   cursor: destination.cursor,
 *   read: (after, limit) => db.readTeamAudit(teamId, after, limit),
 *   send: records => sendAuditWebhook(records, { url: destination.url, secret: destination.secret }),
 *   save: next => db.moveCursor(destination.id, destination.cursor, next),
 * })
 * if (result.error) await db.markFailing(destination.id, result.error)
 * ```
 */
export async function relayAudit<TCursor>(options: RelayAuditOptions<TCursor>): Promise<RelayAuditResult<TCursor>> {
  const limit = options.limit ?? 100
  let { cursor } = options
  let delivered = 0
  try {
    while (!options.signal?.aborted) {
      const batch = await options.read(cursor, limit)
      if (batch.length === 0) break
      await options.send(batch.map(entry => entry.record))
      const next = batch[batch.length - 1].cursor
      await options.save(next)
      cursor = next
      delivered += batch.length
      if (batch.length < limit) break
    }
    return { cursor, delivered }
  } catch (error) {
    return { cursor, delivered, error }
  }
}

/** Pluggable persistence for the hash-chain state. */
export interface SignedChainState {
  /** Load the previous hash from durable storage, or `null` on first run. */
  load: () => Promise<string | null> | string | null
  /** Persist the latest hash so the chain survives process restarts. */
  save: (hash: string) => Promise<void> | void
}

/** Options for {@link signed}. Pick a strategy at construction time. */
export type SignedOptions =
  | { strategy: 'hmac', secret: string, algorithm?: 'sha256' | 'sha512' }
  | { strategy: 'hash-chain', state?: SignedChainState, algorithm?: 'sha256' | 'sha512' }

/**
 * Wrap a drain so every event passing through gains tamper-evident integrity.
 *
 * - `'hmac'` — adds `event.audit.signature` (HMAC of the canonical event).
 * - `'hash-chain'` — adds `event.audit.prevHash` and `event.audit.hash` so the
 *   sequence of events forms a verifiable chain. State persists in memory
 *   by default; pass a `state: { load, save }` for cross-process / durable
 *   chains (Redis, file, Postgres).
 *
 * The signature is computed before the event is forwarded to the wrapped
 * drain — combine with {@link auditOnly} when you only want integrity for
 * audit events.
 *
 * @example
 * ```ts
 * import { initLogger, auditOnly, signed } from 'evlog'
 * import { createFsDrain } from 'evlog/fs'
 *
 * initLogger({
 *   drain: auditOnly(signed(createFsDrain({ dir: '.audit' }), { strategy: 'hash-chain' })),
 * })
 * ```
 */
export function signed(drain: DrainFn, options: SignedOptions): DrainFn {
  if (options.strategy === 'hmac') {
    const algorithm = options.algorithm ?? 'sha256'
    const { secret } = options
    return async (ctx) => {
      const a = ctx.event.audit as AuditFields | undefined
      if (a) {
        const payload = stableStringify(stripIntegrity(ctx.event))
        const signature = await hmacHex(algorithm, secret, payload)
        ctx.event.audit = { ...a, signature }
      }
      await drain(ctx)
    }
  }

  const algorithm = options.algorithm ?? 'sha256'
  const { state } = options
  let inMemoryPrev: string | null = null
  let initialised = !state
  let queue: Promise<void> = Promise.resolve()

  return (ctx) => {
    queue = queue.then(async () => {
      const a = ctx.event.audit as AuditFields | undefined
      if (a) {
        if (!initialised && state) {
          inMemoryPrev = (await state.load()) ?? null
          initialised = true
        }
        const prevHash = inMemoryPrev ?? undefined
        const payload = stableStringify({ ...stripIntegrity(ctx.event), audit: { ...stripIntegrity(ctx.event).audit, prevHash } })
        const hash = await digestHex(algorithm, payload)
        ctx.event.audit = { ...a, prevHash, hash }
        inMemoryPrev = hash
        await state?.save(hash)
      }
      await drain(ctx)
    }).catch((err) => {
      console.error('[evlog/audit] signed drain failed:', err)
    })
    return queue
  }
}

/**
 * @internal Resolve the Web Crypto SubtleCrypto interface. Available natively
 * in browsers, Node 19+, Bun, Deno, Cloudflare Workers, and Convex. Requires
 * `globalThis.crypto.subtle` — no `node:crypto` fallback so non-Node bundlers
 * can import the main entrypoint without resolving Node built-ins (#387).
 */
function getSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle
  if (subtle) return subtle
  throw new Error(
    '[evlog/audit] Web Crypto is not available. signed() requires globalThis.crypto.subtle '
    + '(Node 19+, modern browsers, Cloudflare Workers, Convex, Bun, Deno).',
  )
}

function normalizeAlgo(algorithm: string): string {
  switch (algorithm.toLowerCase()) {
    case 'sha1':
    case 'sha-1':
      return 'SHA-1'
    case 'sha256':
    case 'sha-256':
      return 'SHA-256'
    case 'sha384':
    case 'sha-384':
      return 'SHA-384'
    case 'sha512':
    case 'sha-512':
      return 'SHA-512'
    default:
      return 'SHA-256'
  }
}

function bufToHex(buf: ArrayBuffer): string {
  let out = ''
  for (const byte of new Uint8Array(buf)) out += byte.toString(16).padStart(2, '0')
  return out
}

async function digestHex(algorithm: string, data: string): Promise<string> {
  const buf = await getSubtle().digest(normalizeAlgo(algorithm), new TextEncoder().encode(data))
  return bufToHex(buf)
}

async function hmacHex(algorithm: string, secret: string, data: string): Promise<string> {
  const subtle = getSubtle()
  const hash = normalizeAlgo(algorithm)
  const key = await subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash }, false, ['sign'])
  const sig = await subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return bufToHex(sig)
}

/** @internal Strip integrity fields before hashing so signatures stay stable. */
function stripIntegrity(event: WideEvent): WideEvent {
  const a = event.audit as AuditFields | undefined
  if (!a) return event
  const { signature, prevHash, hash, ...rest } = a
  return { ...event, audit: rest as AuditFields }
}

/**
 * Strict redact preset for audit events.
 *
 * Combine with the user's existing redact configuration via spread:
 * `initLogger({ redact: { paths: [...auditRedactPreset.paths!, ...mine] } })`.
 *
 * Hardens PII handling:
 * - Drops `Authorization` and `Cookie` headers anywhere they appear.
 * - Drops common credential field names (`password`, `passwordHash`, `token`,
 *   `apiKey`, `secret`, `accessToken`, `refreshToken`, `cardNumber`, `cvv`,
 *   `ssn`).
 *
 * Built-in pattern maskers (email, credit card, …) keep their default
 * behaviour — partial masking, not full redaction — so audit trails retain
 * enough signal to be useful.
 */
export const auditRedactPreset: RedactConfig = {
  paths: [
    'password',
    'passwordHash',
    'token',
    'apiKey',
    'secret',
    'accessToken',
    'refreshToken',
    'cardNumber',
    'cvv',
    'ssn',
    'authorization',
    'cookie',
    'set-cookie',
  ],
}
