import type { AuditableLogger, AuditInput, AuditMethod, ForkableLogger } from './audit'
import type { DrainContext, EnvironmentContext, FieldContext, Log, LogLevel, LoggerConfig, RequestLogEntry, RequestLogger, RequestLoggerOptions, TailSamplingContext, WideEvent } from './types'
import { buildAuditFields, consumeAuditForceKeep, finalizeAudit } from './shared/audit-fields'
import { markGloballyRedacted, redactEvent, resolveRedactConfig } from './redact'
import type { PluginRunner } from './shared/plugin'
import { createPluginRunner, getEmptyPluginRunner } from './shared/plugin'
import { compactStackForStorage } from './shared/stack-frames'
import type { TreeEntry } from './shared/pretty-ai'
import { resolveDevTerminal } from './shared/dev-terminal'
import { globalConfig } from './shared/globalRegistry'
import { publishWideEvent } from './shared/wideEventChannel'
import { deliverPendingDrains } from './shared/shutdown'
import { createErrorSerializer } from './shared/serialize-error'
import { colors, cssColors, detectEnvironment, elapsedMs, escapeControlChars, escapeFormatString, formatDuration, formatMessage, getConsoleMethod, getCssLevelColor, getLevelColor, hasMessageSpecifiers, isBrowser, isDev, isLevelEnabled, isoNow, matchesPattern } from './utils'

const { serializeError, serializeErrorsIn } = createErrorSerializer(stack => isDev() ? compactStackForStorage(stack) : stack)

const nativeStdoutWrite =
  typeof process !== 'undefined' && typeof process.stdout?.write === 'function'
    ? process.stdout.write.bind(process.stdout)
    : undefined

/** Cross-bundle flag read by captureOutput patching. */
export interface EvlogProcessOutputGlobal {
  /** Set while evlog writes its own output, so captureOutput passes the write through. */
  __evlogOwnOutput?: boolean
}

function writeOwnOutput(write: () => void): void {
  const global = globalThis as EvlogProcessOutputGlobal
  global.__evlogOwnOutput = true
  try {
    write()
  } finally {
    global.__evlogOwnOutput = false
  }
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === 'object' && !Array.isArray(val)
}

function isPlainRecord(val: unknown): val is Record<string, unknown> {
  if (!isPlainObject(val)) return false
  const proto = Object.getPrototypeOf(val)
  return proto === Object.prototype || proto === null
}

/** Shown after post-emit warnings so users can fix fire-and-forget / ALS continuations. */
const POST_EMIT_FORK_HINT =
  'For intentional background work tied to this request, use log.fork(\'label\', fn) when your integration supports it (see https://evlog.dev).'

function warnPostEmit(method: string, detail: string): void {
  console.warn(
    `[evlog] ${method} called after the wide event was emitted — ${detail} This data will not appear in observability. ${POST_EMIT_FORK_HINT}`,
  )
}

// A plain write to `__proto__` replaces the prototype instead of storing a field.
function setField(target: Record<string, unknown>, key: string, value: unknown): void {
  if (key === '__proto__') {
    Reflect.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
  } else {
    Reflect.set(target, key, value)
  }
}

// Objects are stored by reference and copied only when a merge writes into
// them, so evlog never writes into an object the caller still holds.
function writableChild(target: Record<string, unknown>, key: string): Record<string, unknown> {
  const child = target[key] as Record<string, unknown>
  const copy: Record<string, unknown> = { ...child }
  // A spread drops a non-enumerable toJSON, the method that hides a field from
  // the serialized form. Keep it, or a second merge would expose what it hid.
  const { toJSON } = child as { toJSON?: unknown }
  if (typeof toJSON === 'function' && !Object.hasOwn(copy, 'toJSON')) {
    Object.defineProperty(copy, 'toJSON', { value: toJSON, enumerable: false, writable: true, configurable: true })
  }
  setField(target, key, copy)
  return copy
}

// A copy evlog made is a plain object nothing else holds, so a direct write is
// safe there and far cheaper than `Reflect.set`.
function storeField(target: Record<string, unknown>, key: string, value: unknown, owned: boolean): void {
  if (owned && key !== '__proto__') target[key] = value
  else setField(target, key, value)
}

function mergeInto(target: Record<string, unknown>, source: Record<string, unknown>, owned = false): void {
  for (const key in source) {
    const sourceVal = source[key]
    if (sourceVal === undefined || sourceVal === null) continue
    const targetVal = key === '__proto__' && !Object.hasOwn(target, key) ? undefined : target[key]
    // Same reference on both sides — recording the same error twice, which every
    // integration does when a handler logs the error it then throws. Merging an
    // object into itself changes nothing, but walking into it would write to the
    // caller's own object and throw on any read-only field it carries (#457).
    if (sourceVal === targetVal) continue
    // Only plain objects are merged. A class instance or a Date is a value: the
    // next one replaces it, and the caller's object is never written into.
    if (isPlainRecord(sourceVal) && isPlainRecord(targetVal)) {
      const child = writableChild(target, key)
      mergeInto(child, sourceVal, child !== targetVal)
    } else if (Array.isArray(targetVal) && Array.isArray(sourceVal)) {
      storeField(target, key, [...targetVal, ...sourceVal], owned)
    } else {
      // Context can hold objects evlog does not own; a field that refuses the
      // write must not abort the merge and lose the rest of the event.
      storeField(target, key, sourceVal, owned)
    }
  }
}

