import type { NitroRuntimeHooks } from 'nitropack/types'
import type {} from 'nitro/types'
import type { DevTerminalInput } from './shared/dev-terminal'

declare module 'nitropack/types' {
  interface NitroRuntimeHooks {
    /**
     * Tail sampling hook - called before emitting a log.
     * Set `ctx.shouldKeep = true` to force-keep the log regardless of head sampling.
     *
     * @example
     * ```ts
     * nitroApp.hooks.hook('evlog:emit:keep', (ctx) => {
     *   if (ctx.context.user?.premium) {
     *     ctx.shouldKeep = true
     *   }
     * })
     * ```
     */
    'evlog:emit:keep': (ctx: TailSamplingContext) => void | Promise<void>

    /**
     * Enrichment hook - called after emit, before drain.
     * Use this to enrich the event with derived context (e.g. geo, user agent).
     *
     * @example
     * ```ts
     * nitroApp.hooks.hook('evlog:enrich', (ctx) => {
     *   ctx.event.deploymentId = process.env.DEPLOYMENT_ID
     * })
     * ```
     */
    'evlog:enrich': (ctx: EnrichContext) => void | Promise<void>

    /**
     * Drain hook - called after emitting a log (fire-and-forget).
     * Use this to send logs to external services like Axiom, Loki, or custom endpoints.
     * Errors are logged but never block the request.
     *
     * @example
     * ```ts
     * nitroApp.hooks.hook('evlog:drain', async (ctx) => {
     *   await fetch('https://api.axiom.co/v1/datasets/logs/ingest', {
     *     method: 'POST',
     *     headers: { Authorization: `Bearer ${process.env.AXIOM_TOKEN}` },
     *     body: JSON.stringify([ctx.event])
     *   })
     * })
     * ```
     */
    'evlog:drain': (ctx: DrainContext) => void | Promise<void>
  }
}

declare module 'nitro/types' {
  interface NitroRuntimeHooks {
    'evlog:emit:keep': (ctx: TailSamplingContext) => void | Promise<void>
    'evlog:enrich': (ctx: EnrichContext) => void | Promise<void>
    'evlog:drain': (ctx: DrainContext) => void | Promise<void>
  }
}

/**
 * Transport configuration for sending client logs to the server.
 */
export interface TransportConfig {
  /**
   * Enable sending logs to the server API
   * @default false
   */
  enabled?: boolean

  /**
   * API endpoint for log ingestion
   * @default '/api/_evlog/ingest'
   */
  endpoint?: string

  /**
   * Fetch credentials mode
   * @default 'same-origin'
   */
  credentials?: RequestCredentials
}

/**
 * Payload sent from client to server for log ingestion
 */
export interface IngestPayload {
  timestamp: string
  level: 'info' | 'error' | 'warn' | 'debug'
  [key: string]: unknown
}

/**
 * Context describing *what* is being redacted and *where*, passed to a
 * function-valued {@link RedactConfig.replacement}.
 */
export interface RedactReplacementContext {
  /** Dot-notation path of the field from the event root (e.g. `user.email`, `items.0.token`). */
  path: string
  /** Leaf key of the field (e.g. `email`). Empty for the event root. */
  key: string
  /**
   * Capture groups of the matching `patterns` entry, in order.
   * Only set when the replacement was triggered by `patterns`; `undefined` for `paths`.
   */
  groups?: Array<string | undefined>
}

/**
 * Replacement used for `paths` and `patterns` redaction.
 *
 * A string is used verbatim. A function is called once per redacted value and
 * must return the replacement synchronously — use it when the replacement has
 * to be *derived* from the value (e.g. a stable fingerprint that keeps requests
 * correlatable without exposing the credential).
 *
 * The function receives the matched value: the whole field value for `paths`
 * (any type, since path redaction replaces entire subtrees), the matched
 * substring for `patterns`. If it throws or returns a non-string, redaction
 * falls back to `'[REDACTED]'` — a broken policy degrades to over-redaction,
 * never to leaking the raw value.
 */
export type RedactReplacement =
  | string
  | ((matched: unknown, ctx: RedactReplacementContext) => string)

/**
 * Auto-redaction configuration for PII protection.
 * Scrubs sensitive data from wide events before console output and draining.
 *
 * Built-in patterns are included by default. Opt out with `builtins: false`
 * or select specific ones with `builtins: ['email', 'creditCard']`.
 */
