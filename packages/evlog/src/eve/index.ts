import { AsyncLocalStorage } from 'node:async_hooks'
import { defineHook, type HookContext, type HookDefinition } from 'eve/hooks'
import {
  defineInstrumentation,
  type InstrumentationDefinition,
  type InstrumentationSetupContext,
  type InstrumentationStepStartedEventInput,
  type InstrumentationStepStartedEventResult,
} from 'eve/instrumentation'
import type { AuditableLogger } from '../audit'
import type { AIToolExecution, AIEventData, ModelCost } from '../ai/index'
import { initLogger, isLoggerInitialized, isLoggerLocked, noopLogger } from '../logger'
import type { LoggerConfig } from '../types'
import type { BaseEvlogOptions, MiddlewareLoggerOptions } from '../shared/middleware'
import { createMiddlewareLogger, pickBaseEvlogOptions } from '../shared/middleware'
import {
  bindAsyncLocalStorage,
  clearAsyncLocalStorage,
  createSharedEnterWithStorage,
} from '../shared/asyncStorageScope'

const DEFAULT_MAX_SESSIONS = 256

/** Client-closed-request status used for turns eve cancelled before a terminal outcome. */
const CANCELLED_STATUS = 499

/**
 * How much of the user message from `message.received` reaches the wide event.
 *
 * - `omit` — no message content at all (default)
 * - `preview` — text truncated to `messagePreviewLength`, attachments reduced
 *   to their type and media type
 * - `full` — text and attachment parts verbatim
 */
export type EveMessageMode = 'omit' | 'preview' | 'full'

/** Options for {@link defineEvlogHook}. */
export interface EvlogEveOptions extends BaseEvlogOptions {
  /** Passed to {@link initLogger} on the first hook invocation. */
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
   * @deprecated Use {@link EvlogEveOptions.message}. `true` maps to `'omit'`,
   * `false` to `'preview'`.
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
   * Emit one extra wide event per session on `session.completed` /
   * `session.failed`, rolling up every turn of that session. Default `false`.
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
  status: 'called' | 'started' | 'completed'
  output?: string
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
  if (state.costModel) data.model = state.costModel
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
    const summary: Record<string, unknown> = { type: record.type }
    if (typeof record.mediaType === 'string') summary.mediaType = record.mediaType
    return summary
  })
}