function mergeFields(target: Record<string, unknown>, fields: Record<string, unknown>): void {
  mergeInto(target, serializeErrorsIn(fields) as Record<string, unknown>, true)
}

function isAiOnlyFieldUpdate(data: Record<string, unknown>): boolean {
  const keys = Object.keys(data)
  return keys.length === 1 && keys[0] === 'gen_ai'
}

/**
 * The post-emit AI merge window of a logger created with `_deferDrain`: a late
 * `log.set({ gen_ai })` merges into the emitted event until the integration
 * that drains it sets `started`.
 *
 * @internal Used by middleware and framework integrations.
 */
export interface DrainWindow {
  started: boolean
}

/**
 * @internal Wide-event field merge — exported for test mocks that mirror emit accumulation.
 */
export { mergeInto as mergeWideEventFields }

/**
 * Process-wide configuration, shared with every other copy of evlog the package
 * manager may have installed (see `shared/globalRegistry.ts`). The reference is
 * stable, so reads stay a plain property access on the hot path.
 */
const state = globalConfig

/**
 * Initialize the logger with configuration.
 * Call this once at application startup.
 *
 * Every field is overwritten on each call, and the state is process-wide —
 * shared with any duplicate install of the same major. Last call wins, so a
 * second `initLogger()` without a `drain` clears the drain for every copy.
 * Integrations that initialize implicitly must therefore check
 * {@link isLoggerLocked} / {@link isLoggerInitialized} first, as `next/handler`
 * and `@evlog/eve` do, or pass {@link getGlobalDrain} through, as the Nitro plugins do.
 */
export function initLogger(config: LoggerConfig = {}): void {
  state.enabled = config.enabled ?? true
  const detected = detectEnvironment()

  state.env = {
    service: config.env?.service ?? detected.service ?? 'app',
    environment: config.env?.environment ?? detected.environment ?? 'development',
    version: config.env?.version ?? detected.version,
    commitHash: config.env?.commitHash ?? detected.commitHash,
    region: config.env?.region ?? detected.region,
  }

  state.pretty = config.pretty ?? isDev()
  state.prettyError = resolveDevTerminal(config).prettyError
  if (state.pretty) void loadPrettyFormatters()
  state.sampling = config.sampling ?? {}
  state.stringify = config.stringify ?? true
  state.drain = config.drain
  state.redact = resolveRedactConfig(config.redact ?? !isDev())
  state.silent = config.silent ?? false
  state.minLevel = config.minLevel ?? 'debug'
  state.pluginRunner = config.plugins?.length
    ? createPluginRunner(config.plugins)
    : getEmptyPluginRunner()

  if (state.pluginRunner.plugins.length > 0) {
    void state.pluginRunner.runSetup({ env: { ...state.env } })
  }

  const hasAnyDrain = !!state.drain || state.pluginRunner.hasDrain
  if (state.silent && !hasAnyDrain && !config._suppressDrainWarning) {
    console.warn('[evlog] silent mode is enabled but no drain is configured. Events will be built and sampled but not output anywhere. Set a drain via initLogger({ drain }) or a framework hook (evlog:drain).')
  }

  state.initialized = true
}

/**
 * @internal Get the globally registered plugin runner.
 * Used by framework middleware so plugins also fire on routes that pre-date
 * the middleware-level options.
 */
export function getGlobalPluginRunner(): PluginRunner {
  return state.pluginRunner
}

export function isEnabled(): boolean {
  return state.enabled
}

/**
 * @internal Lock the logger to prevent re-initialization.
 * Called by instrumentation register() after setting up the logger with drain.
 * Prevents configureHandler() from overwriting the drain config.
 */
export function lockLogger(): void {
  state.locked = true
}

/**
 * @internal Check if the logger has been locked by instrumentation.
 */
export function isLoggerLocked(): boolean {
  return state.locked
}

/**
 * @internal Whether {@link initLogger} has completed at least once.
 */
export function isLoggerInitialized(): boolean {
  return state.initialized
}

/**
 * @internal Get the globally configured drain callback.
 * Used by framework middleware to fall back to the global drain
 * when no middleware-level drain is provided.
 */
export function getGlobalDrain(): ((ctx: DrainContext) => void | Promise<void>) | undefined {
  return state.drain
}