export interface RedactConfig {
  /**
   * Dot-notation paths to redact. Supports globs:
   * - `'user.email'` — exact path only
   * - `'password'` or `'**.password'` — key at any nesting depth
   * - `'*_token'` — key-name glob at any depth
   * - `'user.*'` — path glob under `user`
   */
  paths?: string[]
  /** Additional regex patterns to match and replace string values anywhere in the event */
  patterns?: RegExp[]
  /**
   * Control built-in PII patterns.
   * - `undefined` / omitted → all built-ins enabled (default)
   * - `false` → no built-ins, only custom `paths` and `patterns`
   * - `['email', 'creditCard', ...]` → only the listed built-ins
   *
   * Available: `'creditCard'`, `'email'`, `'ipv4'`, `'phone'`, `'jwt'`, `'bearer'`, `'iban'`
   */
  builtins?: false | Array<'creditCard' | 'email' | 'ipv4' | 'phone' | 'jwt' | 'bearer' | 'iban'>
  /**
   * Replacement used for path- and custom pattern redaction.
   * Built-in patterns use smart partial masking instead (e.g. `****1111` for credit cards).
   *
   * Pass a function to compute the replacement from the matched value — see
   * {@link RedactReplacement}.
   *
   * @default '[REDACTED]'
   *
   * @example
   * ```ts
   * // Keep requests correlatable without exposing the credential
   * initLogger({
   *   redact: {
   *     patterns: [/\/public\/claim\/([A-Za-z0-9._-]{12,})/g],
   *     replacement: (_match, ctx) => `/public/claim/[tok:${fingerprint(ctx.groups?.[0] ?? '')}]`,
   *   },
   * })
   * ```
   */
  replacement?: RedactReplacement
  /**
   * Escape hatch for policies that cannot be expressed declaratively —
   * conditional on a sibling field, tenant-scoped, schema-driven, or
   * allowlist-shaped rather than denylist-shaped.
   *
   * Runs **before** `paths`, `builtins`, and `patterns`, so it sees raw values
   * and the declarative rules still apply to whatever it leaves behind. Mutate
   * the event in place; it is already a private clone, so the caller's object is
   * never touched. Must be synchronous — it runs on the emit path, before the
   * console write.
   *
   * Errors are caught and reported the way drain failures are: the declarative
   * stages still run and the event is still logged.
   *
   * @example
   * ```ts
   * initLogger({
   *   redact: {
   *     transform: (event) => {
   *       if (event.tenant === 'regulated') delete event.query
   *     },
   *   },
   * })
   * ```
   */
  transform?: (event: WideEvent) => void
  /** @internal Resolved masker functions from built-in patterns. Not user-facing. */
  _maskers?: Array<[RegExp, (match: string) => string]>
  /** @internal Precompiled matchers for `paths`, built once by `resolveRedactConfig`. Not user-facing. */
  _pathMatchers?: {
    exactPaths: Set<string>
    pathGlobs: RegExp[]
    keyGlobs: RegExp[]
    caseInsensitiveLeaves: Set<string>
  }
}

/**
 * Sampling rates per log level (0-100 percentage)
 */
export interface SamplingRates {
  /** Percentage of info logs to keep (0-100). Default: 100 */
  info?: number
  /** Percentage of warn logs to keep (0-100). Default: 100 */
  warn?: number
  /** Percentage of debug logs to keep (0-100). Default: 100 */
  debug?: number
  /** Percentage of error logs to keep (0-100). Default: 100 */
  error?: number
}

/**
 * Tail sampling condition for forcing log retention based on request outcome.
 * All conditions use >= comparison (e.g., status: 400 means status >= 400).
 */
export interface TailSamplingCondition {
  /** Keep if HTTP status >= this value (e.g., 400 for all errors) */
  status?: number
  /** Keep if request duration >= this value in milliseconds */
  duration?: number
  /** Keep if path matches this glob pattern (e.g., '/api/critical/**') */
  path?: string
}

/**
 * Context passed to tail sampling evaluation and hooks.
 * Contains request outcome information for sampling decisions.
 */
export interface TailSamplingContext {
  /** HTTP response status code */
  status?: number
  /** Request duration in milliseconds (raw number) */
  duration?: number
  /** Request path */
  path?: string
  /** HTTP method */
  method?: string
  /** Full accumulated context from the request logger */
  context: Record<string, unknown>
  /**
   * Set to true in evlog:emit:keep hook to force keep this log.
   * Multiple hooks can set this - if any sets it to true, the log is kept.
   */
  shouldKeep?: boolean
}

/**
 * Context passed to the evlog:enrich hook.
 * Called after emit, before drain.
 */
