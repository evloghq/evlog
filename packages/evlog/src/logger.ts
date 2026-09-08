import type { AuditableLogger, AuditInput, AuditMethod } from './audit'
import type { DrainContext, EnvironmentContext, FieldContext, Log, LogLevel, LoggerConfig, RequestLogger, RequestLoggerOptions, TailSamplingContext, WideEvent } from './types'
import { buildAuditFields, consumeAuditForceKeep, finalizeAudit } from './audit'
import { markGloballyRedacted, redactEvent, resolveRedactConfig } from './redact'
import type { PluginRunner } from './shared/plugin'
import { createPluginRunner, getEmptyPluginRunner } from './shared/plugin'
import { buildErrorEntries, compactStackForStorage, PRETTY_ERROR_TREE_SPACER } from './shared/pretty-error'
import { resolveDevTerminal } from './shared/dev-terminal'
import { globalConfig } from './shared/globalRegistry'
import { publishWideEvent } from './shared/wideEventChannel'
import { EvlogError } from './error'
import { colors, cssColors, detectEnvironment, elapsedMs, escapeFormatString, formatDuration, getConsoleMethod, getCssLevelColor, getLevelColor, isBrowser, isDev, isLevelEnabled, isoNow, matchesPattern } from './utils'

const nativeStdoutWrite =
  typeof process !== 'undefined' && typeof process.stdout?.write === 'function'
    ? process.stdout.write.bind(process.stdout)
    : undefined

/** Cross-bundle global slot for the native stdout write registered by captureOutput patching. */
export interface EvlogProcessOutputGlobal {
  __evlogNativeStdoutWrite?: typeof process.stdout.write
}

function writePrettyStdout(text: string): void {
  const global = globalThis as EvlogProcessOutputGlobal
  const write = global.__evlogNativeStdoutWrite ?? nativeStdoutWrite
  write?.(text)
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === 'object' && !Array.isArray(val)
}

/** Shown after post-emit warnings so users can fix fire-and-forget / ALS continuations. */
const POST_EMIT_FORK_HINT =
  'For intentional background work tied to this request, use log.fork(\'label\', fn) when your integration supports it (see https://evlog.dev).'

function warnPostEmit(method: string, detail: string): void {
  console.warn(
    `[evlog] ${method} called after the wide event was emitted — ${detail} This data will not appear in observability. ${POST_EMIT_FORK_HINT}`,
  )
}

function mergeInto(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key in source) {
    const sourceVal = source[key]
    if (sourceVal === undefined || sourceVal === null) continue
    const targetVal = target[key]
    // Same reference on both sides — recording the same error twice, which every
    // integration does when a handler logs the error it then throws. Merging an
    // object into itself changes nothing, but walking into it would write to the
    // caller's own object and throw on any read-only field it carries (#457).
    if (sourceVal === targetVal) continue
    if (isPlainObject(sourceVal) && isPlainObject(targetVal)) {
      mergeInto(targetVal, sourceVal)
    } else if (Array.isArray(targetVal) && Array.isArray(sourceVal)) {
      target[key] = [...targetVal, ...sourceVal]
    } else {
      // Context can hold objects evlog does not own; a field that refuses the
      // write must not abort the merge and lose the rest of the event.
      Reflect.set(target, key, sourceVal)
    }
  }
}

const pendingDrainState = new WeakMap<WideEvent, { drainStarted: boolean }>()

function isAiOnlyFieldUpdate(data: Record<string, unknown>): boolean {
  const keys = Object.keys(data)
  return keys.length === 1 && keys[0] === 'ai'
}

/**
 * Mark a wide event as past the post-emit AI merge window so late `log.set({ ai })`
 * calls warn again. Called by framework enrich/drain pipelines before drain runs.
 *
 * @internal Used by middleware and framework integrations.
 */