/**
 * Determine if a log at the given level should be emitted based on sampling config.
 * Error defaults to 100% unless explicitly configured otherwise.
 * Trace defaults to 0% (opt-in via `sampling.rates.trace`).
 * Fatal is force-kept regardless of the sampling configuration.
 */
export function shouldSample(level: LogLevel): boolean {
  if (level === 'fatal') {
    return true
  }

  const { rates } = state.sampling
  if (!rates) {
    return level !== 'trace' // No sampling configured, log everything except trace
  }

  const percentage = level === 'error' && rates.error === undefined
    ? 100
    : level === 'trace' && rates.trace === undefined
      ? 0
      : rates[level] ?? 100

  if (percentage <= 0) return false
  if (percentage >= 100) return true

  return Math.random() * 100 < percentage
}

/**
 * Evaluate tail sampling conditions to determine if a log should be force-kept.
 * Returns true if ANY condition matches (OR logic).
 */
export function shouldKeep(ctx: Partial<TailSamplingContext>): boolean {
  const { keep } = state.sampling
  if (!keep?.length) return false

  return keep.some((condition) => {
    if (condition.status !== undefined && ctx.status !== undefined && ctx.status >= condition.status) {
      return true
    }
    if (condition.duration !== undefined && ctx.duration !== undefined && ctx.duration >= condition.duration) {
      return true
    }
    if (condition.path && ctx.path && matchesPattern(ctx.path, condition.path)) {
      return true
    }
    return false
  })
}

/**
 * Production without `initLogger()` still emits (the defaults are safe to run),
 * but the events carry no redaction, the default service/environment and no
 * drain. Warn once per process so the misconfiguration is visible instead of
 * silent; `noopLogger` stays reserved for the explicit `enabled: false`.
 */
function warnOnceUninitializedProduction(): void {
  if (state.initialized || isDev() || state.warnedUninitialized) return
  state.warnedUninitialized = true
  console.warn(
    '[evlog] running in production without initLogger(). Events are emitted with the default service and environment, without redaction, and no drain is configured so nothing reaches observability. Call initLogger({ drain }) once at startup, or wire a framework hook (evlog:drain).',
  )
}

interface EmitWideEventOptions {
  deferDrain?: boolean
  ownsEvent?: boolean
  waitUntil?: (promise: Promise<unknown>) => void
}

function emitWideEvent(
  level: LogLevel,
  event: Record<string, unknown>,
  options: EmitWideEventOptions = {},
): WideEvent | null {
  const { deferDrain = false, ownsEvent = false, waitUntil } = options
  if (!state.enabled) return null
  warnOnceUninitializedProduction()

  if (!ownsEvent) {
    if (!isLevelEnabled(level, state.minLevel)) {
      return null
    }
    if (!shouldSample(level)) {
      return null
    }
  }

  let formatted: WideEvent
  if (ownsEvent) {
    event.timestamp = isoNow()
    event.level = level
    if (event.service === undefined) event.service = state.env.service
    if (event.environment === undefined) event.environment = state.env.environment
    if (state.env.version !== undefined && event.version === undefined) event.version = state.env.version
    if (state.env.commitHash !== undefined && event.commitHash === undefined) event.commitHash = state.env.commitHash
    if (state.env.region !== undefined && event.region === undefined) event.region = state.env.region
    formatted = event as WideEvent
  } else {
    formatted = {
      timestamp: isoNow(),
      level,
      ...state.env,
      ...event,
    }
  }

  finalizeAudit(formatted)

  if (state.redact) {
    formatted = redactEvent(formatted, state.redact) as WideEvent
    markGloballyRedacted(formatted)
  }

  // A runner that defers the drain also owns the console write: it happens
  // after enrichers, so stdout carries the same event drains receive.
  if (!deferDrain) {
    outputWideEvent(formatted)
    publishWideEvent(formatted)

    const drainPromises: Array<Promise<unknown>> = []
    if (state.drain) {
      drainPromises.push(
        (async () => {
          try {
            await state.drain!({ event: formatted })
          } catch (err) {
            console.error('[evlog] drain failed:', err)
          }
        })(),
      )
    }
    if (state.pluginRunner.hasDrain) {
      drainPromises.push(state.pluginRunner.runDrain({ event: formatted }))
    }
    if (drainPromises.length > 0 && waitUntil) {
      waitUntil(Promise.all(drainPromises).then(deliverPendingDrains))
    }
  }

  return formatted
}

/**
 * Apply the global `redact` config to a wide event built outside the logger,
 * such as a client event received by the ingest endpoint. Returns the event
 * unchanged when redaction is off.
 * @internal
 */
export function redactWithGlobalConfig(event: WideEvent): WideEvent {
  if (!state.redact) return event
  const redacted = redactEvent(event, state.redact) as WideEvent
  markGloballyRedacted(redacted)
  return redacted
}