export interface EnrichContext {
  /** The emitted wide event (mutable). */
  event: WideEvent
  /** Request metadata (if available) */
  request?: {
    method?: string
    path: string
    requestId?: string
  }
  /** Safe HTTP request headers (sensitive headers filtered out) */
  headers?: Record<string, string>
  /** Optional response metadata */
  response?: {
    status?: number
    headers?: Record<string, string>
  }
}

/**
 * Context passed to the evlog:drain hook.
 * Contains the complete wide event and request metadata for external transport.
 */
export interface DrainContext {
  /** The complete wide event to drain */
  event: WideEvent
  /** Request metadata (if available) */
  request?: {
    method?: string
    path?: string
    requestId?: string
  }
  /** HTTP headers from the original request (useful for correlation with external services) */
  headers?: Record<string, string>
}

/**
 * Sampling configuration for filtering logs
 */
export interface SamplingConfig {
  /**
   * Sampling rates per log level (head sampling).
   * Values are percentages from 0 to 100.
   * Default: 100 for all levels (log everything).
   * Error defaults to 100 even if not specified.
   *
   * @example
   * ```ts
   * sampling: {
   *   rates: {
   *     info: 10,    // Keep 10% of info logs
   *     warn: 50,    // Keep 50% of warning logs
   *     debug: 5,    // Keep 5% of debug logs
   *     error: 100,  // Always keep errors (default)
   *   }
   * }
   * ```
   */
  rates?: SamplingRates

  /**
   * Tail sampling conditions for forcing log retention (OR logic).
   * If ANY condition matches, the log is kept regardless of head sampling.
   * Use the `evlog:emit:keep` Nitro hook for custom conditions.
   *
   * @example
   * ```ts
   * sampling: {
   *   rates: { info: 10 },  // Head sampling: keep 10% of info logs
   *   keep: [
   *     { status: 400 },     // Always keep if status >= 400
   *     { duration: 1000 },  // Always keep if duration >= 1000ms
   *     { path: '/api/critical/**' },  // Always keep critical paths
   *   ]
   * }
   * ```
   */
  keep?: TailSamplingCondition[]
}

/**
 * Route-based service configuration
 */
export interface RouteConfig {
  /** Service name to use for routes matching this pattern */
  service: string
}

/**
 * Environment context automatically included in every log event
 */
export interface EnvironmentContext {
  /** Service name (auto-detected from package.json or configurable) */
  service: string
  /** Environment: 'development', 'production', 'test', etc. */
  environment: 'development' | 'production' | 'test' | string
  /** Application version (auto-detected from package.json) */
  version?: string
  /** Git commit hash (auto-detected from CI/CD env vars) */
  commitHash?: string
  /** Deployment region (auto-detected from cloud provider env vars) */
  region?: string
}

/**
 * Logger configuration options
 */