export function markWideEventDrainStarted(event: WideEvent | null): void {
  if (!event) return
  const state = pendingDrainState.get(event)
  if (state) state.drainStarted = true
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
 * and `eve` do.
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

/**
 * Check if logging is globally enabled.
 */
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
 * Error level defaults to 100% (always logged) unless explicitly configured otherwise.
 */
function shouldSample(level: LogLevel): boolean {
  const { rates } = state.sampling
  if (!rates) {
    return true // No sampling configured, log everything
  }

  // Error defaults to 100% unless explicitly set
  const percentage = level === 'error' && rates.error === undefined
    ? 100
    : rates[level] ?? 100

  // 0% = never log, 100% = always log
  if (percentage <= 0) return false
  if (percentage >= 100) return true

  return Math.random() * 100 < percentage
}

/**
 * Evaluate tail sampling conditions to determine if a log should be force-kept.
 * Returns true if ANY condition matches (OR logic).
 */
export function shouldKeep(ctx: TailSamplingContext): boolean {
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

  if (!state.silent) {
    if (state.pretty) {
      prettyPrintWideEvent(formatted)
    } else if (state.stringify) {
      console[getConsoleMethod(level)](JSON.stringify(formatted))
    } else {
      console[getConsoleMethod(level)](formatted)
    }
  }

  if (!deferDrain) {
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
      waitUntil(Promise.all(drainPromises))
    }
  }

  return formatted
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
      console.log(`${colors.dim}${timestamp}${colors.reset} ${color}[${tag}]${colors.reset} ${message}`)
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

function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(6)}`
  if (cost < 1) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(2)}`
}

interface TreeEntry {
  key: string
  value: string
  children?: string[]
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.every(item => typeof item === 'string') ? value : undefined
}

interface ToolUsageEntry {
  name: string
  durationMs: number
  success: boolean
  error?: string
}

function isToolUsageEntry(value: unknown): value is ToolUsageEntry {
  return isPlainObject(value)
    && typeof value.name === 'string'
    && typeof value.durationMs === 'number'
    && typeof value.success === 'boolean'
}

function asToolUsageArray(value: unknown): ToolUsageEntry[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.every(isToolUsageEntry) ? value : undefined
}

interface ToolCallEntry {
  name: string
  input: unknown
}

function serializeToolInput(input: unknown): string {
  if (typeof input === 'string') return input
  const seen = new WeakSet<object>()
  try {
    const serialized = JSON.stringify(input, (_key, value) => {
      if (typeof value === 'bigint') return value.toString()
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]'
        seen.add(value)
      }
      return value
    })
    return serialized ?? ''
  } catch {
    return '[unserializable tool input]'
  }
}

function isToolCallEntry(value: unknown): value is ToolCallEntry {
  return isPlainObject(value) && typeof value.name === 'string' && 'input' in value
}

function asToolCallArray(value: unknown): ToolCallEntry[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.every(isToolCallEntry) ? value : undefined
}

const CAPTURED_LINE_MAX_LENGTH = 160
const CAPTURED_MAX_LINES = 8

function asCapturedLines(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  const lines = value.split('\n').map((line) => {
    return line.length > CAPTURED_LINE_MAX_LENGTH ? `${line.slice(0, CAPTURED_LINE_MAX_LENGTH)}…` : line
  })
  if (lines.length > CAPTURED_MAX_LINES) {
    lines.length = CAPTURED_MAX_LINES
    lines.push(`+${value.split('\n').length - CAPTURED_MAX_LINES} more lines (full text in the event)`)
  }
  return lines
}