/**
 * Write an emitted wide event to the console, honoring `silent`, `pretty` and
 * `stringify`. Runners call it once enrichers have run.
 * @internal
 */
export function outputWideEvent(event: WideEvent): void {
  if (state.silent) return
  if (state.pretty) {
    printPretty(event)
  } else if (state.stringify) {
    writeOwnOutput(() => console[getConsoleMethod(event.level)](JSON.stringify(event)))
  } else {
    writeOwnOutput(() => console[getConsoleMethod(event.level)](event))
  }
}

function emitTaggedLog(level: LogLevel, tag: string, message: string): void {
  if (!state.enabled) return

  if (state.pretty && !state.silent) {
    if (!isLevelEnabled(level, state.minLevel)) {
      return
    }
    if (!shouldSample(level)) {
      return
    }

    if (isBrowser()) {
      const levelColor = getCssLevelColor(level)
      const timestamp = isoNow().slice(11, 23)
      console.log(
        `%c${timestamp}%c %c[${escapeFormatString(tag)}]%c ${escapeFormatString(message)}`,
        cssColors.dim,
        cssColors.reset,
        levelColor,
        cssColors.reset,
      )
    } else {
      const color = getLevelColor(level)
      const timestamp = isoNow().slice(11, 23)
      writeOwnOutput(() => console.log(`${colors.dim}${timestamp}${colors.reset} ${color}[${escapeControlChars(tag)}]${colors.reset} ${escapeControlChars(message)}`))
    }

    return
  }
  emitWideEvent(level, { tag, message })
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return String(value)
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value)
  }
  if (isPlainObject(value)) {
    const pairs: string[] = []
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined && v !== null) {
        if (typeof v === 'object') {
          pairs.push(`${k}=${JSON.stringify(v)}`)
        } else {
          pairs.push(`${k}=${v}`)
        }
      }
    }
    return pairs.join(' ')
  }
  return String(value)
}

/** Field and AI entries hold no colour codes of their own, so every string in them is escaped. */
function escapeTreeEntry(entry: TreeEntry): TreeEntry {
  return {
    key: escapeControlChars(entry.key),
    value: escapeControlChars(entry.value),
    children: entry.children?.map(escapeControlChars),
  }
}

function flushPrettyLines(lines: string[]): void {
  if (lines.length === 0) return
  if (
    nativeStdoutWrite
    && !isBrowser()
    && process.env.VITEST !== 'true'
  ) {
    writeOwnOutput(() => nativeStdoutWrite(`${lines.join('\n')}\n`))
    return
  }
  writeOwnOutput(() => console.log(lines.join('\n')))
}

// The error and AI sections are only needed for pretty output, so production bundles do not ship them.
let prettyFormatters: { error: typeof import('./shared/pretty-error'), ai: typeof import('./shared/pretty-ai') } | undefined
let prettyFormattersLoad: Promise<void> | undefined
let pendingPrettyEvents: WideEvent[] | undefined

/** @internal Resolves once pretty output can print error and AI sections synchronously. */
export function loadPrettyFormatters(): Promise<void> {
  prettyFormattersLoad ??= Promise.all([import('./shared/pretty-error'), import('./shared/pretty-ai')]).then(([error, ai]) => {
    prettyFormatters = { error, ai }
  })
  return prettyFormattersLoad
}

function flushPendingPrettyEvents(): void {
  const events = pendingPrettyEvents
  pendingPrettyEvents = undefined
  for (const event of events ?? []) prettyPrintWideEvent(event)
}

/**
 * Prints synchronously once the formatters are loaded. An event with an error or
 * AI section that arrives before then waits for them, and so does every event
 * behind it, to keep their order. A process that exits first still gets them,
 * with the error reduced to its message and `gen_ai` printed as a plain field.
 */
function printPretty(event: WideEvent): void {
  if (!pendingPrettyEvents && (prettyFormatters || (event.error === undefined && event.gen_ai === undefined))) {
    prettyPrintWideEvent(event)
    return
  }
  if (!pendingPrettyEvents) {
    pendingPrettyEvents = []
    void loadPrettyFormatters().then(flushPendingPrettyEvents)
    if (typeof process !== 'undefined' && typeof process.once === 'function') process.once('exit', flushPendingPrettyEvents)
  }
  pendingPrettyEvents.push(event)
}