export interface LoggerConfig {
  /**
   * Enable or disable all logging globally.
   * When false, all emits, tagged logs, and request logger operations become no-ops.
   * @default true
   */
  enabled?: boolean
  /** Environment context overrides */
  env?: Partial<EnvironmentContext>
  /** Enable pretty printing (auto-detected: true in dev, false in prod) */
  pretty?: boolean
  /**
   * Dev terminal output: preset or explicit overlay + pretty-error settings.
   * @default 'evlog' when pretty in development
   */
  dev?: DevTerminalInput
  /** Sampling configuration for filtering logs */
  sampling?: SamplingConfig
  /**
   * Minimum severity for the global `log` API (tagged and object form).
   * Does not apply to `createLogger().emit()` / request wide events (use `sampling` for volume).
   * Order: debug < info < warn < error.
   * @default 'debug' (all levels)
   */
  minLevel?: LogLevel
  /**
   * When pretty is disabled, emit JSON strings (default) or raw objects.
   * Set to false for environments like Cloudflare Workers that expect objects.
   * @default true
   */
  stringify?: boolean
  /**
   * Suppress built-in console output.
   * When true, events are still built, sampled, and passed to drains,
   * but nothing is written to console. Use when drains own the output
   * channel (e.g., stdout-based platforms like GCP Cloud Run, AWS Lambda).
   * @default false
   */
  silent?: boolean
  /**
   * Auto-redaction configuration for PII protection.
   * Scrubs sensitive data from wide events before console output and before any drain.
   *
   * - `true` → enable with all built-in patterns (email, credit card, IPv4, phone, JWT, Bearer, IBAN)
   * - `{ paths, patterns, builtins }` → fine-grained control
   * - `false` → explicitly disable redaction
   *
   * @default true in production, false in development
   *
   * @example
   * ```ts
   * // Disable in production
   * initLogger({ redact: false })
   *
   * // With custom paths on top of built-ins
   * initLogger({
   *   redact: {
   *     paths: ['user.password', 'headers.authorization'],
   *   },
   * })
   *
   * // Only specific built-ins + custom patterns
   * initLogger({
   *   redact: {
   *     builtins: ['email', 'creditCard'],
   *     patterns: [/SECRET_\w+/g],
   *   },
   * })
   * ```
   */
  redact?: boolean | RedactConfig
  /**
   * Drain callback called with every emitted event (fire-and-forget).
   * Use this to send logs to external services outside of Nitro.
   * Compatible with drain adapters (`createAxiomDrain()`) and pipeline-wrapped drains.
   *
   * @example
   * ```ts
   * import { initLogger, log } from 'evlog'
   * import { createAxiomDrain } from 'evlog/axiom'
   *
   * initLogger({
   *   drain: createAxiomDrain({ dataset: 'logs', token: '...' }),
   * })
   *
   * log.info({ action: 'user_login' }) // automatically drained
   * ```
   *
   * @example
   * ```ts
   * // With pipeline for batching and retry
   * import { createDrainPipeline } from 'evlog/pipeline'
   *
   * const pipeline = createDrainPipeline({ batch: { size: 25 } })
   * const drain = pipeline(createAxiomDrain({ dataset: 'logs', token: '...' }))
   *
   * initLogger({ drain })
   *
   * // Flush on shutdown
   * process.on('beforeExit', () => drain.flush())
   * ```
   */
  drain?: (ctx: DrainContext) => void | Promise<void>
  /**
   * Plugins registered globally with the logger.
   *
   * Plugins are the canonical extension contract for evlog: they can opt into
   * `enrich`, `drain`, `keep`, lifecycle hooks (`onRequestStart`, `onRequestFinish`),
   * client-log observation, and per-request logger decoration. See
   * {@link import('./shared/plugin').EvlogPlugin} for the full surface.
   *
   * Plugin drains run alongside the standalone `drain` callback (composed with
   * `Promise.allSettled`), so you can mix one-off drains and plugin-shaped
   * extensions safely.
   *
   * @example
   * ```ts
   * import { initLogger, definePlugin } from 'evlog'
   * import { createAxiomDrain } from 'evlog/axiom'
   *
   * initLogger({
   *   plugins: [
   *     definePlugin({ name: 'axiom', drain: createAxiomDrain() }),
   *   ],
   * })
   * ```
   */
  plugins?: Array<import('./shared/plugin').EvlogPlugin>
  /** @internal Suppress the "silent without drain" warning (used by hook-based frameworks like Nitro/Nuxt) */
  _suppressDrainWarning?: boolean
}

/**
 * Audit actor — who initiated the action.
 *
 * `type` covers the most common actor families. `id` is required and should be
 * a stable identifier (user id, service name, API key id, agent id). `model`,
 * `tools`, `reason`, and `promptId` are filled when `type === 'agent'` and
 * mirror the AI SDK fields already used by `evlog/ai`.
 */
/** Relative importance of an audit action for alerting and review prioritisation. */
export type AuditSeverity = 'low' | 'medium' | 'high' | 'critical'

/**
 * Static metadata for a single audit action — used by {@link defineAuditAction}
 * and each entry of {@link defineAuditCatalog}.
 */
export interface AuditActionDefinition {
  /** Default `target.type` for every audit emitted from this action. */
  target?: string
  /** Human-readable description for docs, SIEM rules, and review tooling. */
  description?: string
  /** Relative importance for alerting and review prioritisation. */
  severity?: AuditSeverity
  /** When true, callers should supply `changes` (e.g. via {@link auditDiff}). */
  requiresChanges?: boolean
  /** When true, callers should supply `reason` (especially for denials). */
  requiresReason?: boolean
  /** Default redact paths merged with {@link auditDiff} for this action. */
  redactPaths?: readonly string[]
}

export interface AuditActor {
  type: 'user' | 'system' | 'api' | 'agent'
  id: string
  displayName?: string
  email?: string
  model?: string
  tools?: string[]
  reason?: string
  promptId?: string
}

/**
 * Audit target — the resource the action was performed on.
 *
 * `type` is a free-form string (e.g. `'invoice'`, `'user'`, `'subscription'`)
 * narrowed by {@link defineAuditAction}. Additional fields are allowed for
 * resource-specific metadata (e.g. `tenantId`, `path`, `previousOwnerId`).
 */