function buildAIEntries(ai: Record<string, unknown>): TreeEntry[] {
  const entries: TreeEntry[] = []

  // Header
  const headerParts: string[] = []
  if (ai.model) {
    let m = String(ai.model)
    if (ai.provider) m += ` (${ai.provider})`
    headerParts.push(m)
  }
  if (ai.calls) {
    const calls = asNumber(ai.calls)
    if (calls !== undefined) headerParts.push(`${calls} call${calls > 1 ? 's' : ''}`)
  }
  const steps = asNumber(ai.steps)
  if (steps !== undefined && steps > 1) headerParts.push(`${steps} steps`)
  entries.push({ key: 'ai', value: headerParts.join(' · ') })

  // Tokens
  const inputTokens = asNumber(ai.inputTokens)
  const outputTokens = asNumber(ai.outputTokens)
  const totalTokens = asNumber(ai.totalTokens)
  if (inputTokens !== undefined && outputTokens !== undefined) {
    let tokLine = `${inputTokens} in → ${outputTokens} out`
    if (totalTokens) tokLine += ` (${totalTokens} total)`
    const extras: string[] = []
    if (ai.cacheReadTokens) extras.push(`${ai.cacheReadTokens} cache read`)
    if (ai.cacheWriteTokens) extras.push(`${ai.cacheWriteTokens} cache write`)
    if (ai.reasoningTokens) extras.push(`${ai.reasoningTokens} reasoning`)
    if (extras.length) tokLine += ` · ${extras.join(' · ')}`
    entries.push({ key: 'ai.tokens', value: tokLine })
  }

  // Streaming
  const msFirst = asNumber(ai.msToFirstChunk)
  const msFinish = asNumber(ai.msToFinish)
  const tps = asNumber(ai.tokensPerSecond)
  if (msFirst !== undefined || msFinish !== undefined) {
    const parts: string[] = []
    if (msFirst !== undefined) parts.push(`${formatDuration(msFirst)} to first chunk`)
    if (msFinish !== undefined) parts.push(`${formatDuration(msFinish)} total`)
    let streamLine = parts.join(' → ')
    if (tps) streamLine += ` · ${tps} tok/s`
    entries.push({ key: 'ai.streaming', value: streamLine })
  }

  // Cost
  const estimatedCost = asNumber(ai.estimatedCost)
  if (estimatedCost !== undefined) {
    entries.push({ key: 'ai.cost', value: formatCost(estimatedCost) })
  }

  // Total duration
  const totalDurationMs = asNumber(ai.totalDurationMs)
  if (totalDurationMs !== undefined) {
    entries.push({ key: 'ai.totalDuration', value: formatDuration(totalDurationMs) })
  }

  // Tools — merged from toolCalls (middleware) + tools (telemetry)
  const toolCalls = Array.isArray(ai.toolCalls) ? ai.toolCalls : undefined
  const tools = asToolUsageArray(ai.tools)
  const toolCallEntries = toolCalls ? asToolCallArray(toolCalls) : undefined
  const hasInputs = toolCallEntries !== undefined && toolCallEntries.length > 0

  if (tools?.length) {
    const children = tools.map((t, idx) => {
      const mark = t.success ? '✓' : '✗'
      let line = `${t.name} ${formatDuration(t.durationMs)} ${mark}`
      if (t.error) line += ` ${t.error}`
      if (hasInputs && toolCallEntries && idx < toolCallEntries.length) {
        const tc = toolCallEntries[idx]
        const inputStr = serializeToolInput(tc.input)
        const truncated = inputStr.length > 100 ? `${inputStr.slice(0, 100)}…` : inputStr
        line += ` ${truncated}`
      }
      return line
    })
    entries.push({ key: 'ai.tools', value: '', children })
  } else if (toolCalls?.length) {
    if (toolCallEntries?.length) {
      const children = toolCallEntries.map((tc) => {
        const inputStr = serializeToolInput(tc.input)
        const truncated = inputStr.length > 100 ? `${inputStr.slice(0, 100)}…` : inputStr
        return `${tc.name}(${truncated})`
      })
      entries.push({ key: 'ai.tools', value: '', children })
    } else {
      const names = asStringArray(toolCalls)
      if (names?.length) entries.push({ key: 'ai.tools', value: names.join(', ') })
    }
  }

  // Steps
  const stepsUsage = Array.isArray(ai.stepsUsage)
    ? ai.stepsUsage.filter(isPlainObject)
    : undefined
  if (stepsUsage?.length) {
    const firstModel = stepsUsage[0]?.model
    const allSameModel = firstModel !== undefined && stepsUsage.every(s => s.model === firstModel)
    const children = stepsUsage.map((s) => {
      const prefix = allSameModel ? '' : `${String(s.model)} `
      let line = `${prefix}${s.inputTokens} in → ${s.outputTokens} out`
      const stepTools = asStringArray(s.toolCalls)
      if (stepTools?.length) line += ` [${stepTools.join(', ')}]`
      return line
    })
    entries.push({ key: 'ai.steps', value: '', children })
  } else if (steps !== undefined && steps > 1) {
    entries.push({ key: 'ai.steps', value: String(steps) })
  }

  // Captured prompt and output — one console line per message block,
  // truncated here. The full text stays in the wide event for drains.
  const promptLines = asCapturedLines(ai.prompt)
  if (promptLines) entries.push({ key: 'ai.prompt', value: '', children: promptLines })
  const outputLines = asCapturedLines(ai.output)
  if (outputLines) entries.push({ key: 'ai.output', value: '', children: outputLines })

  // Embedding
  const embedding = isPlainObject(ai.embedding) ? ai.embedding : undefined
  if (embedding) {
    const parts: string[] = []
    if (embedding.model) parts.push(String(embedding.model))
    parts.push(`${embedding.tokens} tokens`)
    if (embedding.dimensions) parts.push(`${embedding.dimensions}d`)
    if (embedding.count) parts.push(`${embedding.count} items`)
    entries.push({ key: 'ai.embedding', value: parts.join(' · ') })
  }

  if (ai.finishReason) entries.push({ key: 'ai.finishReason', value: String(ai.finishReason) })
  if (ai.error) entries.push({ key: 'ai.error', value: String(ai.error) })
  if (ai.responseId) entries.push({ key: 'ai.responseId', value: String(ai.responseId) })

  return entries
}