function prettyPrintWideEvent(event: Record<string, unknown>): void {
  const { timestamp, level, service, environment, version, ...rest } = event
  const ts = typeof timestamp === 'string' ? timestamp.slice(11, 23) : ''
  const levelLabel = typeof level === 'string' ? level : 'info'
  const browser = isBrowser()
  const lines: string[] = []
  const writeLine = (...args: unknown[]) => {
    if (browser) {
      console.log(...args)
      return
    }
    const [line] = args
    if (typeof line === 'string') lines.push(line)
  }

  const parts: string[] = []
  const styles: string[] = []

  if (browser) {
    const lc = getCssLevelColor(levelLabel)
    parts.push(`%c${ts}%c %c${levelLabel.toUpperCase()}%c %c[${escapeFormatString(String(service))}]%c`)
    styles.push(cssColors.dim, cssColors.reset, lc, cssColors.reset, cssColors.cyan, cssColors.reset)
  } else {
    const lc = getLevelColor(levelLabel)
    parts.push(`${colors.dim}${ts}${colors.reset} ${lc}${levelLabel.toUpperCase()}${colors.reset} ${colors.cyan}[${escapeControlChars(String(service))}]${colors.reset}`)
  }

  if (rest.method && rest.path) {
    parts.push(browser ? ` ${escapeFormatString(String(rest.method))} ${escapeFormatString(String(rest.path))}` : ` ${escapeControlChars(String(rest.method))} ${escapeControlChars(String(rest.path))}`)
    delete rest.method
    delete rest.path
  }

  if (rest.status) {
    const statusCode = Number(rest.status)
    const sc = browser
      ? (statusCode >= 400 ? cssColors.red : cssColors.green)
      : (statusCode >= 400 ? colors.red : colors.green)
    if (browser) {
      parts.push(` %c${rest.status}%c`)
      styles.push(sc, cssColors.reset)
    } else {
      parts.push(` ${sc}${escapeControlChars(String(rest.status))}${colors.reset}`)
    }
    delete rest.status
  }

  if (rest.duration) {
    if (browser) {
      parts.push(` %c${escapeFormatString(`in ${rest.duration}`)}%c`)
      styles.push(cssColors.dim, cssColors.reset)
    } else {
      parts.push(` ${colors.dim}in ${escapeControlChars(String(rest.duration))}${colors.reset}`)
    }
    delete rest.duration
  }
  delete rest.durationMs

  writeLine(parts.join(''), ...styles)

  const aiData = prettyFormatters && isPlainObject(rest.gen_ai) ? rest.gen_ai : undefined
  if (aiData) {
    delete rest.gen_ai
  }

  const errorData = rest.error
  if (errorData !== undefined) {
    delete rest.error
  }

  const restEntries = Object.entries(rest).filter(([_, v]) => v !== undefined)
  const aiEntries = aiData && prettyFormatters ? prettyFormatters.ai.buildAIEntries(aiData) : []
  const errorEntries = errorData !== undefined && prettyFormatters
    ? prettyFormatters.error.buildErrorEntries(errorData, state.prettyError)
    : []
  const unformattedError = errorData !== undefined && !prettyFormatters
    ? [{ key: 'error', value: isPlainObject(errorData) && typeof errorData.message === 'string' ? errorData.message : formatValue(errorData) }]
    : []
  const fieldEntries: TreeEntry[] = [
    ...unformattedError,
    ...restEntries.map(([key, value]) => ({ key, value: formatValue(value) })),
    ...aiEntries,
  ]
  const contextEntries = browser ? fieldEntries : fieldEntries.map(escapeTreeEntry)
  const allEntries: TreeEntry[] = errorEntries.length > 0
    ? [...errorEntries, ...contextEntries]
    : contextEntries

  for (let i = 0; i < allEntries.length; i++) {
    const entry = allEntries[i]
    if (!entry) continue

    const { children } = entry
    const hasChildren = children !== undefined && children.length > 0
    const isLast = i === allEntries.length - 1 && !hasChildren
    const prefix = isLast ? '└─' : '├─'

    if (browser) {
      const val = entry.value ? ` ${escapeFormatString(entry.value)}` : ''
      writeLine(`  %c${prefix}%c %c${escapeFormatString(entry.key)}:%c${val}`, cssColors.dim, cssColors.reset, cssColors.cyan, cssColors.reset)
    } else {
      const val = entry.value ? ` ${entry.value}` : ''
      writeLine(`  ${colors.dim}${prefix}${colors.reset} ${colors.cyan}${entry.key}:${colors.reset}${val}`)
    }

    if (hasChildren && children) {
      const isLastEntry = i === allEntries.length - 1
      const connector = isLastEntry ? ' ' : '│'
      for (let j = 0; j < children.length; j++) {
        const child = children[j]
        if (child === undefined) continue
        const isLastChild = j === children.length - 1
        const childPrefix = isLastChild ? '└─' : '├─'
        if (child === '') {
          writeLine('')
          continue
        }
        if (browser) {
          writeLine(`  %c${connector}  ${childPrefix}%c ${escapeFormatString(child)}`, cssColors.dim, cssColors.reset)
        } else {
          writeLine(`  ${colors.dim}${connector}${colors.reset}   ${child}`)
        }
      }
    }
  }

  if (!browser && lines.length > 0) {
    flushPrettyLines(lines)
  }
}