export interface AuditTarget {
  type: string
  id: string
  [key: string]: unknown
}

/**
 * Reserved audit fields on the wide event.
 *
 * Set via `log.audit({ ... })`, `log.set({ audit: { ... } })`, or the
 * standalone `audit({ ... })` helper. Downstream filters on `audit IS NOT NULL`.
 *
 * - `outcome` — `'success' | 'failure' | 'denied'`. `'denied'` records an
 *   AuthZ-denied action (often forgotten but exactly what auditors want).
 * - `changes.before/after` — the diff for mutating actions. Use
 *   {@link auditDiff} to produce a redact-aware compact JSON Patch.
 * - `causationId` / `correlationId` — chain related actions (admin action →
 *   system reactions). Set by callers, propagated by `auditEnricher` when
 *   available on the request.
 * - `signature` / `prevHash` — populated by the {@link signed} drain wrapper.
 *   Never set by application code.
 * - `idempotencyKey` — derived deterministically by `log.audit()` so retries
 *   across drains are safe.
 * - `context` — request/runtime context auto-populated by {@link auditEnricher}
 *   (`requestId`, `traceId`, `ip`, `userAgent`, `tenantId`).
 */
/** Single JSON Patch operation for audit change tracking (RFC 6902 subset). */
export interface AuditPatchOp {
  op: 'add' | 'remove' | 'replace'
  path: string
  value?: unknown
}

/** Before/after snapshots and optional patch produced by {@link auditDiff}. */
export interface AuditChanges {
  before?: unknown
  after?: unknown
  patch?: AuditPatchOp[]
}

export interface AuditFields {
  /** Action name. Convention: `'<resource>.<verb>'`, e.g. `'invoice.refund'`. */
  action: string
  actor: AuditActor
  target?: AuditTarget
  outcome: 'success' | 'failure' | 'denied'
  /** Human-readable explanation, especially required for `outcome: 'denied'`. */
  reason?: string
  /** Before/after snapshots and optional patch from {@link auditDiff}. */
  changes?: AuditChanges
  /** ID of the action that caused this one. */
  causationId?: string
  /** ID shared by every action in the same logical operation. */
  correlationId?: string
  /** Schema version of the audit envelope. Defaults to `1` when omitted by the caller. */
  version?: number
  /** Set by `log.audit()` as a stable hash for safe retries across drains. */
  idempotencyKey?: string
  /** Request/runtime context — populated by `auditEnricher`. */
  context?: {
    requestId?: string
    traceId?: string
    ip?: string
    userAgent?: string
    tenantId?: string
    [key: string]: unknown
  }
  /** HMAC signature of the event when wrapped with `signed({ strategy: 'hmac' })`. */
  signature?: string
  /** Previous event hash when wrapped with `signed({ strategy: 'hash-chain' })`. */
  prevHash?: string
  /** Hash of the current event when wrapped with `signed({ strategy: 'hash-chain' })`. */
  hash?: string
}

/**
 * Base structure for all wide events.
 *
 * Augment via `declare module 'evlog'` to add app-specific top-level fields.
 * `audit` is reserved for {@link AuditFields}.
 */
export interface BaseWideEvent {
  timestamp: string
  level: 'info' | 'error' | 'warn' | 'debug'
  service: string
  environment: string
  version?: string
  commitHash?: string
  region?: string
  /** Request duration, human-formatted (`"12ms"`, `"1.2s"`). Set by request loggers on emit. */
  duration?: string
  /** Request duration in milliseconds. Query this one — `duration` is for humans. */
  durationMs?: number
  audit?: AuditFields
}

/**
 * Wide event with arbitrary additional fields
 */
export type WideEvent = BaseWideEvent & Record<string, unknown>

/**
 * Recursively makes all properties optional.
 * Arrays are kept as-is (not deeply partial).
 */
export type DeepPartial<T> = T extends Array<unknown>
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T

/**
 * Fields set internally by the evlog plugin (status, service, etc.).
 * These are always accepted by `set()` regardless of the user-defined field type.
 */
export interface InternalFields {
  status?: number
  service?: string
  requestLogs?: RequestLogEntry[]
  /** Label for a forked background wide event (child operation name). */
  operation?: string
  /** Parent request's `requestId` when this event was produced by `log.fork()`. */
  _parentRequestId?: string
}

/**
 * Request-scoped log entry captured during a request lifecycle.
 */
export interface RequestLogEntry {
  level: 'info' | 'warn'
  message: string
  timestamp: string
}