function ensureInit(options: EvlogEveOptions): void {
  const state = getEveGlobalState()
  if (options.maxSessions !== undefined) {
    state.maxSessions = options.maxSessions
  }
  if (isEveInitialized()) return
  if (!isLoggerLocked() && !isLoggerInitialized()) {
    initLogger(options.init ?? { env: { service: 'eve-agent' } })
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
    const modelId = sessionRuntimes().get(state.sessionId)?.model
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

/**
 * Create an eve stream hook that emits one evlog wide event per agent turn.
 *
 * Export the result as the default export of `agent/hooks/evlog.ts`. eve
 * auto-discovers hook files; evlog maps turn lifecycle events to a wide event
 * with AI usage, tool executions, and your drain/enrich/keep pipeline.
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
 */
export function defineEvlogHook(options: EvlogEveOptions = {}): HookDefinition {
  const messageMode = resolveMessageMode(options)
  const previewLength = options.messagePreviewLength ?? DEFAULT_MESSAGE_PREVIEW_LENGTH

  return defineHook({
    events: {
      'session.started'(event, ctx) {
        runSafe(() => {
          ensureInit(options)
          const { runtime, invocation } = event.data
          if (!runtime && !invocation) return
          touchSession(ctx.session.id)
          sessionRuntimes().set(ctx.session.id, {
            ...(runtime?.eveVersion ? { version: runtime.eveVersion } : {}),
            ...(runtime?.agentId ? { agentId: runtime.agentId } : {}),
            ...(runtime?.modelId ? { model: runtime.modelId } : {}),
            ...(runtime?.build?.gitSha ? { gitSha: runtime.build.gitSha } : {}),
            ...(runtime?.build?.gitBranch ? { gitBranch: runtime.build.gitBranch } : {}),
            ...(runtime?.build?.deployedAt ? { deployedAt: runtime.build.deployedAt } : {}),
            ...(invocation?.name ? { subagent: invocation.name } : {}),
          })
        })
      },

      'turn.started'(event, ctx) {
        try {
          ensureInit(options)
          const state = getOrCreateTurnState(ctx.session.id, event.data.turnId, options, ctx)
          state?.logger.set({
            eve: { turnSequence: event.data.sequence },
          })
          if (state) bindTurnLogger(state.logger)
        } catch (err) {
          console.error('[evlog] eve hook handler failed:', err)
        }
      },

      'message.received'(event, ctx) {
        runSafe(() => {
          if (messageMode === 'omit') return
          const state = getTurnState(ctx.session.id, event.data.turnId)
          if (!state) return
          const { message, parts } = event.data
          const full = messageMode === 'full'
          state.logger.set({
            message: {
              received: full ? message : truncateMessage(message, previewLength),
              ...(parts?.length
                ? { parts: full ? parts.map(p => ({ ...p })) : summarizeMessageParts(parts) }
                : {}),
            },
          })
        })
      },

      'step.started'(event, ctx) {
        runSafe(() => {
          const state = getTurnState(ctx.session.id, event.data.turnId)
          if (!state) return
          state.accumulator.stepStartedAt = Date.now()
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
          const { usage } = event.data
          if (usage) {
            acc.inputTokens += usage.inputTokens ?? 0
            acc.outputTokens += usage.outputTokens ?? 0
            acc.cacheReadTokens += usage.cacheReadTokens ?? 0
            acc.cacheWriteTokens += usage.cacheWriteTokens ?? 0
            acc.costUsd += usage.costUsd ?? 0
            if (usage.inputTokens !== undefined) {
              attributeToolInputTokens(acc, usage.inputTokens)
            }
          }
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
          const acc = state.accumulator
          acc.responseChars += event.data.message.length
          if (messageMode === 'omit') return
          acc.response = messageMode === 'full'
            ? event.data.message
            : truncateMessage(event.data.message, previewLength)
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
          state.accumulator.toolExecutions.push(execution)
          if (!rejected) state.accumulator.pendingToolAttribution.push(execution)
        })
      },

      'subagent.called'(event, ctx) {
        runSafe(() => {
          const state = getTurnState(ctx.session.id, event.data.turnId)
          if (!state) return
          state.accumulator.subagents.push({
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

      async 'turn.completed'(event, ctx) {
        try {
          await finishTurn(ctx.session.id, event.data.turnId, { status: 200 })
        } catch (err) {
          console.error('[evlog] eve hook handler failed:', err)
        }
      },

      async 'turn.cancelled'(event, ctx) {
        try {
          const state = getTurnState(ctx.session.id, event.data.turnId)
          state?.logger.set({ eve: { cancelled: true } })
          await finishTurn(ctx.session.id, event.data.turnId, { status: CANCELLED_STATUS })
        } catch (err) {
          console.error('[evlog] eve hook handler failed:', err)
        }
      },

      async 'session.completed'(_event, ctx) {
        try {
          await finishOpenTurns(ctx.session.id, { status: 200 })
          if (options.sessionEvent) {
            await emitSessionEvent(ctx.session.id, options, ctx, { status: 200 })
          }
        } catch (err) {
          console.error('[evlog] eve hook handler failed:', err)
        } finally {
          clearSessionState(ctx.session.id)
        }
      },

      async 'session.failed'(event, ctx) {
        try {
          const error = new Error(event.data.message)
          error.name = event.data.code
          await finishOpenTurns(ctx.session.id, { error, status: 500 }, (state) => {
            state.logger.set({
              eve: {
                failure: {
                  code: event.data.code,
                  message: event.data.message,
                  ...(event.data.details ? { details: event.data.details } : {}),
                },
              },
            })
          })
          if (options.sessionEvent) {
            await emitSessionEvent(ctx.session.id, options, ctx, { error, status: 500 })
          }
        } catch (err) {
          console.error('[evlog] eve hook handler failed:', err)
        } finally {
          clearSessionState(ctx.session.id)
        }
      },

      async 'turn.failed'(event, ctx) {
        try {
          const state = getTurnState(ctx.session.id, event.data.turnId)
          state?.logger.set({
            eve: {
              failure: {
                code: event.data.code,
                message: event.data.message,
                ...(event.data.details ? { details: event.data.details } : {}),
              },
            },
          })
          const error = new Error(event.data.message)
          error.name = event.data.code
          await finishTurn(ctx.session.id, event.data.turnId, { error, status: 500 })
        } catch (err) {
          console.error('[evlog] eve hook handler failed:', err)
        }
      },
    },
  })
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

/**
 * Per-model-call attributes linking an AI SDK span back to the evlog wide event
 * for the same turn, ready to spread into your own runtime context.
 *
 * Use this when the agent already has an `agent/instrumentation.ts` — from
 * `eve add instrumentation/...` or written by hand. Every observability
 * integration writes that one file, so evlog contributes attributes to yours
 * rather than asking you to nest it inside a wrapper:
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
 * which is the point. {@link defineEvlogInstrumentation} is the shortcut for an
 * agent with no other instrumentation to compose with.
 */
export function evlogRuntimeContext(
  input: InstrumentationStepStartedEventInput,
): Record<string, string> | undefined {
  const state = getTurnState(input.session.id, input.turn.id)
  if (!state) return undefined

  return {
    'evlog.request_id': turnKey(state.sessionId, state.turnId),
    'evlog.session_id': state.sessionId,
  }
}

function buildInstrumentationContext(
  input: InstrumentationStepStartedEventInput,
): InstrumentationStepStartedEventResult | undefined {
  const runtimeContext = evlogRuntimeContext(input)
  return runtimeContext ? { runtimeContext } : undefined
}

/**
 * Create an eve instrumentation definition that stamps evlog's turn identity
 * onto the AI SDK telemetry spans.
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
 * This is the shortcut for an agent whose instrumentation is evlog's alone. It
 * owns the file's `events` slot, so once another integration needs it — PostHog
 * links spans to the initiating user there — drop the wrapper and spread
 * {@link evlogRuntimeContext} into your own `defineInstrumentation` instead.
 */
export function defineEvlogInstrumentation(
  options: EvlogEveInstrumentationOptions = {},
): InstrumentationDefinition {
  return defineInstrumentation({
    ...(options.functionId !== undefined ? { functionId: options.functionId } : {}),
    ...(options.recordInputs !== undefined ? { recordInputs: options.recordInputs } : {}),
    ...(options.recordOutputs !== undefined ? { recordOutputs: options.recordOutputs } : {}),
    ...(options.traceChannelRequests !== undefined
      ? { traceChannelRequests: options.traceChannelRequests }
      : {}),
    ...(options.setup !== undefined ? { setup: options.setup } : {}),
    events: {
      'step.started': buildInstrumentationContext,
    },
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
  setEveInitialized(false)
  delete (globalThis as typeof globalThis & { [EVE_GLOBAL_STATE]?: EveGlobalState })[EVE_GLOBAL_STATE]
}

export type { ModelCost } from '../ai/index'
