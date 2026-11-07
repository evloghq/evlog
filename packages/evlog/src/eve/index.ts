import { AsyncLocalStorage } from 'node:async_hooks'
import { defineHook, type HookContext, type HookDefinition } from 'eve/hooks'
import {
  defineInstrumentation,
  type InstrumentationDefinition,
  type InstrumentationEvents,
  type InstrumentationSetupContext,
} from 'eve/instrumentation'
import type { AuditableLogger } from '../audit'
import type { AIToolExecution, AIEventData, ModelCost } from '../ai/index'
import { initLogger, isLoggerInitialized, isLoggerLocked, noopLogger } from '../logger'
import type { LoggerConfig } from '../types'
import type { EvlogConfig } from '../shared/define'
import { toLoggerConfig } from '../shared/define'
import type { BaseEvlogOptions, MiddlewareLoggerOptions } from '../shared/middleware'
import { createMiddlewareLogger, pickBaseEvlogOptions } from '../shared/middleware'
import {
  bindAsyncLocalStorage,
  clearAsyncLocalStorage,
  createSharedEnterWithStorage,
} from '../shared/asyncStorageScope'
import { warnDeprecated } from '../shared/deprecate'

const DEFAULT_MAX_SESSIONS = 256

/** Client-closed-request status used for turns eve cancelled before a terminal outcome. */
const CANCELLED_STATUS = 499

/**
 * How much of the user message reaches the wide event, from `delivery.consumed`
 * (`message.received` before eve 0.84).
 *
 * - `omit` — no message content at all (default)
 * - `preview` — text truncated to `messagePreviewLength`, attachments reduced
 *   to their type and media type
 * - `full` — text and attachment parts verbatim
 */
export type EveMessageMode = 'omit' | 'preview' | 'full'

/**
 * Options for {@link defineEvlogHook}: every runtime setting of
 * `evlog.config.ts`, plus the eve-specific ones below. The logger settings
 * (`service`, `environment`, `sampling`, `silent`, `drain`, `plugins`...)
 * initialise the logger on the first hook invocation, so out-of-turn events
 * reach the same drain as turns. `map` and `logs` are CLI-only and not
 * accepted here.
 */
export interface EvlogEveOptions extends Omit<EvlogConfig, 'extends' | 'map' | 'logs'> {
  /**
   * Passed to {@link initLogger} as is on the first hook invocation, in place
   * of the logger settings above. Use it to give out-of-turn events their own
   * drain or service.
   */
  init?: LoggerConfig
  /**
   * How much of the user message to record. Default `'omit'`.
   *
   * `'full'` records message text and attachment parts as sent — review your
   * PII policy before enabling it.
   */
  message?: EveMessageMode
  /** Max characters kept in `'preview'` mode. Default `500`. */
  messagePreviewLength?: number
  /**
   * @deprecated Removed in evlog v3. Use {@link EvlogEveOptions.message}.
   * `true` maps to `'omit'`, `false` to `'preview'`.
   */
  redactMessage?: boolean
  /**
   * Pricing map for {@link AIEventData.estimatedCost}. Keys are model IDs,
   * values are dollars per 1M tokens — same shape as `evlog/ai`.
   *
   * Only used as a fallback: when eve reports `usage.costUsd`, that value is
   * recorded as `ai.costUsd` instead.
   */
  cost?: Record<string, ModelCost>
  /**
   * Model ID used with `cost` when eve stream events do not expose the model
   * name. When `cost` has exactly one entry, that key is used automatically.
   *
   * Only used as a fallback: `session.started` reports the configured model,
   * which is used when this is unset.
   */
  model?: string
  /**
   * Max in-memory sessions for context carry-over and approval state.
   * Oldest sessions are evicted when exceeded. Default `256`.
   */
  maxSessions?: number
  /**
   * Emit one extra wide event per session when it ends (`session.ended`, or
   * `session.completed` / `session.failed` before eve 0.84), rolling up every
   * turn of that session. Default `false`.
   */
  sessionEvent?: boolean
  /**
   * Turn-scoped enrichment, run once when the turn logger is created, with
   * the eve session in scope. Unlike the HTTP-shaped {@link BaseEvlogOptions.enrich}
   * `enrich` (which never sees the eve session), it can read
   * `ctx.session.auth` and the session lineage. Return the fields to merge
   * onto the turn event; they merge over the built-in `eve`, `agent`, and
   * `channel` fields and stay turn-scoped: they are not carried across turns
   * of the same session.
   *
   * @example
   * ```ts
   * export default defineEvlogHook({
   *   enrichTurn: (ctx) => ({
   *     caller: ctx.session.auth.current?.principalId,
   *   }),
   * })
   * ```
   */
  enrichTurn?: (ctx: EveEnrichTurnContext) => Record<string, unknown> | void
  /**
   * Subscribe to the `subagent.*` lifecycle events emitted by older eve
   * versions and add them to the parent turn. Default `true`. Disable this
   * when the event source has no hook session context. Subagent calls
   * requested through `call.requested` (`actions.requested` before eve 0.84)
   * are recorded either way.
   */
  subagentEvents?: boolean
}

/** Minimal session shape accepted by {@link useLogger} as a fallback lookup key. */
export interface EveTurnSessionContext {
  readonly session: {
    readonly id: string
    readonly turn?: { readonly id?: string }
  }
}

/** Context handed to {@link EvlogEveOptions.enrichTurn} for one turn. */
export interface EveEnrichTurnContext {
  readonly session: HookContext['session']
  readonly agent: HookContext['agent']
  readonly channel: HookContext['channel']
}

interface PendingAction {
  toolName: string
  startedAt: number
  turnId: string
}

interface EveApprovalPending {
  toolName: string
  callId: string
}

/** A v27 request for a person's input, kept open until its `interaction.settled`. */
interface OpenInteraction {
  kind: string
  /** The tool an approval is for, or the connection a sign-in is for. */
  name: string
  startedAt: number
}

interface SessionRollup {
  turnCount: number
  lastAccess: number
  calls: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  estimatedCost: number
  tools: Set<string>
  compactions: number
  authorizations: number
  failedTurns: number
  cancelledTurns: number
}

/** Identity of the eve instance serving a session, from `session.started`. */
interface EveRuntimeInfo {
  version?: string
  agentId?: string
  model?: string
  gitSha?: string
  gitBranch?: string
  deployedAt?: string
  subagent?: string
}

interface EveSubagentRecord {
  callId: string
  name: string
  toolName?: string
  childSessionId?: string
  remote?: true
  status: 'called' | 'started' | 'completed' | 'failed'
  output?: string
  error?: string
  startedAt?: number
  durationMs?: number
}

interface EveAuthorizationRecord {
  name: string
  outcome?: string
  reason?: string
  durationMs?: number
}

interface EveStepFailure {
  code: string
  message: string
  stepIndex: number
}

interface TurnAccumulator {
  calls: number
  steps: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUsd: number
  finishReason?: string
  toolExecutions: AIToolExecution[]
  subagents: EveSubagentRecord[]
  authorizations: EveAuthorizationRecord[]
  stepFailures: EveStepFailure[]
  compactions: number
  compactionsRequested: number
  compactionModel?: string
  compactionInputTokens?: number
  contextCleared: boolean
  reasoningBlocks: number
  reasoningChars: number
  response?: string
  responseChars: number
  result?: unknown
  pausedForInput: boolean
  stepStartedAt?: number
  /** Model of the latest step, so a gateway fallback is reported over the configured model. */
  stepModel?: string
  costMap?: Record<string, ModelCost>
  /**
   * The resolved provider (deployment) that served the model call.
   * Populated at turn end from the session model slug, or set directly
   * when eve reports the provider per-step.
   */
  lastProvider?: string
  costModel?: string
  /** Cumulative input tokens of the most recent completed model step, the baseline for per-tool attribution. */
  lastStepInputTokens?: number
  /** Tools whose results were fed to the model since the last step, awaiting input-token attribution. */
  pendingToolAttribution: AIToolExecution[]
}

interface TurnState {
  logger: AuditableLogger
  finish: (opts?: { status?: number; error?: Error }) => Promise<unknown>
  middlewareOptions: MiddlewareLoggerOptions
  accumulator: TurnAccumulator
  sessionId: string
  turnId: string
  /** Top-level keys enrichTurn wrote, kept out of the session snapshot. */
  enrichTurnKeys: Set<string>
}

/** Top-level wide-event keys that stay turn-scoped and are not carried across turns. */
const TURN_ONLY_KEYS = new Set([
  'eve',
  'ai',
  'message',
  'method',
  'path',
  'status',
  'duration',
  'durationMs',
  'level',
  'error',
  'agent',
  'channel',
  'approval',
  'audit',
  'requestId',
  'service',
  'timestamp',
  'traceId',
  'spanId',
])

/**
 * Globally unique id for one turn. eve numbers turns within a session, so
 * `turn_0` is the first turn of *every* session and cannot correlate anything
 * on its own.
 */
function turnKey(sessionId: string, turnId: string): string {
  return `${sessionId}:${turnId}`
}

function freshAccumulator(options: EvlogEveOptions): TurnAccumulator {
  return {
    calls: 0,
    steps: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    toolExecutions: [],
    subagents: [],
    authorizations: [],
    stepFailures: [],
    compactions: 0,
    compactionsRequested: 0,
    contextCleared: false,
    reasoningBlocks: 0,
    reasoningChars: 0,
    responseChars: 0,
    pausedForInput: false,
    pendingToolAttribution: [],
    costMap: options.cost,
    costModel: resolveCostModel(options),
  }
}