function flushPrettyLines(lines: string[]): void {
  if (lines.length === 0) return
  const text = `${lines.join('\n')}\n`
  if (
    nativeStdoutWrite
    && !isBrowser()
    && process.env.VITEST !== 'true'
  ) {
    writePrettyStdout(text)
    return
  }
  console.log(lines.join('\n'))
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
    parts.push(`${colors.dim}${ts}${colors.reset} ${lc}${levelLabel.toUpperCase()}${colors.reset} ${colors.cyan}[${service}]${colors.reset}`)
  }

  if (rest.method && rest.path) {
    parts.push(browser ? ` ${escapeFormatString(String(rest.method))} ${escapeFormatString(String(rest.path))}` : ` ${rest.method} ${rest.path}`)
    delete rest.method
    delete rest.path
  }

  if (rest.status) {
    const statusCode = asNumber(rest.status) ?? Number(rest.status)
    const sc = browser
      ? (statusCode >= 400 ? cssColors.red : cssColors.green)
      : (statusCode >= 400 ? colors.red : colors.green)
    if (browser) {
      parts.push(` %c${rest.status}%c`)
      styles.push(sc, cssColors.reset)
    } else {
      parts.push(` ${sc}${rest.status}${colors.reset}`)
    }
    delete rest.status
  }

  if (rest.duration) {
    if (browser) {
      parts.push(` %c${escapeFormatString(`in ${rest.duration}`)}%c`)
      styles.push(cssColors.dim, cssColors.reset)
    } else {
      parts.push(` ${colors.dim}in ${rest.duration}${colors.reset}`)
    }
    delete rest.duration
  }
  delete rest.durationMs

  writeLine(parts.join(''), ...styles)

  const aiData = isPlainObject(rest.ai) ? rest.ai : undefined
  if (aiData) {
    delete rest.ai
  }

  const errorData = rest.error
  if (errorData !== undefined) {
    delete rest.error
  }

  const restEntries = Object.entries(rest).filter(([_, v]) => v !== undefined)
  const aiEntries = aiData ? buildAIEntries(aiData) : []
  const errorEntries = errorData !== undefined
    ? buildErrorEntries(errorData, state.prettyError)
    : []
  const contextEntries: TreeEntry[] = [
    ...restEntries.map(([key, value]) => ({ key, value: formatValue(value) })),
    ...aiEntries,
  ]
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
        if (child === PRETTY_ERROR_TREE_SPACER) {
          writeLine(`  ${colors.dim}${connector}${colors.reset}`)
          continue
        }
        const isLastChild = j === children.length - 1
        const childPrefix = isLastChild ? '└─' : '├─'
        if (child === '') {
          writeLine('')
          continue
        }
        if (browser) {
          writeLine(`  %c${connector}  ${childPrefix}%c ${escapeFormatString(child)}`, cssColors.dim, cssColors.reset)
        } else if (child.startsWith(' ') || child.startsWith('\x1B')) {
          writeLine(`  ${colors.dim}${connector}${colors.reset}${child}`)
        } else {
          writeLine(`  ${colors.dim}${connector}  ${childPrefix}${colors.reset} ${child}`)
        }
      }
    }
  }

  if (!browser && lines.length > 0) {
    flushPrettyLines(lines)
  }
}