/**
 * Resolved context type for logger methods.
 * User fields are deeply partial (matching deep merge behavior) with internal
 * field keys omitted to avoid intersection conflicts, then internal fields
 * are added back with their canonical types.
 */
export type FieldContext<T extends object = Record<string, unknown>> =
  DeepPartial<Omit<T, keyof InternalFields>> & InternalFields

/**
 * Request-scoped logger for building wide events
 *
 * After {@link RequestLogger.emit} runs (including when head sampling drops the event),
 * the logger is **sealed**: further `set`, `error`, `info`, and `warn` calls log a
 * console warning and do not mutate the wide event. A second `emit` is ignored with
 * a warning. Use {@link RequestLogger.fork} on supported integrations for intentional
 * background work that needs its own wide event.
 *
 * `fork` is only present on request loggers from integrations that attach it (not on
 * standalone `createLogger()` instances).
 *
 * @example
 * ```ts
 * const logger = useLogger(event)
 * logger.set({ user: { id: '123' } })
 * logger.set({ cart: { items: 3 } })
 * // emit() is called automatically by the plugin
 * ```
 *
 * @example
 * ```ts
 * // With typed fields for compile-time safety
 * interface MyFields {
 *   user: { id: string; plan: string }
 *   action: string
 * }
 * const logger = useLogger<MyFields>(event)
 * logger.set({ user: { id: '123', plan: 'pro' } }) // OK
 * logger.set({ user: { id: '123' } })               // OK (deep partial)
 * logger.set({ action: 'checkout' })                 // OK
 * logger.set({ status: 200 })                        // OK (internal field)
 * logger.set({ account: '...' })                     // TS error
 * ```
 */
export interface RequestLogger<T extends object = Record<string, unknown>> {
  /**
   * Add context to the wide event. Plain objects are merged recursively.
   * When both the existing and incoming values for a key are arrays, elements are
   * concatenated (existing order preserved, new elements appended). Otherwise the
   * new value replaces the old one (including when only one side is an array).
   *
   * No-ops with a console warning after the wide event has been emitted.
   */
  set: (context: FieldContext<T>) => void

  /**
   * Set the wide event level explicitly without touching the error context.
   *
   * Use this when you want to mark an event as `error` or `warn` while
   * controlling the `error` field yourself (e.g. a typed error code without a
   * stack), or when neither `.error()` nor `.warn()` fits the situation.
   *
   * The explicit level wins over the default computation derived from
   * `.error()` / `.warn()` calls, so a later `.error()` will *not* override
   * the manual level.
   *
   * No-ops with a console warning after the wide event has been emitted.
   *
   * @example
   * ```ts
   * log.setLevel('error')
   * log.set({ error: { code: 'INVALID_INPUT' } })
   * ```
   */
  setLevel: (level: LogLevel) => void

  /**
   * Log an error and capture its details.
   *
   * No-ops with a console warning after the wide event has been emitted.
   */
  error: (error: Error | string, context?: FieldContext<T>) => void

  /**
   * Capture an informational message inside the request wide event.
   *
   * No-ops with a console warning after the wide event has been emitted.
   */
  info: (message: string, context?: FieldContext<T>) => void

  /**
   * Capture a warning message inside the request wide event.
   *
   * No-ops with a console warning after the wide event has been emitted.
   */
  warn: (message: string, context?: FieldContext<T>) => void

  /**
   * Emit the final wide event with all accumulated context.
   * Returns the emitted WideEvent, or null if the log was sampled out.
   *
   * Seals the logger: after this returns (including when the return value is `null`
   * due to sampling), further mutations are ignored with warnings.
   */
  emit: (overrides?: FieldContext<T> & { _forceKeep?: boolean }) => WideEvent | null

  /**
   * Get the current accumulated context
   */
  getContext: () => FieldContext<T> & Record<string, unknown>

  /**
   * Run async (or sync) work in a **child** request logger scope so `useLogger()`
   * resolves to the child logger while `fn` runs. The child emits its own wide event
   * when `fn` settles, with `operation` and `_parentRequestId` set for correlation.
   * Only available on integrations that attach this method (Express, Fastify, NestJS,
   * SvelteKit, React Router, Next.js `withEvlog`, Elysia — see docs).
   *
   * @param label - Value stored as `operation` on the child wide event.
   * @param fn - Function to run; may return a Promise. Errors are captured on the
   *   child logger and emitted.
   *
   * @example
   * ```ts
   * log.fork('process_order', async () => {
   *   const log = useLogger()
   *   log.set({ step: 'charged' })
   * })
   * ```
   */
  fork?: (label: string, fn: () => void | Promise<void>) => void