function createLogMethod(level: LogLevel) {
  return function logMethod(tagOrEvent: string | Error | Record<string, unknown>, message?: string, ...args: unknown[]): void {
    if (typeof tagOrEvent === 'string') {
      if (message === undefined) {
        emitTaggedLog(level, 'log', formatMessage(tagOrEvent, args))
      } else if (hasMessageSpecifiers(tagOrEvent)) {
        // A specifier in the first string marks a pino-style format string,
        // not a tag: `log.info('user %s', name)` must not log the name as a tag.
        emitTaggedLog(level, 'log', formatMessage(tagOrEvent, [message, ...args]))
      } else {
        emitTaggedLog(level, tagOrEvent, formatMessage(message, args))
      }
    } else if (tagOrEvent instanceof Error) {
      emitWideEvent(level, { error: serializeError(tagOrEvent) })
    } else if (typeof tagOrEvent === 'object') {
      emitWideEvent(level, serializeErrorsIn(tagOrEvent) as Record<string, unknown>)
    } else {
      emitTaggedLog(level, 'log', String(tagOrEvent))
    }
  }
}

/**
 * Simple logging API - as easy as console.log
 *
 * @example
 * ```ts
 * log.info('auth', 'User logged in')
 * log.error({ action: 'payment', error: 'failed' })
 * ```
 */
const _log: Log = {
  info: createLogMethod('info'),
  error: createLogMethod('error'),
  warn: createLogMethod('warn'),
  debug: createLogMethod('debug'),
  fatal: createLogMethod('fatal'),
  trace: createLogMethod('trace'),
}

export { _log as log }

/**
 * Drop-in default export for projects migrating from pino or consola:
 * `import logger from 'evlog'` prints immediately, with no `initLogger()` call.
 *
 * This is the bare {@link log} API, not a `createLogger` scope: every call
 * outputs right away and there is no accumulation or `emit()`. For wide events
 * with drains and sampling, keep `initLogger()` + `createLogger()`.
 */
export default _log

const noopAudit = Object.assign(() => {}, { deny: () => {} }) as AuditMethod
/**
 * @internal Accepts every call and emits nothing; reused wherever logging must not fail the caller.
 * `fork` still runs `fn`, because the work belongs to the caller, not to the log. With no wide
 * event to record a failure, `fork` reports it on the console and resolves, as `log.fork()` never rejects.
 */
export const noopLogger: ForkableLogger = {
  set() {},
  setLevel() {},
  discard() {},
  error() {},
  fatal() {},
  info() {},
  warn() {},
  debug() {},
  trace() {},
  emit() {
    return null
  },
  getContext() {
    return {}
  },
  fork(label, fn) {
    return Promise.resolve().then(fn).then(() => {}, (err: unknown) => {
      console.error(`[evlog] log.fork() work "${label}" failed:`, err)
    })
  },
  audit: noopAudit,
}

/**
 * @internal Options for createLogger that are not part of the public API.
 */
interface CreateLoggerInternalOptions {
  /**
   * When true, the global drain is skipped on emit.
   * Used by framework middleware that runs its own enrich+drain pipeline.
   */
  _deferDrain?: boolean
  /** Shared with the integration that drains the event; only read when `_deferDrain` is set. */
  _drainWindow?: DrainWindow
  /**
   * @see {@link RequestLoggerOptions.waitUntil}
   */
  waitUntil?: (promise: Promise<unknown>) => void
}

/**
 * Create a scoped logger for building wide events.
 * Use this for any context: workflows, jobs, scripts, queues, etc.
 *
 * After `emit()` (including when sampling returns `null`), the logger is sealed and
 * further mutations log `[evlog]` warnings. Standalone loggers do not have `fork`;
 * that method is only attached by supported framework integrations.
 *
 * @example
 * ```ts
 * const log = createLogger({ jobId: job.id, queue: 'emails' })
 * log.set({ batch: { size: 50, processed: 12 } })
 * log.emit()
 * ```
 */
