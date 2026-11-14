/**
 * Outcome of a single tool run captured by {@link createTelemetry}.
 */
export type RunOutcome = 'success' | 'error'

/**
 * Tool identity attached to every telemetry run event.
 */
export interface ToolInfo {
  name: string
  version: string
}

/**
 * Environment snapshot enriched via `std-env` (+ deploy stage).
 */
export interface EnvInfo {
  node: string
  ci: boolean
  provider: string | null
  tty: boolean
  agent: string | null
  /** Operating system platform (`darwin` | `linux` | `win32`, …) — `null` when unknown. */
  os: string | null
  /** CPU architecture (`arm64` | `x64`, …) — `null` when unknown. */
  arch: string | null
  /**
   * Deploy / runtime stage: `development` | `preview` | `production` (or custom).
   * From `EVLOG_TELEMETRY_ENV` → `VERCEL_ENV` → {@link TelemetryOptions.environment} → `NODE_ENV` → `development`.
   */
  environment: string
}

/**
 * Standard wide-event envelope for one CLI/tool run.
 * Defined by @evlog/telemetry — consumers only extend `custom` via {@link telemetry.set}.
 */
export interface RunEvent {
  event: 'run'
  command: string
  durationMs: number
  outcome: RunOutcome
  errorCode?: string
  flags: Record<string, boolean | number | string>
  tool: ToolInfo
  env: EnvInfo
  machineId?: string
  custom: Record<string, boolean | number | string>
  idempotencyKey: string
  timestamp: string
}

/**
 * A command's declared arguments, reduced to what flag sanitization needs.
 *
 * Structural on purpose — citty's `ArgsDef` satisfies it, and so does any other
 * parser's definition, without `@evlog/telemetry` taking a dependency on one.
 */
export type FlagDefinitions = Record<string, { type?: string, default?: unknown } | undefined>

/** Allowlisted string flag values declared via `collect.flags`. */
export type CollectFlags = Record<string, readonly string[]>

/** Allowlisted string custom fields declared via `collect.fields`. */
export type CollectFields = Record<string, readonly string[]>

/**
 * Optional collection declaration — inline, no separate config file.
 * Closed sets only; undeclared string values become presence-only at runtime.
 */
export interface CollectConfig<
  TFlags extends CollectFlags = {},
  TFields extends CollectFields = {},
> {
  flags?: TFlags
  fields?: TFields
}

/**
 * Options passed to {@link createTelemetry} and {@link withTelemetry}.
 */
export interface TelemetryOptions<
  TFlags extends CollectFlags = {},
  TFields extends CollectFields = {},
> {
  /** Telemetry tool name, e.g. `evlog-cli`. Used for config dir and disclosure. */
  name: string
  /**
   * The command people type to run the tool, when it is not `name`: `evlog`
   * for the tool `evlog-cli`. The first-run notice prints it in
   * `<bin> telemetry disable`.
   */
  bin?: string
  /** Tool version string. */
  version: string
  /**
   * Override `env.environment` on every run event.
   * Useful when the tool knows its own stage (e.g. packaged CLI → `production`).
   */
  environment?: string
  /** Default ingestion endpoint baked in by the author. Overridable via `EVLOG_TELEMETRY_ENDPOINT`. */
  endpoint?: string
  /** Optional allowlists for string flags and custom fields. */
  collect?: CollectConfig<TFlags, TFields>
  /** Hard cap (ms) for {@link TelemetryHandle.flush}. Default: 500. */
  flushTimeoutMs?: number
  /**
   * Idle time after a successful flush before {@link TelemetryHandle.run} POSTs again.
   * `run()` still writes every event to disk; it POSTs when this window has
   * elapsed, or sooner when the outbox has reached {@link TelemetryOptions.flushThreshold}.
   * {@link TelemetryHandle.flush} sends immediately.
   * Default: 15 minutes (60 minutes when `std-env` reports CI).
   * Override with `EVLOG_TELEMETRY_FLUSH_INTERVAL_MS` (`0` POSTs on every run).
   */
  flushIntervalMs?: number
  /**
   * Outbox size that forces a flush from {@link TelemetryHandle.run} even inside
   * the coalescing window. Default: 20. Capped at 50 (ingest `maxBatchSize`).
   * Override with `EVLOG_TELEMETRY_FLUSH_THRESHOLD`.
   */
  flushThreshold?: number
  /** Max outbox file size in bytes before oldest events are dropped. Default: 1 MiB. */
  maxBufferBytes?: number
  /** Max age (ms) for buffered events. Default: 30 days. */
  maxEventAgeMs?: number
  /**
   * Sampling rate 0–1. Declared for future use — v1 always records.
   * @internal Not implemented in v1.
   */
  sampling?: number
}

type CustomFieldValue<T extends readonly string[] | undefined> =
  T extends readonly string[] ? boolean | number | T[number] : boolean | number

/**
 * Custom fields accepted by {@link telemetry.set} — numbers and booleans always;
 * strings only when declared in `collect.fields` (enforced at runtime).
 *
 * When `collect.fields` is non-empty, only declared keys accept allowlisted strings.
 * Add undeclared counters with a second `set()` call or the ambient {@link telemetry.set}.
 */
export type CustomFields<TFields extends CollectFields = {}> =
  keyof TFields extends never
    ? Record<string, boolean | number | undefined>
    : { [K in keyof TFields]?: CustomFieldValue<TFields[K]> }

/** Error shape recognised for automatic `errorCode` capture. */
export interface TelemetryCliError {
  code: string
  message?: string
}

/**
 * Handle returned by {@link createTelemetry}.
 */
export interface TelemetryHandle<
  TFlags extends CollectFlags = {},
  TFields extends CollectFields = {},
> {
  /** Run an async unit of work as a single telemetry event. */
  run: <T>(
    command: string,
    fn: () => T | Promise<T>,
    opts?: {
      flags?: Record<string, unknown>
      /**
       * Declared args for `flags`. With them, only declared flags are
       * recorded, and defaults are not reported as choices.
       */
      args?: FlagDefinitions
      systemCustom?: Record<string, string>
    },
  ) => Promise<T>
  /** Flush buffered events now, ignoring the coalescing window. Never throws. */
  flush: () => Promise<void>
  /** Whether telemetry is active (consent granted). */
  enabled: boolean
  /**
   * Set custom fields for the active run.
   * Prefer this over the ambient {@link telemetry.set} for allowlisted string autocomplete.
   */
  set: (fields: CustomFields<TFields>) => void
}

/** @internal Mutable run context stored in ALS during `run()`. */
export interface RunContext {
  custom: Record<string, boolean | number | string>
  collect?: CollectConfig
}