  /**
   * Record an audit event on this wide event. Strictly equivalent to
   * `log.set({ audit: { ... } })` plus tail-sample force-keep.
   *
   * Use `log.audit.deny(reason, fields)` for AuthZ-denied actions — most teams
   * forget to log denials but they are exactly what auditors and security teams
   * ask for.
   *
   * Available on every logger returned by `createLogger()` / `createRequestLogger()`
   * and on framework loggers exposed via `useLogger()` / `c.get('log')` etc.
   *
   * Optional on the base {@link RequestLogger} interface for structural typing;
   * always present (required) on {@link import('./audit').AuditableLogger}.
   *
   * @example
   * ```ts
   * log.audit({
   *   action: 'invoice.refund',
   *   actor: { type: 'user', id: user.id, email: user.email },
   *   target: { type: 'invoice', id: 'inv_889' },
   *   outcome: 'success',
   *   reason: 'Customer requested refund',
   * })
   * ```
   */
  audit?: AuditLoggerMethod
}

/** @internal Forward-declaration to avoid a circular import with `audit.ts`. */
export interface AuditLoggerMethod {
  (input: import('./audit').AuditInput): void
  deny: (reason: string, input: Omit<import('./audit').AuditInput, 'outcome' | 'reason'>) => void
}

/**
 * Log level type
 */
export type LogLevel = 'info' | 'error' | 'warn' | 'debug'

/**
 * Simple logging API - as easy as console.log
 *
 * @example
 * ```ts
 * log.info('auth', 'User logged in')
 * log.error({ action: 'payment', error: 'failed' })
 * ```
 */
export interface Log {
  /**
   * Log an info message or wide event
   * @example log.info('auth', 'User logged in')
   * @example log.info({ action: 'login', userId: '123' })
   */
  info(tag: string, message: string): void
  info(event: Record<string, unknown>): void

  /**
   * Log an error message or wide event
   * @example log.error('payment', 'Payment failed')
   * @example log.error({ action: 'payment', error: 'declined' })
   * @example log.error(new Error('Payment declined'))
   */
  error(tag: string, message: string): void
  error(error: Error): void
  error(event: Record<string, unknown>): void

  /**
   * Log a warning message or wide event
   * @example log.warn('api', 'Rate limit approaching')
   * @example log.warn({ action: 'api', remaining: 10 })
   */
  warn(tag: string, message: string): void
  warn(event: Record<string, unknown>): void

  /**
   * Log a debug message or wide event
   * @example log.debug('cache', 'Cache miss')
   * @example log.debug({ action: 'cache', key: 'user_123' })
   */
  debug(tag: string, message: string): void
  debug(event: Record<string, unknown>): void
}

/**
 * Module-augmentable registry of error catalogs.
 *
 * Augment via `declare module 'evlog'` so `createError({ code })`, `parseError(err).code`,
 * and any other `code` field auto-completes the union of all registered codes
 * (and still accepts ad-hoc strings via the `(string & {})` trick).
 *
 * @example
 * ```ts
 * import type { billingErrors } from '~/errors/billing'
 *
 * declare module 'evlog' {
 *   interface RegisteredErrorCatalogs {
 *     billing: typeof billingErrors
 *   }
 * }
 * ```
 */
export interface RegisteredErrorCatalogs {}

/**
 * Module-augmentable registry of audit catalogs. Same opt-in pattern as
 * {@link RegisteredErrorCatalogs}; augment to surface the union of all
 * registered audit actions on the relevant typed APIs.
 */
export interface RegisteredAuditCatalogs {}

/** @internal Extract the literal `_codes` union of a registered error catalog. */
type ExtractCatalogCodes<T> = T extends { readonly _codes: ReadonlyArray<infer C extends string> } ? C : never

/** @internal Extract the literal `_actions` union of a registered audit catalog. */
type ExtractCatalogActions<T> = T extends { readonly _actions: ReadonlyArray<infer A extends string> } ? A : never

/**
 * Union of every error code across the catalogs registered via
 * {@link RegisteredErrorCatalogs}. Resolves to `never` when no catalog is
 * registered, in which case `ErrorCode | (string & {})` collapses to `string`.
 */
export type ErrorCode = {
  [K in keyof RegisteredErrorCatalogs]: ExtractCatalogCodes<RegisteredErrorCatalogs[K]>
}[keyof RegisteredErrorCatalogs]

/**
 * Union of every audit action across the catalogs registered via
 * {@link RegisteredAuditCatalogs}. Same fallback semantics as {@link ErrorCode}.
 */