export function createLogger<T extends object = Record<string, unknown>>(initialContext: Record<string, unknown> = {}, internalOptions?: CreateLoggerInternalOptions): AuditableLogger<T> {
  if (!state.enabled) return noopLogger as unknown as AuditableLogger<T>

  const deferDrain = internalOptions?._deferDrain ?? false
  const drainWindow = deferDrain ? internalOptions?._drainWindow ?? { started: false } : undefined
  const waitUntil = internalOptions?.waitUntil
  const startTime = Date.now()
  const context: Record<string, unknown> = { ...(serializeErrorsIn(initialContext) as Record<string, unknown>) }
  let hasError = false
  /** The fields the last error() call wrote into `error`, which the next call replaces. */
  let loggedErrorKeys: readonly string[] = []
  let hasFatal = false
  let hasWarn = false
  let manualLevel: LogLevel | undefined
  let discarded = false
  let emitted = false
  let pendingWideEvent: WideEvent | null = null

  function addLog(level: RequestLogEntry['level'], message: string): void {
    if (!Array.isArray(context.requestLogs)) {
      context.requestLogs = []
    }
    (context.requestLogs as unknown[]).push({
      level,
      message,
      timestamp: isoNow(),
    })
  }

  const auditMethod = function audit(input: AuditInput): void {
    if (emitted) {
      warnPostEmit('log.audit()', `Audit dropped: action=${input.action}.`)
      return
    }
    const fields = buildAuditFields(input)
    if (!isPlainRecord(context.audit)) {
      context.audit = fields as unknown as Record<string, unknown>
    } else {
      mergeInto(writableChild(context, 'audit'), fields as unknown as Record<string, unknown>)
    }
    context._auditForceKeep = true
  } as AuditMethod<T>

  auditMethod.deny = function deny(reason: string, input: Omit<AuditInput, 'outcome' | 'reason'>): void {
    auditMethod({ ...input, outcome: 'denied', reason })
  }

  return {
    audit: auditMethod,
    set(data: FieldContext<T>): void {
      if (emitted) {
        const record = data as Record<string, unknown>
        if (
          pendingWideEvent
          && drainWindow
          && !drainWindow.started
          && isAiOnlyFieldUpdate(record)
        ) {
          mergeInto(pendingWideEvent as Record<string, unknown>, record)
          return
        }
        const keys = Object.keys(record)
        warnPostEmit('log.set()', `Keys dropped: ${keys.length ? keys.join(', ') : '(empty)'}.`)
        return
      }
      mergeFields(context, data as Record<string, unknown>)
    },

    setLevel(level: LogLevel): void {
      if (emitted) {
        warnPostEmit('log.setLevel()', `Level dropped: ${level}.`)
        return
      }
      manualLevel = level
    },

    discard(): void {
      if (emitted) {
        warnPostEmit('log.discard()', 'Ignoring discard.')
        return
      }
      discarded = true
    },

    error(error: Error | string, errorContext?: FieldContext<T>): void {
      if (emitted) {
        const keys = errorContext
          ? [...Object.keys(errorContext as Record<string, unknown>), 'error']
          : ['error']
        warnPostEmit('log.error()', `Keys dropped: ${keys.join(', ')}.`)
        return
      }
      hasError = true
      const err = typeof error === 'string' ? new Error(error) : error

      if (errorContext) {
        mergeFields(context, errorContext as Record<string, unknown>)
      }

      const errorObj = serializeError(err)

      if (isPlainRecord(context.error)) {
        const target = writableChild(context, 'error')
        for (const key of loggedErrorKeys) delete target[key]
        mergeInto(target, errorObj)
      } else {
        context.error = errorObj
      }
      loggedErrorKeys = Object.keys(errorObj)
    },

    fatal(message: string, fatalContext?: FieldContext<T>): void {
      if (emitted) {
        const keys = fatalContext
          ? ['message', ...Object.keys(fatalContext as Record<string, unknown>).filter(k => k !== 'requestLogs')]
          : ['message']
        warnPostEmit('log.fatal()', `Keys dropped: ${keys.join(', ')}.`)
        return
      }
      hasFatal = true
      addLog('fatal', message)
      if (fatalContext) {
        const { requestLogs: _, ...rest } = fatalContext as Record<string, unknown>
        mergeFields(context, rest)
      }
    },

    info(message: string, infoContext?: FieldContext<T>): void {
      if (emitted) {
        const keys = infoContext
          ? ['message', ...Object.keys(infoContext as Record<string, unknown>).filter(k => k !== 'requestLogs')]
          : ['message']
        warnPostEmit('log.info()', `Keys dropped: ${keys.join(', ')}.`)
        return
      }
      addLog('info', message)
      if (infoContext) {
        const { requestLogs: _, ...rest } = infoContext as Record<string, unknown>
        mergeFields(context, rest)
      }
    },

    warn(message: string, warnContext?: FieldContext<T>): void {
      if (emitted) {
        const keys = warnContext
          ? ['message', ...Object.keys(warnContext as Record<string, unknown>).filter(k => k !== 'requestLogs')]
          : ['message']
        warnPostEmit('log.warn()', `Keys dropped: ${keys.join(', ')}.`)
        return
      }
      hasWarn = true
      addLog('warn', message)
      if (warnContext) {
        const { requestLogs: _, ...rest } = warnContext as Record<string, unknown>
        mergeFields(context, rest)
      }
    },

    debug(message: string, debugContext?: FieldContext<T>): void {
      if (emitted) {
        const keys = debugContext
          ? ['message', ...Object.keys(debugContext as Record<string, unknown>).filter(k => k !== 'requestLogs')]
          : ['message']
        warnPostEmit('log.debug()', `Keys dropped: ${keys.join(', ')}.`)
        return
      }
      addLog('debug', message)
      if (debugContext) {
        const { requestLogs: _, ...rest } = debugContext as Record<string, unknown>
        mergeFields(context, rest)
      }
    },

    trace(message: string, traceContext?: FieldContext<T>): void {
      if (emitted) {
        const keys = traceContext
          ? ['message', ...Object.keys(traceContext as Record<string, unknown>).filter(k => k !== 'requestLogs')]
          : ['message']
        warnPostEmit('log.trace()', `Keys dropped: ${keys.join(', ')}.`)
        return
      }
      addLog('trace', message)
      if (traceContext) {
        const { requestLogs: _, ...rest } = traceContext as Record<string, unknown>
        mergeFields(context, rest)
      }
    },

    emit(overrides?: FieldContext<T> & { _forceKeep?: boolean, _durationMs?: number }): WideEvent | null {
      if (emitted) {
        warnPostEmit('log.emit()', 'Ignoring duplicate emit.')
        return null
      }

      const durationMs = overrides?._durationMs ?? elapsedMs(startTime)
      const level: LogLevel = manualLevel ?? (hasFatal ? 'fatal' : hasError ? 'error' : hasWarn ? 'warn' : 'info')

      // Audit records are compliance evidence and stay force-kept, so read the
      // flag before discard decides whether the event is dropped.
      const auditForceKeep = consumeAuditForceKeep(context)
      if (discarded && !auditForceKeep && !hasError && !hasFatal && manualLevel !== 'error' && manualLevel !== 'fatal') {
        emitted = true
        pendingWideEvent = null
        return null
      }

      // error and fatal are checked by level, not through the floor, so an untyped floor ('WARN', 'fatal') cannot drop them.
      const floor = state.sampling.minLevel
      if (!auditForceKeep && level !== 'error' && level !== 'fatal' && floor && !isLevelEnabled(level, floor)) {
        emitted = true
        pendingWideEvent = null
        return null
      }

      let forceKeep = false
      if (discarded || overrides?._forceKeep) {
        forceKeep = true
      } else if (auditForceKeep) {
        forceKeep = true
      } else if (state.sampling.keep?.length) {
        const status = (overrides as Record<string, unknown> | undefined)?.status ?? context.status
        forceKeep = shouldKeep({
          status: status as number | undefined,
          duration: durationMs,
          path: context.path as string | undefined,
          method: context.method as string | undefined,
          context,
        })
      }

      if (!forceKeep && !shouldSample(level)) {
        emitted = true
        pendingWideEvent = null
        return null
      }

      if (overrides) {
        const obj = serializeErrorsIn(overrides) as Record<string, unknown>
        for (const key in obj) {
          if (key !== '_forceKeep' && key !== '_durationMs') context[key] = obj[key]
        }
      }
      context.durationMs = durationMs
      context.duration = formatDuration(durationMs)

      const wide = emitWideEvent(level, context, { deferDrain, ownsEvent: true, waitUntil })
      emitted = true
      pendingWideEvent = wide
      return wide
    },

    getContext(): FieldContext<T> & Record<string, unknown> {
      return { ...context } as FieldContext<T> & Record<string, unknown>
    },
  }
}