function createLogMethod(level: LogLevel) {
  return function logMethod(tagOrEvent: string | Record<string, unknown>, message?: string): void {
    if (typeof tagOrEvent === 'string' && message !== undefined) {
      emitTaggedLog(level, tagOrEvent, message)
    } else if (typeof tagOrEvent === 'object') {
      emitWideEvent(level, tagOrEvent)
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
}

export { _log as log }

const noopAudit = Object.assign(() => {}, { deny: () => {} }) as AuditMethod
/** @internal Accepts every call and emits nothing; reused wherever logging must not fail the caller. */
export const noopLogger: AuditableLogger = {
  set() {},
  setLevel() {},
  error() {},
  info() {},
  warn() {},
  emit() {
    return null
  },
  getContext() {
    return {}
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
  const waitUntil = internalOptions?.waitUntil
  const startTime = Date.now()
  const context: Record<string, unknown> = { ...initialContext }
  let hasError = false
  let hasWarn = false
  let manualLevel: LogLevel | undefined
  let emitted = false
  let pendingWideEvent: WideEvent | null = null

  function addLog(level: 'info' | 'warn', message: string): void {
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
    if (!isPlainObject(context.audit)) {
      context.audit = fields as unknown as Record<string, unknown>
    } else {
      mergeInto(context.audit as Record<string, unknown>, fields as unknown as Record<string, unknown>)
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
        const pendingState = pendingWideEvent ? pendingDrainState.get(pendingWideEvent) : undefined
        if (
          pendingWideEvent
          && pendingState
          && !pendingState.drainStarted
          && isAiOnlyFieldUpdate(record)
        ) {
          mergeInto(pendingWideEvent as Record<string, unknown>, record)
          return
        }
        const keys = Object.keys(record)
        warnPostEmit('log.set()', `Keys dropped: ${keys.length ? keys.join(', ') : '(empty)'}.`)
        return
      }
      mergeInto(context, data as Record<string, unknown>)
    },

    setLevel(level: LogLevel): void {
      if (emitted) {
        warnPostEmit('log.setLevel()', `Level dropped: ${level}.`)
        return
      }
      manualLevel = level
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
        mergeInto(context, errorContext as Record<string, unknown>)
      }

      const errorObj: Record<string, unknown> = {
        name: err.name,
        message: err.message,
        stack: isDev() ? compactStackForStorage(err.stack) : err.stack,
      }
      const errRecord = err as unknown as Record<string, unknown>
      for (const k of ['code', 'status', 'statusText', 'statusCode', 'statusMessage', 'data', 'cause', 'internal'] as const) {
        if (k in err) errorObj[k] = errRecord[k]
      }

      if (EvlogError.isEvlogError(err)) {
        if (err.code) errorObj.code = err.code
        if (err.why) errorObj.why = err.why
        if (err.fix) errorObj.fix = err.fix
        if (err.link) errorObj.link = err.link
        if (err.status) errorObj.status = err.status
      }

      if (isPlainObject(context.error)) {
        mergeInto(context.error as Record<string, unknown>, errorObj)
      } else {
        context.error = errorObj
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
        mergeInto(context, rest)
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
        mergeInto(context, rest)
      }
    },

    emit(overrides?: FieldContext<T> & { _forceKeep?: boolean }): WideEvent | null {
      if (emitted) {
        warnPostEmit('log.emit()', 'Ignoring duplicate emit.')
        return null
      }

      const durationMs = elapsedMs(startTime)
      const level: LogLevel = manualLevel ?? (hasError ? 'error' : hasWarn ? 'warn' : 'info')

      let forceKeep = false
      const auditForceKeep = consumeAuditForceKeep(context)
      if (overrides?._forceKeep) {
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
        const obj = overrides as Record<string, unknown>
        for (const key in obj) {
          if (key !== '_forceKeep') context[key] = obj[key]
        }
      }
      context.durationMs = durationMs
      context.duration = formatDuration(durationMs)

      const wide = emitWideEvent(level, context, { deferDrain, ownsEvent: true, waitUntil })
      emitted = true
      pendingWideEvent = wide
      if (wide) {
        // Only enable the AI merge window when middleware defers drain until finish.
        pendingDrainState.set(wide, { drainStarted: !deferDrain })
      }
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
  const { method, path, requestId, waitUntil: optionsWaitUntil } = options
  const initial: Record<string, unknown> = {}
  if (method !== undefined) initial.method = method
  if (path !== undefined) initial.path = path
  if (requestId !== undefined) initial.requestId = requestId
  return createLogger<T>(initial, {
    ...internalOptions,
    waitUntil: internalOptions?.waitUntil ?? optionsWaitUntil,
  })
}

/**
 * Get the current environment context.
 */
export function getEnvironment(): EnvironmentContext {
  return { ...state.env }
}

// eslint-disable-next-line @typescript-eslint/naming-convention
declare const __EVLOG_CONFIG__: import('./types').LoggerConfig | undefined

if (typeof __EVLOG_CONFIG__ !== 'undefined') initLogger(__EVLOG_CONFIG__)