export type AuditAction = {
  [K in keyof RegisteredAuditCatalogs]: ExtractCatalogActions<RegisteredAuditCatalogs[K]>
}[keyof RegisteredAuditCatalogs]

/**
 * Error options for creating structured errors
 */
export interface ErrorOptions {
  /** What actually happened */
  message: string
  /**
   * Stable, machine-readable identifier for this error (e.g. `'PAYMENT_DECLINED'`,
   * `'auth/invalid-token'`). Surfaces in HTTP responses, `parseError`, and wide
   * events so clients can branch on `err.code` and dashboards can group by code.
   *
   * Auto-completes against {@link ErrorCode} when error catalogs are registered
   * via `declare module 'evlog'` (see {@link RegisteredErrorCatalogs}); still
   * accepts arbitrary strings for ad-hoc errors.
   */
  code?: ErrorCode | (string & {})
  /** HTTP status code (default: 500) */
  status?: number
  /** Why this error occurred */
  why?: string
  /** How to fix this issue */
  fix?: string
  /** Link to documentation or more information */
  link?: string
  /** The original error that caused this */
  cause?: Error
  /**
   * Extra payload returned to the client, merged into the response body's
   * `data` object next to `code`, `why`, `fix` and `link` (those four win on
   * a key collision). Mirrors h3's `createError({ data })`.
   *
   * For context that must never leave the server, use {@link ErrorOptions.internal}.
   */
  data?: Record<string, unknown>
  /**
   * Backend-only diagnostic context (auditing, support, debugging).
   * Never included in HTTP responses or `EvlogError#toJSON`; included in wide events when the error is passed to `log.error()`.
   */
  internal?: Record<string, unknown>
}

/**
 * Serialized `data` payload of an {@link import('./error').EvlogError} — the
 * structured guidance fields plus anything passed as `createError({ data })`.
 */
export type EvlogErrorData = Record<string, unknown> & {
  code?: string
  why?: string
  fix?: string
  link?: string
}

/**
 * Options for creating a request logger
 */
export interface RequestLoggerOptions {
  method?: string
  path?: string
  requestId?: string
  /**
   * Registers async drain work with the host runtime so it can finish after the
   * HTTP response is returned. Required on **Cloudflare Workers** (and similar
   * edge runtimes): without this, `initLogger({ drain })` + `log.emit()` may
   * never complete outbound HTTP to observability backends.
   *
   * Pass the same function you would pass to `ExecutionContext#waitUntil`, e.g.
   * `context.waitUntil.bind(context)` from a Workers `fetch` handler.
   */
  waitUntil?: (promise: Promise<unknown>) => void
}

/**
 * H3 event context with evlog logger attached
 */
export interface H3EventContext {
  log?: import('./audit').AuditableLogger
  requestId?: string
  status?: number
  /** Internal: start time for duration calculation in tail sampling */
  _evlogStartTime?: number
  /** Internal: flag to prevent double emission on errors */
  _evlogEmitted?: boolean
  /** Internal: error hook is mid-emit; blocks concurrent afterResponse/response emission */
  _evlogEmitting?: boolean
  /** Internal: whether the route matched shouldLog filtering (emit-time guard) */
  _evlogShouldEmit?: boolean
  [key: string]: unknown
}

/**
 * Server event type for Nitro/h3 handlers
 */
export interface ServerEvent {
  method: string
  path: string
  context: H3EventContext & {
    /** Cloudflare Workers context (available when deployed to CF Workers) */
    cloudflare?: {
      context: {
        waitUntil: (promise: Promise<unknown>) => void
      }
    }
    /** Vercel Edge context (available when deployed to Vercel Edge) */
    waitUntil?: (promise: Promise<unknown>) => void
  }
  node?: { res?: { statusCode?: number } }
  response?: Response
}

/**
 * Parsed evlog error with all fields at the top level
 */
export interface ParsedError {
  message: string
  status: number
  /**
   * Stable, machine-readable identifier copied from `EvlogError.code`,
   * h3-style `data.code`, or a Node-style `Error.code` (e.g. `'ENOENT'`).
   *
   * Auto-completes against {@link ErrorCode} when error catalogs are registered
   * via `declare module 'evlog'`; still typed wide enough to accept any wire string.
   */
  code?: ErrorCode | (string & {})
  why?: string
  fix?: string
  link?: string
  /**
   * The response body's `data` payload — the guidance fields plus anything the
   * server passed as `createError({ data })`.
   */
  data?: Record<string, unknown>
  raw: unknown
}