function resolveCostModel(options: EvlogEveOptions): string | undefined {
  if (options.model) return options.model
  const keys = options.cost ? Object.keys(options.cost) : []
  if (keys.length === 1) return keys[0]
  return undefined
}

function roundCost(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function computeEstimatedCost(state: TurnAccumulator): number | undefined {
  if (!state.costMap || !state.costModel) return undefined
  const pricing = state.costMap[state.costModel]
  if (!pricing) return undefined
  const inputCost = (state.inputTokens / 1_000_000) * pricing.input
  const outputCost = (state.outputTokens / 1_000_000) * pricing.output
  const total = inputCost + outputCost
  return total > 0 ? Math.round(total * 1_000_000) / 1_000_000 : undefined
}

/**
 * Attribute the input a model step consumed as a delta over the previous step
 * to the tool results that returned in between. A step delta is split evenly
 * across tools that ran in parallel, so a single dominant result is reported
 * in full.
 */
function attributeToolInputTokens(acc: TurnAccumulator, inputTokens: number): void {
  if (acc.lastStepInputTokens === undefined) {
    // A compaction or context clear reset the baseline; re-base and drop the
    // results whose contribution left the linear context.
    acc.pendingToolAttribution = []
    acc.lastStepInputTokens = inputTokens
    return
  }
  if (acc.pendingToolAttribution.length > 0) {
    const delta = Math.max(0, inputTokens - acc.lastStepInputTokens)
    const each = Math.round(delta / acc.pendingToolAttribution.length)
    for (const tool of acc.pendingToolAttribution) tool.inputTokens = each
    acc.pendingToolAttribution = []
  }
  acc.lastStepInputTokens = inputTokens
}

function buildAiField(state: TurnAccumulator): AIEventData {
  const totalTokens = state.inputTokens + state.outputTokens
  const data: AIEventData = {
    calls: state.calls,
    inputTokens: state.inputTokens,
    outputTokens: state.outputTokens,
    totalTokens,
    steps: state.steps,
  }
  const model = state.stepModel ?? state.costModel
  if (model) data.model = model
  if (state.lastProvider) data.provider = state.lastProvider
  if (state.cacheReadTokens > 0) data.cacheReadTokens = state.cacheReadTokens
  if (state.cacheWriteTokens > 0) data.cacheWriteTokens = state.cacheWriteTokens
  if (state.finishReason) data.finishReason = state.finishReason
  if (state.costUsd > 0) {
    data.costUsd = roundCost(state.costUsd)
  } else {
    const estimatedCost = computeEstimatedCost(state)
    if (estimatedCost !== undefined) data.estimatedCost = estimatedCost
  }
  if (state.toolExecutions.length > 0) {
    data.tools = state.toolExecutions.map(t => ({ ...t }))
  }
  return data
}

function extractToolName(result: unknown): string {
  if (result && typeof result === 'object') {
    const record = result as Record<string, unknown>
    if (typeof record.toolName === 'string') return record.toolName
    if (typeof record.subagentName === 'string') return record.subagentName
    if (typeof record.name === 'string') return record.name
  }
  return 'unknown'
}

function extractCallId(result: unknown): string | undefined {
  if (result && typeof result === 'object') {
    const { callId } = result as Record<string, unknown>
    if (typeof callId === 'string') return callId
  }
  return undefined
}

const DEFAULT_MESSAGE_PREVIEW_LENGTH = 500

function truncateMessage(message: string, maxLength = DEFAULT_MESSAGE_PREVIEW_LENGTH): string {
  if (message.length <= maxLength) return message
  return `${message.slice(0, maxLength)}…`
}

function resolveMessageMode(options: EvlogEveOptions): EveMessageMode {
  if (options.message) return options.message
  if (options.redactMessage === false) return 'preview'
  return 'omit'
}

/** Attachment parts stripped of everything but their kind — filenames carry PII. */
function summarizeMessageParts(parts: readonly unknown[]): Array<Record<string, unknown>> {
  return parts.map((part) => {
    const record = part as Record<string, unknown>
    const summary: Record<string, unknown> = { type: record.type ?? record.kind }
    if (typeof record.mediaType === 'string') summary.mediaType = record.mediaType
    return summary
  })
}

function loggerConfigFromOptions(options: EvlogEveOptions): LoggerConfig {
  const config = toLoggerConfig(options)
  return { ...config, env: { service: 'eve-agent', ...config.env } }
}

function ensureInit(options: EvlogEveOptions): void {
  const state = getEveGlobalState()
  if (options.maxSessions !== undefined) {
    state.maxSessions = options.maxSessions
  }
  if (isEveInitialized()) return
  if (!isLoggerLocked() && !isLoggerInitialized()) {
    initLogger(options.init ?? loggerConfigFromOptions(options))
  }
  setEveInitialized(true)
}

const turnLoggerStorage = createSharedEnterWithStorage(
  'evlog:eve-turn',
  () => new AsyncLocalStorage<AuditableLogger>(),
)
const activeTurnLoggers = new WeakSet<AuditableLogger>()

function bindTurnLogger(logger: AuditableLogger): void {
  bindAsyncLocalStorage(turnLoggerStorage, logger)
  activeTurnLoggers.add(logger)
}

function unbindTurnLogger(logger: AuditableLogger): void {
  activeTurnLoggers.delete(logger)
  if (turnLoggerStorage.getStore() === logger) {
    clearAsyncLocalStorage(turnLoggerStorage)
  }
}

/**
 * Turn state is process-local, an eve turn is durable: one resumed in another
 * process after a step boundary can no longer reach the logger it opened with.
 * Instrumentation must never fail the work it instruments, so every miss
 * degrades to a logger that accepts each call and emits nothing. Warned once
 * per scope, because a resumed turn calls this on every tool it runs.
 */
function detachedTurnLogger(scope: string, hint: string): AuditableLogger {
  const warned = detachedWarned()
  if (!warned.has(scope)) {
    warned.add(scope)
    console.warn(`[evlog] useLogger() found no logger for ${scope}; its enrichment is dropped. ${hint}`)
  }
  return noopLogger
}

function resolveTurnLogger(ctx: EveTurnSessionContext): AuditableLogger {
  const sessionId = ctx.session.id
  const turnId = ctx.session.turn?.id ?? activeTurnBySession().get(sessionId)

  if (!turnId) {
    return detachedTurnLogger(
      `session ${sessionId}`,
      'Ensure defineEvlogHook() is registered and the turn has started.',
    )
  }

  const state = turnStates().get(turnKey(sessionId, turnId))
  if (!state) {
    return detachedTurnLogger(
      turnKey(sessionId, turnId),
      'The turn already ended, or it resumed in another process and cannot carry its logger.',
    )
  }

  return state.logger
}

/**
 * Turn-scoped logger for eve tool `execute()` handlers.
 *
 * When {@link defineEvlogHook} is registered, the logger is bound via
 * AsyncLocalStorage on `turn.started`. Inside tool handlers, `useLogger()`
 * resolves from ALS when it propagated, otherwise from the sole active turn
 * in the process (typical eve dev). Pass eve tool `ctx` only when multiple
 * sessions are active concurrently.
 *
 * @example
 * ```ts
 * import { useLogger } from 'evlog/eve'
 *
 * export default defineTool({
 *   async execute(input) {
 *     const log = useLogger()
 *     log.set({ order: { id: input.orderId } })
 *   },
 * })
 * ```
 */
function resolveActiveTurnLogger(): AuditableLogger | null {
  const active = activeTurnBySession()
  if (active.size !== 1) return null

  const [sessionId, turnId] = active.entries().next().value!
  return turnStates().get(turnKey(sessionId, turnId))?.logger ?? null
}

export function useLogger(ctx?: EveTurnSessionContext): AuditableLogger {
  const fromStorage = turnLoggerStorage.getStore()
  if (fromStorage && activeTurnLoggers.has(fromStorage)) {
    return fromStorage
  }

  if (ctx?.session?.id) {
    return resolveTurnLogger(ctx)
  }

  const active = resolveActiveTurnLogger()
  if (active) return active

  return detachedTurnLogger(
    'the current turn',
    'Add agent/hooks/evlog.ts with defineEvlogHook(), or pass ctx from the tool handler.',
  )
}

interface EveGlobalState {
  turnStates: Map<string, TurnState>
  activeTurnBySession: Map<string, string>
  sessionTurnIds: Map<string, Set<string>>
  sessionSnapshots: Map<string, Record<string, unknown>>
  sessionPendingActions: Map<string, Map<string, PendingAction>>
  sessionApprovals: Map<string, EveApprovalPending[]>
  sessionRollups: Map<string, SessionRollup>
  sessionRuntimes: Map<string, EveRuntimeInfo>
  sessionAuthorizationStarts: Map<string, Map<string, number>>
  sessionInteractions: Map<string, Map<string, OpenInteraction>>
  detachedWarned: Set<string>
  maxSessions: number
  initialized: boolean
}

const EVE_GLOBAL_STATE = Symbol.for('evlog.eve.state')

function getEveGlobalState(): EveGlobalState {
  const host = globalThis as typeof globalThis & {
    [EVE_GLOBAL_STATE]?: EveGlobalState
  }
  if (!host[EVE_GLOBAL_STATE]) {
    host[EVE_GLOBAL_STATE] = {
      turnStates: new Map(),
      activeTurnBySession: new Map(),
      sessionTurnIds: new Map(),
      sessionSnapshots: new Map(),
      sessionPendingActions: new Map(),
      sessionApprovals: new Map(),
      sessionRollups: new Map(),
      sessionRuntimes: new Map(),
      sessionAuthorizationStarts: new Map(),
      sessionInteractions: new Map(),
      detachedWarned: new Set(),
      maxSessions: DEFAULT_MAX_SESSIONS,
      initialized: false,
    }
  }
  return host[EVE_GLOBAL_STATE]
}

function turnStates(): Map<string, TurnState> {
  return getEveGlobalState().turnStates
}

function detachedWarned(): Set<string> {
  return getEveGlobalState().detachedWarned
}

function activeTurnBySession(): Map<string, string> {
  return getEveGlobalState().activeTurnBySession
}

function sessionTurnIds(): Map<string, Set<string>> {
  return getEveGlobalState().sessionTurnIds
}

/** Turn ids still open for a session, as a snapshot safe to iterate while finishing. */
function openTurnIds(sessionId: string): string[] {
  return [...(sessionTurnIds().get(sessionId) ?? [])]
}

function sessionSnapshots(): Map<string, Record<string, unknown>> {
  return getEveGlobalState().sessionSnapshots
}

function sessionPendingActions(): Map<string, Map<string, PendingAction>> {
  return getEveGlobalState().sessionPendingActions
}

function sessionApprovals(): Map<string, EveApprovalPending[]> {
  return getEveGlobalState().sessionApprovals
}

function sessionRollups(): Map<string, SessionRollup> {
  return getEveGlobalState().sessionRollups
}

function sessionRuntimes(): Map<string, EveRuntimeInfo> {
  return getEveGlobalState().sessionRuntimes
}

function sessionAuthorizationStarts(): Map<string, Map<string, number>> {
  return getEveGlobalState().sessionAuthorizationStarts
}

function sessionInteractions(): Map<string, Map<string, OpenInteraction>> {
  return getEveGlobalState().sessionInteractions
}

function openInteraction(sessionId: string, interactionId: string, interaction: OpenInteraction): void {
  touchSession(sessionId)
  const open = sessionInteractions().get(sessionId) ?? new Map<string, OpenInteraction>()
  open.set(interactionId, interaction)
  sessionInteractions().set(sessionId, open)
}

function closeInteraction(sessionId: string, interactionId: string): OpenInteraction | undefined {
  const open = sessionInteractions().get(sessionId)
  const interaction = open?.get(interactionId)
  open?.delete(interactionId)
  if (open?.size === 0) sessionInteractions().delete(sessionId)
  return interaction
}

function freshRollup(): SessionRollup {
  return {
    turnCount: 0,
    lastAccess: 0,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    estimatedCost: 0,
    tools: new Set(),
    compactions: 0,
    authorizations: 0,
    failedTurns: 0,
    cancelledTurns: 0,
  }
}

function touchSession(sessionId: string): void {
  const rollups = sessionRollups()
  const rollup = rollups.get(sessionId) ?? freshRollup()
  rollup.lastAccess = Date.now()
  rollups.set(sessionId, rollup)
  evictStaleSessions()
}

function clearSessionState(sessionId: string): void {
  sessionSnapshots().delete(sessionId)
  sessionRollups().delete(sessionId)
  sessionPendingActions().delete(sessionId)
  sessionApprovals().delete(sessionId)
  sessionTurnIds().delete(sessionId)
  sessionRuntimes().delete(sessionId)
  sessionAuthorizationStarts().delete(sessionId)
  sessionInteractions().delete(sessionId)
}

function evictStaleSessions(): void {
  const { maxSessions } = getEveGlobalState()
  const rollups = sessionRollups()
  if (rollups.size <= maxSessions) return

  const oldest = [...rollups.entries()]
    .sort((a, b) => a[1].lastAccess - b[1].lastAccess)
    .slice(0, rollups.size - maxSessions)

  for (const [sessionId] of oldest) {
    if (activeTurnBySession().has(sessionId)) continue
    clearSessionState(sessionId)
  }
}

function pruneEmptySessionMaps(sessionId: string): void {
  const pending = sessionPendingActions().get(sessionId)
  if (pending?.size === 0) sessionPendingActions().delete(sessionId)

  const approvals = sessionApprovals().get(sessionId)
  if (approvals?.length === 0) sessionApprovals().delete(sessionId)
}

function bumpSessionTurnCount(sessionId: string): number {
  touchSession(sessionId)
  const rollup = sessionRollups().get(sessionId)!
  rollup.turnCount += 1
  return rollup.turnCount
}

/** Turn-level label — only set when the turn ends in a non-routine state. */
function derivePhase(
  ctx: Record<string, unknown>,
  accumulator: TurnAccumulator,
  httpStatus: number,
): string | undefined {
  const eve = ctx.eve as { cancelled?: boolean } | undefined
  if (eve?.cancelled) return 'cancelled'
  const approval = ctx.approval as { status?: string } | undefined
  if (approval?.status === 'rejected') return 'rejected'
  if (approval?.status === 'pending' || accumulator.pausedForInput) return 'awaiting-approval'
  if (accumulator.authorizations.some(a => !a.outcome)) return 'awaiting-authorization'
  if (httpStatus >= 400 && httpStatus !== CANCELLED_STATUS) return 'failed'
  return undefined
}

function getSessionPendingActions(sessionId: string): Map<string, PendingAction> {
  let map = sessionPendingActions().get(sessionId)
  if (!map) {
    map = new Map()
    sessionPendingActions().set(sessionId, map)
  }
  return map
}

function trackPendingAction(
  sessionId: string,
  turnId: string,
  action: { callId: string, toolName: string, startedAt?: number },
): void {
  touchSession(sessionId)
  getSessionPendingActions(sessionId).set(action.callId, {
    toolName: action.toolName,
    startedAt: action.startedAt ?? Date.now(),
    turnId,
  })
}

/**
 * Older eve reports a subagent call both as a `subagent-call` action and as
 * `subagent.called`, so the second report fills in what the first lacked.
 */
function recordSubagentCall(acc: TurnAccumulator, record: EveSubagentRecord): void {
  const existing = acc.subagents.find(s => s.callId === record.callId)
  if (!existing) {
    acc.subagents.push(record)
    return
  }
  existing.toolName ??= record.toolName
  existing.childSessionId ??= record.childSessionId
}

function resolveToolDurationMs(
  state: TurnState,
  callId: string | undefined,
): number {
  const pending = callId ? getSessionPendingActions(state.sessionId).get(callId) : undefined
  if (pending) {
    if (pending.turnId !== state.turnId && state.accumulator.stepStartedAt !== undefined) {
      return Math.max(0, Date.now() - state.accumulator.stepStartedAt)
    }
    return Math.max(0, Date.now() - pending.startedAt)
  }
  if (state.accumulator.stepStartedAt !== undefined) {
    return Math.max(0, Date.now() - state.accumulator.stepStartedAt)
  }
  return 0
}

function consumeSessionApproval(
  sessionId: string,
  toolName: string,
  callId?: string,
): EveApprovalPending | undefined {
  const list = sessionApprovals().get(sessionId)
  if (!list?.length) return undefined
  const index = list.findIndex(approval =>
    callId ? approval.callId === callId : approval.toolName === toolName,
  )
  if (index === -1) return undefined
  const [approval] = list.splice(index, 1)
  if (list.length === 0) sessionApprovals().delete(sessionId)
  return approval
}

function storeSessionApprovals(sessionId: string, pending: EveApprovalPending[]): void {
  touchSession(sessionId)
  const existing = sessionApprovals().get(sessionId) ?? []
  sessionApprovals().set(sessionId, [...existing, ...pending])
}

function isEveInitialized(): boolean {
  return getEveGlobalState().initialized
}

function setEveInitialized(value: boolean): void {
  getEveGlobalState().initialized = value
}

function applySessionContext(sessionId: string, logger: AuditableLogger): void {
  touchSession(sessionId)
  const snapshot = sessionSnapshots().get(sessionId)
  if (snapshot && Object.keys(snapshot).length > 0) {
    logger.set({ ...snapshot })
  }
}

function persistSessionContext(sessionId: string, state: TurnState): void {
  const ctx = state.logger.getContext() as Record<string, unknown>
  const snapshot = { ...(sessionSnapshots().get(sessionId) ?? {}) }
  for (const [key, value] of Object.entries(ctx)) {
    if (!TURN_ONLY_KEYS.has(key) && !state.enrichTurnKeys.has(key) && value !== undefined) {
      snapshot[key] = value
    }
  }
  sessionSnapshots().set(sessionId, snapshot)
}

function flushEveMetadata(state: TurnState): void {
  const acc = state.accumulator
  const eve: Record<string, unknown> = {}

  if (acc.subagents.length > 0) {
    eve.subagents = acc.subagents.map(({ startedAt, ...record }) => ({ ...record }))
  }
  if (acc.authorizations.length > 0) {
    eve.authorizations = acc.authorizations.map(a => ({ ...a }))
  }
  if (acc.stepFailures.length > 0) {
    eve.stepFailures = acc.stepFailures.map(f => ({ ...f }))
    eve.failedSteps = acc.stepFailures.length
  }
  // A compaction requested but not yet completed still carries the most
  // actionable signal — the context was full enough to trigger one.
  if (acc.compactions > 0 || acc.compactionsRequested > 0) {
    eve.compaction = {
      count: acc.compactions,
      ...(acc.compactionsRequested > acc.compactions
        ? { requested: acc.compactionsRequested }
        : {}),
      ...(acc.compactionModel ? { model: acc.compactionModel } : {}),
      ...(acc.compactionInputTokens !== undefined
        ? { inputTokensAtTrigger: acc.compactionInputTokens }
        : {}),
    }
  }
  if (acc.contextCleared) eve.contextCleared = true
  // Reasoning size only — the reasoning text itself is never recorded.
  if (acc.reasoningBlocks > 0) {
    eve.reasoning = { blocks: acc.reasoningBlocks, chars: acc.reasoningChars }
  }
  if (acc.result !== undefined) eve.result = acc.result

  if (Object.keys(eve).length > 0) state.logger.set({ eve })

  // Response length is recorded in every message mode; the response text is
  // only present when the mode allowed the handler to keep it.
  if (acc.responseChars > 0) {
    state.logger.set({
      message: {
        responseChars: acc.responseChars,
        ...(acc.response !== undefined ? { response: acc.response } : {}),
      },
    })
  }
}

/** Wide-event view of the eve instance and the parent session, when there is one. */
/**
 * Who triggered this turn, from the caller principal eve resolved at dispatch.
 *
 * Only the identifiers eve itself routes on: `principalId` is opaque on every
 * channel eve ships (`github:<id>`, a Slack user id), and `subject` and
 * `attributes` are deliberately left out because a channel may put a name or an
 * email in them.
 */
function buildCaller(ctx: HookContext): Record<string, string> | null {
  const auth = ctx.session.auth?.current
  if (!auth) return null
  return {
    principalId: auth.principalId,
    principalType: auth.principalType,
    authenticator: auth.authenticator,
  }
}

function buildLineage(sessionId: string, ctx: HookContext): Record<string, unknown> {
  const eve: Record<string, unknown> = {}
  const runtime = sessionRuntimes().get(sessionId)
  if (runtime) {
    const { subagent, ...identity } = runtime
    if (Object.keys(identity).length > 0) eve.runtime = identity
  }

  const caller = buildCaller(ctx)
  if (caller) eve.caller = caller

  const { parent } = ctx.session
  if (parent) {
    eve.parent = {
      sessionId: parent.sessionId,
      rootSessionId: parent.rootSessionId,
      callId: parent.callId,
      ...(parent.turn?.id ? { turnId: parent.turn.id } : {}),
      ...(runtime?.subagent ? { subagent: runtime.subagent } : {}),
    }
  }
  return eve
}

function getOrCreateTurnState(
  sessionId: string,
  turnId: string,
  options: EvlogEveOptions,
  ctx: HookContext,
): TurnState | null {
  const key = turnKey(sessionId, turnId)
  const existing = turnStates().get(key)
  if (existing) return existing

  touchSession(sessionId)

  const path = `/sessions/${sessionId}/turns/${turnId}`
  const middlewareOptions: MiddlewareLoggerOptions = {
    method: 'EVE',
    path,
    requestId: key,
    ...pickBaseEvlogOptions(options),
  }

  const { logger, finish, skipped } = createMiddlewareLogger(middlewareOptions)
  if (skipped) return null

  const state: TurnState = {
    logger,
    finish,
    middlewareOptions,
    accumulator: freshAccumulator(options),
    sessionId,
    turnId,
    enrichTurnKeys: new Set(),
  }

  applySessionContext(sessionId, logger)

  logger.set({
    eve: {
      sessionId,
      turnId,
      ...buildLineage(sessionId, ctx),
    },
    agent: {
      name: ctx.agent.name,
      ...(ctx.agent.nodeId ? { nodeId: ctx.agent.nodeId } : {}),
    },
    channel: {
      kind: ctx.channel.kind ?? 'unknown',
      ...(ctx.channel.continuationToken ? { continuing: true } : {}),
    },
  })

  // Isolated from the turn.started handler: a throwing enrichTurn must not
  // skip the logger binding that happens after getOrCreateTurnState returns.
  if (options.enrichTurn) {
    try {
      const fields = options.enrichTurn({
        session: ctx.session,
        agent: ctx.agent,
        channel: ctx.channel,
      })
      if (fields) {
        for (const k of Object.keys(fields)) state.enrichTurnKeys.add(k)
        logger.set(fields)
      }
    } catch (err) {
      console.error('[evlog] enrichTurn failed:', err)
    }
  }

  turnStates().set(key, state)
  activeTurnBySession().set(sessionId, turnId)
  const open = sessionTurnIds().get(sessionId) ?? new Set<string>()
  open.add(turnId)
  sessionTurnIds().set(sessionId, open)
  return state
}

function flushAi(state: TurnState): void {
  const ai = buildAiField(state.accumulator)
  if (!ai.model) {
    const model = sessionRuntimes().get(state.sessionId)?.model
    if (model) ai.model = model
  }
  if (!ai.provider) {
    const modelId = state.accumulator.stepModel ?? sessionRuntimes().get(state.sessionId)?.model
    if (modelId) {
      const slashIndex = modelId.indexOf('/')
      if (slashIndex !== -1) {
        ai.provider = modelId.slice(0, slashIndex)
      }
    }
  }
  state.logger.set({ ai })
}

async function finishTurn(
  sessionId: string,
  turnId: string,
  opts: { status?: number; error?: Error },
): Promise<void> {
  const key = turnKey(sessionId, turnId)
  const state = turnStates().get(key)
  if (!state) return

  try {
    flushEveMetadata(state)
    flushAi(state)
    const httpStatus = opts.status ?? (opts.error ? 500 : 200)
    const ctx = state.logger.getContext() as Record<string, unknown>
    const phase = derivePhase(ctx, state.accumulator, httpStatus)
    const sessionTurns = bumpSessionTurnCount(sessionId)
    accumulateSessionTotals(sessionId, state.accumulator, httpStatus)
    state.logger.set({
      eve: {
        ...(phase ? { phase } : {}),
        sessionTurns,
      },
    })
    persistSessionContext(sessionId, state)
    await state.finish(opts)
  } finally {
    unbindTurnLogger(state.logger)
    turnStates().delete(key)
    if (activeTurnBySession().get(sessionId) === turnId) {
      activeTurnBySession().delete(sessionId)
    }
    const open = sessionTurnIds().get(sessionId)
    open?.delete(turnId)
    if (open?.size === 0) sessionTurnIds().delete(sessionId)
    pruneEmptySessionMaps(sessionId)
  }
}

/** Fold one finished turn into its session rollup, for the session wide event. */
function accumulateSessionTotals(
  sessionId: string,
  acc: TurnAccumulator,
  httpStatus: number,
): void {
  const rollup = sessionRollups().get(sessionId)
  if (!rollup) return

  rollup.calls += acc.calls
  rollup.inputTokens += acc.inputTokens
  rollup.outputTokens += acc.outputTokens
  // Mirrors the per-turn rule in `buildAiField`: a turn contributes to one cost
  // bucket or the other, never both, so the two session totals cannot overlap.
  if (acc.costUsd > 0) rollup.costUsd += acc.costUsd
  else rollup.estimatedCost += computeEstimatedCost(acc) ?? 0
  rollup.compactions += acc.compactions
  rollup.authorizations += acc.authorizations.length
  for (const tool of acc.toolExecutions) rollup.tools.add(tool.name)
  // Classified from the terminal status, not the phase: a turn that fails while
  // parked on an approval or an authorization reports that phase, not 'failed'.
  if (httpStatus === CANCELLED_STATUS) rollup.cancelledTurns += 1
  else if (httpStatus >= 400) rollup.failedTurns += 1
}

/**
 * Emit one wide event summarizing a whole session. Opt-in through
 * {@link EvlogEveOptions.sessionEvent}: it is the "one row per conversation"
 * view, complementing the per-turn events.
 */
async function emitSessionEvent(
  sessionId: string,
  options: EvlogEveOptions,
  ctx: HookContext,
  outcome: { status?: number; error?: Error },
): Promise<void> {
  const rollup = sessionRollups().get(sessionId)
  if (!rollup) return

  const { logger, finish, skipped } = createMiddlewareLogger({
    method: 'EVE',
    path: `/sessions/${sessionId}`,
    requestId: sessionId,
    ...pickBaseEvlogOptions(options),
  })
  if (skipped) return

  applySessionContext(sessionId, logger)
  logger.set({
    eve: {
      sessionId,
      scope: 'session',
      turns: rollup.turnCount,
      ...(rollup.failedTurns > 0 ? { failedTurns: rollup.failedTurns } : {}),
      ...(rollup.cancelledTurns > 0 ? { cancelledTurns: rollup.cancelledTurns } : {}),
      ...(rollup.compactions > 0 ? { compactions: rollup.compactions } : {}),
      ...(rollup.authorizations > 0 ? { authorizations: rollup.authorizations } : {}),
      ...buildLineage(sessionId, ctx),
    },
    agent: {
      name: ctx.agent.name,
      ...(ctx.agent.nodeId ? { nodeId: ctx.agent.nodeId } : {}),
    },
    channel: { kind: ctx.channel.kind ?? 'unknown' },
    ai: {
      calls: rollup.calls,
      inputTokens: rollup.inputTokens,
      outputTokens: rollup.outputTokens,
      totalTokens: rollup.inputTokens + rollup.outputTokens,
      ...(rollup.costUsd > 0 ? { costUsd: roundCost(rollup.costUsd) } : {}),
      ...(rollup.estimatedCost > 0
        ? { estimatedCost: roundCost(rollup.estimatedCost) }
        : {}),
      ...(rollup.tools.size > 0 ? { toolCalls: [...rollup.tools] } : {}),
    },
  })

  await finish(outcome)
}

/**
 * Emit every turn still open for a session. eve ends a session with
 * `session.completed` / `session.failed`; a turn left open at that point never
 * received its own terminal event, so without this it would neither be emitted
 * nor released.
 *
 * Each turn is finished independently: a user `keep` callback that throws
 * rejects that turn's `finish`, and must not take the remaining turns with it.
 */
async function finishOpenTurns(
  sessionId: string,
  opts: { status?: number; error?: Error },
  decorate?: (state: TurnState) => void,
): Promise<void> {
  for (const turnId of openTurnIds(sessionId)) {
    try {
      const state = getTurnState(sessionId, turnId)
      if (state && decorate) decorate(state)
      await finishTurn(sessionId, turnId, opts)
    } catch (err) {
      console.error('[evlog] eve hook handler failed:', err)
    }
  }
}

function runSafe(fn: () => void | Promise<void>): void {
  void (async () => {
    try {
      await fn()
    } catch (err) {
      console.error('[evlog] eve hook handler failed:', err)
    }
  })()
}

function getTurnState(sessionId: string, turnId: string): TurnState | undefined {
  return turnStates().get(turnKey(sessionId, turnId))
}

/** v27 payloads mostly leave the turn out: the event's `scope` names it. */
function turnStateFor(
  sessionId: string,
  event: { readonly scope?: { readonly turnId?: string } },
  turnId = event.scope?.turnId,
): TurnState | undefined {
  const id = turnId ?? activeTurnBySession().get(sessionId)
  return id ? getTurnState(sessionId, id) : undefined
}

/** A model run that rewrites the context (compaction) is not a step of the turn. */
function isContextChange(event: { readonly scope?: { readonly changeId?: string } }): boolean {
  return event.scope?.changeId !== undefined
}

/** Token usage as eve reports it: on v26 `step.completed`, on v27 `usage.recorded`. */
interface EveUsage {
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
  readonly costUsd?: number
}

/** An error as eve reports it: v26 carries `details`, v27 `hint`. */
interface EveErrorInfo {
  readonly code: string
  readonly message: string
  readonly details?: unknown
  readonly hint?: string
}

function addUsage(acc: TurnAccumulator, usage: EveUsage): void {
  acc.inputTokens += usage.inputTokens ?? 0
  acc.outputTokens += usage.outputTokens ?? 0
  acc.cacheReadTokens += usage.cacheReadTokens ?? 0
  acc.cacheWriteTokens += usage.cacheWriteTokens ?? 0
  acc.costUsd += usage.costUsd ?? 0
  if (usage.inputTokens !== undefined) attributeToolInputTokens(acc, usage.inputTokens)
}

function failureRecord(info: EveErrorInfo): Record<string, unknown> {
  return {
    code: info.code,
    message: info.message,
    ...(info.details ? { details: info.details } : {}),
    ...(info.hint ? { hint: info.hint } : {}),
  }
}

function errorFrom(info: EveErrorInfo | undefined, fallback: string): Error {
  const error = new Error(info?.message ?? fallback)
  if (info) error.name = info.code
  return error
}

/** How much of a message reaches the wide event: {@link EvlogEveOptions.message} and its preview length. */
interface MessageSettings {
  mode: EveMessageMode
  previewLength: number
}

function recordReceivedMessage(state: TurnState, message: string, parts: readonly unknown[], settings: MessageSettings): void {
  const full = settings.mode === 'full'
  state.logger.set({
    message: {
      received: full ? message : truncateMessage(message, settings.previewLength),
      ...(parts.length > 0
        ? { parts: full ? parts.map(part => ({ ...(part as Record<string, unknown>) })) : summarizeMessageParts(parts) }
        : {}),
    },
  })
}

function recordResponse(acc: TurnAccumulator, message: string, settings: MessageSettings): void {
  acc.responseChars += message.length
  if (settings.mode === 'omit') return
  acc.response = settings.mode === 'full' ? message : truncateMessage(message, settings.previewLength)
}

async function finishSettledTurn(sessionId: string, turnId: string, outcome: string, error?: EveErrorInfo): Promise<void> {
  const state = getTurnState(sessionId, turnId)
  if (outcome === 'cancelled') {
    state?.logger.set({ eve: { cancelled: true } })
    await finishTurn(sessionId, turnId, { status: CANCELLED_STATUS })
    return
  }
  if (outcome === 'failed') {
    if (error) state?.logger.set({ eve: { failure: failureRecord(error) } })
    await finishTurn(sessionId, turnId, { error: errorFrom(error, 'eve turn failed'), status: 500 })
    return
  }
  await finishTurn(sessionId, turnId, { status: 200 })
}

async function endSession(
  ctx: HookContext,
  options: EvlogEveOptions,
  failed: boolean,
  failure?: EveErrorInfo,
): Promise<void> {
  const sessionId = ctx.session.id
  try {
    const outcome = failed ? { error: errorFrom(failure, 'eve session failed'), status: 500 } : { status: 200 }
    await finishOpenTurns(sessionId, outcome, failure
      ? (state) => {
        state.logger.set({ eve: { failure: failureRecord(failure) } })
      }
      : undefined)
    if (options.sessionEvent) {
      await emitSessionEvent(sessionId, options, ctx, outcome)
    }
  } catch (err) {
    console.error('[evlog] eve hook handler failed:', err)
  } finally {
    clearSessionState(sessionId)
  }
}

/**
 * The v26 session events eve emitted before 0.84. eve's typings describe only v27,
 * so these list the fields the v26 handlers read.
 */
interface V26Event<TData> {
  readonly data: TData
}
type V26Handler<TData = Record<string, never>> = (event: V26Event<TData>, ctx: HookContext) => void | Promise<void>
interface V26Turn {
  readonly turnId: string
}
type V26Action =
  | { readonly kind: 'tool-call', readonly callId: string, readonly toolName: string }
  | { readonly kind: 'subagent-call', readonly callId: string, readonly subagentName: string, readonly name: string }
  | { readonly kind: 'remote-agent-call', readonly callId: string, readonly remoteAgentName: string, readonly name: string }

interface V26Events {
  'message.received': V26Handler<V26Turn & { readonly message: string, readonly parts?: readonly unknown[] }>
  'step.started': V26Handler<V26Turn & { readonly modelId?: string }>
  'step.completed': V26Handler<V26Turn & { readonly finishReason?: string, readonly usage?: EveUsage }>
  'step.failed': V26Handler<V26Turn & { readonly code: string, readonly message: string, readonly stepIndex: number }>
  'authorization.required': V26Handler<V26Turn & { readonly name: string }>
  'authorization.completed': V26Handler<V26Turn & { readonly name: string, readonly outcome: string, readonly reason?: string }>
  'compaction.requested': V26Handler<V26Turn & { readonly modelId: string, readonly usageInputTokens: number | null }>
  'compaction.completed': V26Handler<V26Turn>
  'context.cleared': V26Handler<V26Turn>
  'reasoning.completed': V26Handler<V26Turn & { readonly reasoning: string }>
  'message.completed': V26Handler<V26Turn & { readonly message: string | null }>
  'result.completed': V26Handler<V26Turn & { readonly result: unknown }>
  'actions.requested': V26Handler<V26Turn & { readonly actions: readonly V26Action[] }>
  'input.requested': V26Handler<V26Turn & { readonly requests: readonly { readonly action: { readonly toolName: string, readonly callId: string } }[] }>
  'action.result': V26Handler<V26Turn & {
    readonly status: string
    readonly result: { readonly kind?: string, readonly isError?: boolean }
    readonly error?: { readonly message: string }
  }>
  'turn.completed': V26Handler<V26Turn>
  'turn.cancelled': V26Handler<V26Turn>
  'turn.failed': V26Handler<V26Turn & EveErrorInfo>
  'session.completed': V26Handler
  'session.failed': V26Handler<EveErrorInfo>
}

interface V26SubagentEvents {
  'subagent.called': V26Handler<V26Turn & {
    readonly callId: string
    readonly name: string
    readonly toolName?: string
    readonly childSessionId?: string
  }>
  'subagent.started': V26Handler<{ readonly callId: string }>
  'subagent.completed': V26Handler<{ readonly callId: string, readonly subagentName: string, readonly output?: string }>
}

/**
 * Create an eve stream hook that emits one evlog wide event per agent turn.
 *
 * Export the result as the default export of `agent/hooks/evlog.ts`. eve
 * auto-discovers hook files; evlog maps turn lifecycle events to a wide event
 * with AI usage, tool executions, and your drain/enrich/keep pipeline.
 *
 * Handles the v27 session events of eve 0.84 and later (`turn.settled`,
 * `usage.recorded`, `call.settled`...) and the v26 events of earlier versions.
 *
 * Complements eve Agent Runs and OpenTelemetry — it does not replace them.
 *
 * @example
 * ```ts
 * // agent/hooks/evlog.ts
 * import { defineEvlogHook } from 'evlog/eve'
 * import { createAxiomDrain } from 'evlog/axiom'
 *
 * export default defineEvlogHook({
 *   drain: createAxiomDrain(),
 *   enrich: (ctx) => {
 *     ctx.event.runtime = process.env.VERCEL_REGION
 *   },
 * })
 * ```
 *
 * The options take `evlog.config.ts` as it is. With its default export
 * imported as `config`, spread it and add the eve settings:
 *
 * ```ts
 * export default defineEvlogHook({ ...config, message: 'preview' })
 * ```
 *
 * @deprecated Removed in evlog v3. Use the `evlog()` lifecycle provider.
 */
export function defineEvlogHook(options: EvlogEveOptions = {}): HookDefinition {
  if (options.redactMessage !== undefined) {
    warnDeprecated('eve:redactMessage', '[evlog/eve] redactMessage is deprecated and removed in v3. Use message: \'omit\' (was true) or \'preview\' (was false).')
  }
  const messageMode = resolveMessageMode(options)
  const messageSettings: MessageSettings = {
    mode: messageMode,
    previewLength: options.messagePreviewLength ?? DEFAULT_MESSAGE_PREVIEW_LENGTH,
  }

  const hook = defineHook({
    events: {
      'session.started'(event, ctx) {
        runSafe(() => {
          ensureInit(options)
          // v26 also reported the model and, for a subagent session, the invocation.
          const { runtime, invocation, parent } = event.data as typeof event.data & {
            invocation?: { name?: string }
            runtime?: { modelId?: string }
          }
          if (!runtime && !invocation) return
          touchSession(ctx.session.id)
          const subagent = invocation?.name ?? (parent ? runtime?.agentName : undefined)
          sessionRuntimes().set(ctx.session.id, {
            ...(runtime?.eveVersion ? { version: runtime.eveVersion } : {}),
            ...(runtime?.agentId ? { agentId: runtime.agentId } : {}),
            ...(runtime?.modelId ? { model: runtime.modelId } : {}),
            ...(runtime?.build?.gitSha ? { gitSha: runtime.build.gitSha } : {}),
            ...(runtime?.build?.gitBranch ? { gitBranch: runtime.build.gitBranch } : {}),
            ...(runtime?.build?.deployedAt ? { deployedAt: runtime.build.deployedAt } : {}),
            ...(subagent ? { subagent } : {}),
          })
        })
      },

      'turn.started'(event, ctx) {
        try {
          ensureInit(options)
          const state = getOrCreateTurnState(ctx.session.id, event.data.turnId, options, ctx)
          // Only v26 numbers the turns.
          const { sequence } = event.data as typeof event.data & { sequence?: number }
          if (sequence !== undefined) state?.logger.set({ eve: { turnSequence: sequence } })
          if (state) bindTurnLogger(state.logger)
        } catch (err) {
          console.error('[evlog] eve hook handler failed:', err)
        }
      },

      'delivery.consumed'(event, ctx) {
        runSafe(() => {
          if (messageMode === 'omit') return
          const state = getTurnState(ctx.session.id, event.data.turnId)
          if (!state) return
          const { parts } = event.data
          const text = parts.flatMap(part => part.kind === 'text' ? [part.text] : []).join('\n')
          recordReceivedMessage(state, text, parts.filter(part => part.kind !== 'text'), messageSettings)
        })
      },

      'model.started'(event, ctx) {
        runSafe(() => {
          if (isContextChange(event)) return
          const state = turnStateFor(ctx.session.id, event)
          if (!state) return
          state.accumulator.stepStartedAt = Date.now()
          state.accumulator.stepModel = event.data.modelId
        })
      },

      'model.retried'(event, ctx) {
        runSafe(() => {
          if (isContextChange(event)) return
          const acc = turnStateFor(ctx.session.id, event)?.accumulator
          if (!acc) return
          acc.stepFailures.push({ code: event.data.error.code, message: event.data.error.message, stepIndex: acc.steps })
        })
      },

      'model.settled'(event, ctx) {
        runSafe(() => {
          if (isContextChange(event)) return
          const acc = turnStateFor(ctx.session.id, event)?.accumulator
          if (!acc) return
          const { outcome, finishReason, error } = event.data
          if (outcome === 'completed') {
            acc.steps += 1
            acc.calls += 1
            if (finishReason) acc.finishReason = finishReason
          } else if (outcome === 'failed' && error) {
            acc.stepFailures.push({ code: error.code, message: error.message, stepIndex: acc.steps })
          }
        })
      },

      'usage.recorded'(event, ctx) {
        runSafe(() => {
          const { owner, kind, usage } = event.data
          // Only the turn's own model runs count, as v26 step usage did: a delegated
          // call reports its child session's usage.
          if (kind !== 'model' || (owner && !('runId' in owner)) || isContextChange(event)) return
          const acc = turnStateFor(ctx.session.id, event)?.accumulator
          if (acc) addUsage(acc, usage)
        })
      },

      'call.requested'(event, ctx) {
        runSafe(() => {
          const state = turnStateFor(ctx.session.id, event)
          if (!state) return
          bindTurnLogger(state.logger)
          const { callId, capability } = event.data
          const startedAt = Date.now()
          trackPendingAction(ctx.session.id, state.turnId, { callId, toolName: capability.name, startedAt })
          if (capability.kind === 'agent') {
            recordSubagentCall(state.accumulator, {
              callId,
              name: capability.name,
              ...(capability.remote ? { remote: true } : {}),
              status: 'called',
              startedAt,
            })
          }
        })
      },

      'call.started'(event, ctx) {
        runSafe(() => {
          // Execution starts here, after any approval the call waited for.
          const pending = sessionPendingActions().get(ctx.session.id)?.get(event.data.callId)
          if (pending) pending.startedAt = Date.now()
        })
      },

      'call.settled'(event, ctx) {
        runSafe(() => {
          const state = turnStateFor(ctx.session.id, event)
          if (!state) return
          const { callId, outcome, error, output } = event.data
          const sessionPending = getSessionPendingActions(state.sessionId)
          const toolName = sessionPending.get(callId)?.toolName ?? 'unknown'
          const durationMs = resolveToolDurationMs(state, callId)
          sessionPending.delete(callId)

          const execution: AIToolExecution = { name: toolName, durationMs, success: outcome === 'completed' }
          if (outcome === 'rejected') execution.error = 'rejected'
          else if (outcome !== 'completed') execution.error = error?.message ?? outcome

          const subagent = state.accumulator.subagents.find(s => s.callId === callId)
          if (subagent) {
            subagent.status = outcome === 'completed' ? 'completed' : 'failed'
            subagent.durationMs = durationMs
            if (typeof output === 'string') subagent.output = output
            if (execution.error) subagent.error = execution.error
          }
          state.accumulator.toolExecutions.push(execution)
          if (outcome !== 'rejected') state.accumulator.pendingToolAttribution.push(execution)
        })
      },

      'child.opened'(event, ctx) {
        runSafe(() => {
          const { owner, sessionId: childSessionId, name } = event.data
          if (!('callId' in owner)) return
          const acc = turnStateFor(ctx.session.id, event)?.accumulator
          if (!acc) return
          const existing = acc.subagents.find(s => s.callId === owner.callId)
          if (existing) {
            existing.childSessionId = childSessionId
            existing.status = 'started'
          } else {
            recordSubagentCall(acc, { callId: owner.callId, name, childSessionId, status: 'started', startedAt: Date.now() })
          }
        })
      },

      'interaction.opened'(event, ctx) {
        runSafe(() => {
          const state = turnStateFor(ctx.session.id, event)
          if (!state) return
          const { interactionId, subject, request } = event.data
          const acc = state.accumulator
          if (request.kind === 'sign-in') {
            const name = request.signIn?.name ?? request.title ?? request.prompt
            acc.authorizations.push({ name })
            openInteraction(ctx.session.id, interactionId, { kind: 'sign-in', name, startedAt: Date.now() })
            return
          }
          acc.pausedForInput = true
          if (request.kind !== 'approval' || !('callId' in subject)) {
            openInteraction(ctx.session.id, interactionId, { kind: request.kind, name: request.kind, startedAt: Date.now() })
            return
          }
          const tool = getSessionPendingActions(ctx.session.id).get(subject.callId)?.toolName ?? 'unknown'
          openInteraction(ctx.session.id, interactionId, { kind: 'approval', name: tool, startedAt: Date.now() })
          state.logger.set({ approval: { status: 'pending', tool } })
        })
      },

      'interaction.settled'(event, ctx) {
        runSafe(() => {
          const open = closeInteraction(ctx.session.id, event.data.interactionId)
          if (!open) return
          const state = turnStateFor(ctx.session.id, event)
          if (!state) return
          const { outcome, reason } = event.data
          const acc = state.accumulator
          if (open.kind === 'sign-in') {
            const record: EveAuthorizationRecord = {
              name: open.name,
              outcome,
              ...(reason ? { reason } : {}),
              durationMs: Math.max(0, Date.now() - open.startedAt),
            }
            const pending = acc.authorizations.find(a => a.name === open.name && !a.outcome)
            if (pending) Object.assign(pending, record)
            else acc.authorizations.push(record)
            return
          }
          acc.pausedForInput = false
          if (open.kind !== 'approval') return
          const status = outcome === 'accepted' ? 'approved' : outcome === 'declined' ? 'rejected' : outcome
          state.logger.set({ approval: { status, tool: open.name } })
        })
      },

      'content.completed'(event, ctx) {
        runSafe(() => {
          const acc = turnStateFor(ctx.session.id, event)?.accumulator
          if (!acc) return
          const { kind, phase, value } = event.data
          if (kind === 'reasoning') {
            acc.reasoningBlocks += 1
            if (typeof value === 'string') acc.reasoningChars += value.length
          } else if (kind === 'result') {
            acc.result = value
          } else if (kind === 'text' && phase === 'reply' && typeof value === 'string') {
            recordResponse(acc, value, messageSettings)
          }
        })
      },

      'context.started'(event, ctx) {
        runSafe(() => {
          const acc = turnStateFor(ctx.session.id, event, event.data.turnId ?? event.scope?.turnId)?.accumulator
          if (!acc) return
          acc.lastStepInputTokens = undefined
          acc.pendingToolAttribution = []
          if (event.data.kind === 'clear') {
            acc.contextCleared = true
            return
          }
          if (event.data.kind !== 'compaction') return
          acc.compactionsRequested += 1
          // `inputTokensAtTrigger` reports how full the context was when compaction first kicked in.
          if (acc.compactionsRequested === 1 && event.data.trigger) {
            acc.compactionInputTokens = event.data.trigger.inputTokens
          }
        })
      },

      'context.settled'(event, ctx) {
        runSafe(() => {
          if (event.data.kind !== 'compaction' || event.data.outcome !== 'completed') return
          const acc = turnStateFor(ctx.session.id, event)?.accumulator
          if (acc) acc.compactions += 1
        })
      },

      async 'turn.settled'(event, ctx) {
        try {
          const { turnId, outcome, error } = event.data
          await finishSettledTurn(ctx.session.id, turnId, outcome, error)
        } catch (err) {
          console.error('[evlog] eve hook handler failed:', err)
        }
      },

      async 'session.ended'(event, ctx) {
        await endSession(ctx, options, event.data.outcome === 'failed', event.data.error)
      },
    },
  })

  const v26Events: V26Events = {
    'message.received'(event, ctx) {
      runSafe(() => {
        if (messageMode === 'omit') return
        const state = getTurnState(ctx.session.id, event.data.turnId)
        if (!state) return
        recordReceivedMessage(state, event.data.message, event.data.parts ?? [], messageSettings)
      })
    },

    'step.started'(event, ctx) {
      runSafe(() => {
        const state = getTurnState(ctx.session.id, event.data.turnId)
        if (!state) return
        state.accumulator.stepStartedAt = Date.now()
        if (event.data.modelId) state.accumulator.stepModel = event.data.modelId
      })
    },

    'step.completed'(event, ctx) {
      runSafe(() => {
        const state = getTurnState(ctx.session.id, event.data.turnId)
        if (!state) return
        const acc = state.accumulator
        acc.steps += 1
        acc.calls += 1
        acc.finishReason = event.data.finishReason
        if (event.data.usage) addUsage(acc, event.data.usage)
      })
    },

    'step.failed'(event, ctx) {
      runSafe(() => {
        const state = getTurnState(ctx.session.id, event.data.turnId)
        if (!state) return
        state.accumulator.stepFailures.push({
          code: event.data.code,
          message: event.data.message,
          stepIndex: event.data.stepIndex,
        })
      })
    },

    'authorization.required'(event, ctx) {
      runSafe(() => {
        const state = getTurnState(ctx.session.id, event.data.turnId)
        if (!state) return
        const starts = sessionAuthorizationStarts().get(ctx.session.id) ?? new Map<string, number>()
        starts.set(event.data.name, Date.now())
        sessionAuthorizationStarts().set(ctx.session.id, starts)
        state.accumulator.authorizations.push({ name: event.data.name })
      })
    },

    'authorization.completed'(event, ctx) {
      runSafe(() => {
        const state = getTurnState(ctx.session.id, event.data.turnId)
        if (!state) return
        const starts = sessionAuthorizationStarts().get(ctx.session.id)
        const startedAt = starts?.get(event.data.name)
        starts?.delete(event.data.name)
        if (starts?.size === 0) sessionAuthorizationStarts().delete(ctx.session.id)

        const record: EveAuthorizationRecord = {
          name: event.data.name,
          outcome: event.data.outcome,
          ...(event.data.reason ? { reason: event.data.reason } : {}),
          ...(startedAt !== undefined ? { durationMs: Math.max(0, Date.now() - startedAt) } : {}),
        }
        // The `required` event may belong to an earlier turn: eve parks the
        // session across the sign-in, so only same-turn records are updated.
        const pending = state.accumulator.authorizations.find(
          a => a.name === event.data.name && !a.outcome,
        )
        if (pending) Object.assign(pending, record)
        else state.accumulator.authorizations.push(record)
      })
    },

    'compaction.requested'(event, ctx) {
      runSafe(() => {
        const state = getTurnState(ctx.session.id, event.data.turnId)
        if (!state) return
        const acc = state.accumulator
        acc.compactionsRequested += 1
        acc.lastStepInputTokens = undefined
        acc.pendingToolAttribution = []
        // Keep the first trigger of the turn: `inputTokensAtTrigger` reports
        // how full the context was when compaction first kicked in.
        if (acc.compactionModel === undefined) {
          acc.compactionModel = event.data.modelId
          if (event.data.usageInputTokens !== null) {
            acc.compactionInputTokens = event.data.usageInputTokens
          }
        }
      })
    },

    'compaction.completed'(event, ctx) {
      runSafe(() => {
        const state = getTurnState(ctx.session.id, event.data.turnId)
        if (!state) return
        state.accumulator.compactions += 1
      })
    },

    'context.cleared'(event, ctx) {
      runSafe(() => {
        const state = getTurnState(ctx.session.id, event.data.turnId)
        if (!state) return
        state.accumulator.contextCleared = true
        state.accumulator.lastStepInputTokens = undefined
        state.accumulator.pendingToolAttribution = []
      })
    },

    'reasoning.completed'(event, ctx) {
      runSafe(() => {
        const state = getTurnState(ctx.session.id, event.data.turnId)
        if (!state) return
        state.accumulator.reasoningBlocks += 1
        state.accumulator.reasoningChars += event.data.reasoning.length
      })
    },

    'message.completed'(event, ctx) {
      runSafe(() => {
        const state = getTurnState(ctx.session.id, event.data.turnId)
        if (!state || event.data.message === null) return
        recordResponse(state.accumulator, event.data.message, messageSettings)
      })
    },

    'result.completed'(event, ctx) {
      runSafe(() => {
        const state = getTurnState(ctx.session.id, event.data.turnId)
        if (!state) return
        state.accumulator.result = event.data.result
      })
    },

    'actions.requested'(event, ctx) {
      runSafe(() => {
        const state = getTurnState(ctx.session.id, event.data.turnId)
        if (!state) return
        bindTurnLogger(state.logger)
        const startedAt = Date.now()
        for (const action of event.data.actions) {
          if (action.kind === 'tool-call') {
            trackPendingAction(ctx.session.id, event.data.turnId, {
              callId: action.callId,
              toolName: action.toolName,
              startedAt,
            })
          } else if (action.kind === 'subagent-call' || action.kind === 'remote-agent-call') {
            const remote = action.kind === 'remote-agent-call'
            const name = remote ? action.remoteAgentName : action.subagentName
            trackPendingAction(ctx.session.id, event.data.turnId, {
              callId: action.callId,
              toolName: name,
              startedAt,
            })
            recordSubagentCall(state.accumulator, {
              callId: action.callId,
              name,
              toolName: action.name,
              ...(remote ? { remote: true } : {}),
              status: 'called',
              startedAt,
            })
          }
        }
      })
    },

    'input.requested'(event, ctx) {
      runSafe(() => {
        const state = getTurnState(ctx.session.id, event.data.turnId)
        if (!state) return
        state.accumulator.pausedForInput = true
        const pending = event.data.requests.map(req => ({
          toolName: req.action.toolName,
          callId: req.action.callId,
        }))
        storeSessionApprovals(ctx.session.id, pending)
        const [first] = pending
        if (first) {
          state.logger.set({
            approval: { status: 'pending', tool: first.toolName },
          })
        }
      })
    },

    'action.result'(event, ctx) {
      runSafe(() => {
        const state = getTurnState(ctx.session.id, event.data.turnId)
        if (!state) return
        const callId = extractCallId(event.data.result)
        const sessionPending = getSessionPendingActions(state.sessionId)
        const turnPending = callId ? sessionPending.get(callId) : undefined

        const { status } = event.data
        const rejected = status === 'rejected'
        const success = status === 'completed'
        const toolName = turnPending?.toolName ?? extractToolName(event.data.result)
        const durationMs = resolveToolDurationMs(state, callId)

        if (callId) sessionPending.delete(callId)

        const execution: AIToolExecution = {
          name: toolName,
          durationMs,
          success,
        }
        if (rejected) {
          execution.error = 'rejected'
          state.accumulator.pausedForInput = false
          consumeSessionApproval(state.sessionId, toolName, callId)
          state.logger.set({
            approval: { status: 'rejected', tool: toolName },
          })
        } else if (success) {
          const approval = consumeSessionApproval(state.sessionId, toolName, callId)
          if (approval) {
            state.accumulator.pausedForInput = false
            state.logger.set({
              approval: { status: 'approved', tool: approval.toolName },
            })
          }
        } else if (event.data.error) {
          execution.error = event.data.error.message
        }
        const subagent = callId
          ? state.accumulator.subagents.find(s => s.callId === callId)
          : undefined
        if (subagent) {
          const { result } = event.data
          const failed = !success || (result.kind === 'subagent-result' && result.isError === true)
          subagent.status = failed ? 'failed' : 'completed'
          subagent.durationMs = durationMs
          if (execution.error) subagent.error = execution.error
        }
        state.accumulator.toolExecutions.push(execution)
        if (!rejected) state.accumulator.pendingToolAttribution.push(execution)
      })
    },

    async 'turn.completed'(event, ctx) {
      try {
        await finishSettledTurn(ctx.session.id, event.data.turnId, 'completed')
      } catch (err) {
        console.error('[evlog] eve hook handler failed:', err)
      }
    },

    async 'turn.cancelled'(event, ctx) {
      try {
        await finishSettledTurn(ctx.session.id, event.data.turnId, 'cancelled')
      } catch (err) {
        console.error('[evlog] eve hook handler failed:', err)
      }
    },

    async 'turn.failed'(event, ctx) {
      try {
        await finishSettledTurn(ctx.session.id, event.data.turnId, 'failed', event.data)
      } catch (err) {
        console.error('[evlog] eve hook handler failed:', err)
      }
    },

    async 'session.completed'(_event, ctx) {
      await endSession(ctx, options, false)
    },

    async 'session.failed'(event, ctx) {
      await endSession(ctx, options, true, event.data)
    },
  }

  const v26SubagentEvents: V26SubagentEvents = {
    'subagent.called'(event, ctx) {
      runSafe(() => {
        const state = getTurnState(ctx.session.id, event.data.turnId)
        if (!state) return
        recordSubagentCall(state.accumulator, {
          callId: event.data.callId,
          name: event.data.name,
          toolName: event.data.toolName,
          childSessionId: event.data.childSessionId,
          status: 'called',
          startedAt: Date.now(),
        })
      })
    },

    'subagent.started'(event, ctx) {
      runSafe(() => {
        const turnId = activeTurnBySession().get(ctx.session.id)
        if (!turnId) return
        const state = getTurnState(ctx.session.id, turnId)
        const existing = state?.accumulator.subagents.find(s => s.callId === event.data.callId)
        if (existing) existing.status = 'started'
      })
    },

    'subagent.completed'(event, ctx) {
      runSafe(() => {
        const sessionId = ctx.session.id
        const turnId = activeTurnBySession().get(sessionId)
        if (!turnId) return
        const state = getTurnState(sessionId, turnId)
        if (!state) return
        const existing = state.accumulator.subagents.find(s => s.callId === event.data.callId)
        if (existing) {
          existing.status = 'completed'
          existing.output = event.data.output
          if (existing.startedAt !== undefined) {
            existing.durationMs = Math.max(0, Date.now() - existing.startedAt)
          }
        } else {
          state.accumulator.subagents.push({
            callId: event.data.callId,
            name: event.data.subagentName,
            status: 'completed',
            output: event.data.output,
          })
        }
      })
    },
  }

  const events = {
    ...hook.events,
    ...v26Events,
    ...(options.subagentEvents === false ? {} : v26SubagentEvents),
  }
  return { ...hook, events }
}

/** Options for {@link defineEvlogInstrumentation}. */
export interface EvlogEveInstrumentationOptions {
  /** Overrides `ai.telemetry.functionId` on spans. Defaults to the agent name. */
  functionId?: string
  /** Whether the AI SDK records full model inputs on spans. eve defaults to `true`. */
  recordInputs?: boolean
  /** Whether the AI SDK records model outputs on spans. eve defaults to `true`. */
  recordOutputs?: boolean
  /** Whether eve emits the inbound HTTP `SERVER` span wrapping each channel request. */
  traceChannelRequests?: boolean
  /**
   * Runs at server startup with the resolved agent name — register your OTel
   * provider here, exactly as in a hand-written `defineInstrumentation`. Omit it
   * and eve keeps writing its local traces.
   */
  setup?: (context: InstrumentationSetupContext) => void
}

/** The fields {@link evlogRuntimeContext} reads from eve's model-attempt input, on every eve version. */
interface EveModelAttemptInput {
  readonly session: { readonly id: string }
  readonly turn?: { readonly id: string }
}

/**
 * Per-model-call attributes linking an AI SDK span back to the evlog wide event
 * for the same turn, ready to spread into your own runtime context.
 *
 * On eve 0.84 and later, pass it as the `runtimeContext` of an OTel integration
 * in `agent/instrumentation/`:
 *
 * @example
 * ```ts
 * // agent/instrumentation/evlog.ts
 * import { otelIntegration } from 'eve/instrumentation/otel'
 * import { evlogRuntimeContext } from 'evlog/eve'
 *
 * export default otelIntegration({ runtimeContext: evlogRuntimeContext })
 * ```
 *
 * Before 0.84, spread it into the `step.started` result of your own
 * `agent/instrumentation.ts`, or use {@link defineEvlogInstrumentation}:
 *
 * @example
 * ```ts
 * // agent/instrumentation.ts
 * import { defineInstrumentation } from 'eve/instrumentation'
 * import { evlogRuntimeContext } from 'evlog/eve'
 *
 * export default defineInstrumentation({
 *   setup: ({ agentName }) => registerOTel({ serviceName: agentName }),
 *   events: {
 *     'step.started': (input) => {
 *       const principalId = input.session.auth.current?.principalId
 *       return {
 *         runtimeContext: {
 *           ...evlogRuntimeContext(input),
 *           // Omitted rather than blank: a backend reads an empty id as an id.
 *           ...(principalId ? { posthog_distinct_id: principalId } : {}),
 *         },
 *       }
 *     },
 *   },
 * })
 * ```
 *
 * Returns `undefined` outside a tracked turn — spreading that adds nothing,
 * which is the point.
 */
export function evlogRuntimeContext(input: EveModelAttemptInput): Record<string, string> | undefined {
  if (!input.turn) return undefined
  const state = getTurnState(input.session.id, input.turn.id)
  if (!state) return undefined

  return {
    'evlog.request_id': turnKey(state.sessionId, state.turnId),
    'evlog.session_id': state.sessionId,
  }
}

/** The input of `step.started`, the instrumentation event of eve before 0.84. */
interface V26StepStartedInput {
  readonly session: { readonly id: string }
  readonly turn: { readonly id: string }
}

function buildInstrumentationContext(
  input: V26StepStartedInput,
): { runtimeContext: Record<string, string> } | undefined {
  const runtimeContext = evlogRuntimeContext(input)
  return runtimeContext ? { runtimeContext } : undefined
}

/**
 * Create an eve instrumentation definition that stamps evlog's turn identity
 * onto the AI SDK telemetry spans, for eve before 0.84.
 *
 * Export the result as the default export of `agent/instrumentation.ts`. Every
 * model-call span — and its children — then carries `evlog.request_id`, the
 * same value the wide event reports as `requestId`, so a trace in Braintrust,
 * Datadog or Agent Runs joins to the wide event in your drain, and back.
 *
 * `eve.` is reserved for framework-owned context, so evlog writes under
 * `evlog.`. Passing no `setup` leaves OpenTelemetry export untouched: eve keeps
 * recording its local traces and only the runtime context is added.
 *
 * @example
 * ```ts
 * // agent/instrumentation.ts
 * import { defineEvlogInstrumentation } from 'evlog/eve'
 * import { registerOTel } from '@vercel/otel'
 *
 * export default defineEvlogInstrumentation({
 *   setup: ({ agentName }) => registerOTel({ serviceName: agentName }),
 * })
 * ```
 *
 * eve 0.84 and later no longer emit `step.started`: the runtime context comes
 * from an OTel integration instead, see {@link evlogRuntimeContext}.
 *
 * @deprecated Removed in evlog v3. Use the `evlog()` lifecycle provider.
 */
export function defineEvlogInstrumentation(
  options: EvlogEveInstrumentationOptions = {},
): InstrumentationDefinition {
  // eve's typings describe v27 events only; this provider serves the eve versions that emit `step.started`.
  const events = { 'step.started': buildInstrumentationContext } as unknown as InstrumentationEvents
  return defineInstrumentation({
    ...(options.functionId !== undefined ? { functionId: options.functionId } : {}),
    ...(options.recordInputs !== undefined ? { recordInputs: options.recordInputs } : {}),
    ...(options.recordOutputs !== undefined ? { recordOutputs: options.recordOutputs } : {}),
    ...(options.traceChannelRequests !== undefined
      ? { traceChannelRequests: options.traceChannelRequests }
      : {}),
    ...(options.setup !== undefined ? { setup: options.setup } : {}),
    events,
  })
}

/** @internal Simulates eve tool execution where AsyncLocalStorage did not propagate. */
export function detachActiveTurnLoggerForTests(): void {
  const logger = turnLoggerStorage.getStore()
  if (logger) unbindTurnLogger(logger)
}

/** @internal Resets module state between unit tests. Clears turn maps, session context, and the Eve init flag. */
export function resetEvlogEveForTests(): void {
  clearAsyncLocalStorage(turnLoggerStorage)
  turnStates().clear()
  activeTurnBySession().clear()
  sessionTurnIds().clear()
  sessionSnapshots().clear()
  sessionPendingActions().clear()
  sessionApprovals().clear()
  sessionRollups().clear()
  sessionRuntimes().clear()
  sessionAuthorizationStarts().clear()
  sessionInteractions().clear()
  setEveInitialized(false)
  delete (globalThis as typeof globalThis & { [EVE_GLOBAL_STATE]?: EveGlobalState })[EVE_GLOBAL_STATE]
}

export type { ModelCost } from '../ai/index'