/**
 * Create a request-scoped logger for building wide events.
 * Convenience wrapper around `createLogger` that pre-populates HTTP request fields.
 *
 * @example
 * ```ts
 * const log = createRequestLogger({ method: 'POST', path: '/checkout' })
 * log.set({ user: { id: '123' } })
 * log.set({ cart: { items: 3 } })
 * log.emit()
 * ```
 *
 * @example Cloudflare Workers — pass `waitUntil` so `initLogger({ drain })` completes after the response:
 * ```ts
 * export default {
 *   async fetch(request, env, ctx) {
 *     const log = createRequestLogger({
 *       method: request.method,
 *       path: new URL(request.url).pathname,
 *       waitUntil: ctx.waitUntil.bind(ctx),
 *     })
 *     log.emit()
 *     return new Response('ok')
 *   },
 * }
 * ```
 */
export function createRequestLogger<T extends object = Record<string, unknown>>(options: RequestLoggerOptions = {}, internalOptions?: CreateLoggerInternalOptions): AuditableLogger<T> {
  const { method, path, requestId, operation, waitUntil: optionsWaitUntil } = options
  const initial: Record<string, unknown> = {}
  if (method !== undefined) initial.method = method
  if (path !== undefined) initial.path = path
  if (requestId !== undefined) initial.requestId = requestId
  if (operation !== undefined) initial.operation = operation
  return createLogger<T>(initial, {
    ...internalOptions,
    waitUntil: internalOptions?.waitUntil ?? optionsWaitUntil,
  })
}

export function getEnvironment(): EnvironmentContext {
  return { ...state.env }
}

// eslint-disable-next-line @typescript-eslint/naming-convention
declare const __EVLOG_CONFIG__: import('./types').LoggerConfig | undefined

if (typeof __EVLOG_CONFIG__ !== 'undefined') initLogger(__EVLOG_CONFIG__)
