import type { SessionView } from 'eve/events'
import { calls, interactions, reply, runs, turn } from 'eve/events'
import type { EvlogEveRecord, EvlogEveToolRule } from '../extension'
import type { RecordedError } from './state'

const REPLY_PREVIEW_LENGTH = 200

export interface TurnInput {
  view: SessionView
  sessionId: string
  turnId: string
  agent: string
  channel?: string
  record: EvlogEveRecord
  tools: Record<string, EvlogEveToolRule>
  /** The evlog errors built during the turn, matched to failed calls by message when the match is unambiguous. */
  created: RecordedError[]
}

function resolveRule(name: string, record: EvlogEveRecord, rules: Record<string, EvlogEveToolRule>): { input: boolean, output: boolean } | false {
  const io = record === 'debug'
  const key = name in rules
    ? name
    : Object.keys(rules)
      .filter(pattern => pattern.endsWith('*') && name.startsWith(pattern.slice(0, -1)))
      .sort((a, b) => b.length - a.length)[0]
  const rule = key === undefined ? true : rules[key]
  if (rule === false) return false
  if (rule === true) return { input: io, output: io }
  return { input: rule.input ?? io, output: rule.output ?? io }
}

/**
 * The evlog error a failed call threw. eve keeps only the call's message, so
 * the error is found by it. When several failed calls share the message and
 * the errors built with it differ, or fewer were built than calls failed,
 * which call threw which is unknown, and no call gets one.
 */
function thrownBy(message: string, failed: Array<{ error?: { message: string } }>, created: RecordedError[]): RecordedError | undefined {
  const candidates = created.filter(error => error.message === message)
  const last = candidates.at(-1)
  if (!last) return undefined
  const sharing = failed.filter(call => call.error?.message === message).length
  if (sharing <= 1) return last
  if (candidates.length < sharing) return undefined
  return candidates.every(error => error.code === last.code && error.why === last.why && error.fix === last.fix) ? last : undefined
}

function durationMs(timing: { startedAt?: string, endedAt?: string }): number | undefined {
  if (!timing.startedAt || !timing.endedAt) return undefined
  return Date.parse(timing.endedAt) - Date.parse(timing.startedAt)
}

/**
 * The fields of one turn's event, read from the session view eve stores. No
 * process memory is involved, so a turn resumed elsewhere is recorded whole.
 */
export function turnFields(input: TurnInput): { fields: Record<string, unknown>, durationMs?: number, status: number, failures: Array<{ name?: string, message: string }> } {
  const { view, sessionId, turnId, agent, record } = input
  const observed = turn(view, turnId)
  const turnRuns = runs(view, { turnId })

  const usage = { input_tokens: 0, output_tokens: 0, cache_read: 0, cache_write: 0, cost: 0 }
  for (const run of turnRuns) {
    usage.input_tokens += run.usage?.inputTokens ?? 0
    usage.output_tokens += run.usage?.outputTokens ?? 0
    usage.cache_read += run.usage?.cacheReadTokens ?? 0
    usage.cache_write += run.usage?.cacheWriteTokens ?? 0
    usage.cost += run.usage?.costUsd ?? 0
  }
  const models = [...new Set(turnRuns.flatMap(run => run.modelId ? [run.modelId] : []))]
  const finishReasons = turnRuns.flatMap(run => run.finishReason ? [run.finishReason] : [])

  const turnCalls = calls(view, { turnId }).filter(call => call.kind !== 'control')
  const failed = turnCalls.filter(call => call.state === 'failed')
  const tools = record === 'minimal'
    ? []
    : turnCalls.flatMap((call) => {
      const rule = resolveRule(call.name, record, input.tools)
      if (!rule) return []
      const duration = durationMs(call)
      const created = call.error && thrownBy(call.error.message, failed, input.created)
      return [
        {
          call_id: call.callId,
          name: call.name,
          kind: call.kind,
          ...(duration !== undefined && { duration_ms: duration }),
          success: call.state !== 'failed',
          ...(call.outcome && { outcome: call.outcome }),
          ...(call.error && { error: call.error.message }),
          ...(created && {
            ...(created.code && { code: created.code }),
            ...(created.why && { why: created.why }),
            ...(created.fix && { fix: created.fix }),
          }),
          ...(rule.input && call.input !== undefined && { input: call.input }),
          ...(rule.output && call.output !== undefined && { output: call.output }),
        }
      ]
    })

  const approvals = record === 'minimal'
    ? []
    : interactions(view).filter(i => i.turnId === turnId && i.request.kind === 'approval')
  const duration = observed ? durationMs(observed) : undefined
  const replyText = record === 'debug'
    ? reply(view, turnId).flatMap(part => typeof part.value === 'string' ? [part.value] : []).join('')
    : ''

  const fields = {
    eve: {
      sessionId,
      turnId,
      ...(observed?.outcome && { outcome: observed.outcome }),
      ...(input.channel && { channel: input.channel }),
      ...(failed.length > 0 && { failedCalls: failed.length }),
      ...(approvals.length > 0 && {
        approvals: approvals.map(a => ({ tool: a.call?.name, outcome: a.outcome ?? a.status })),
      }),
      ...(replyText && {
        reply: replyText.length > REPLY_PREVIEW_LENGTH ? `${replyText.slice(0, REPLY_PREVIEW_LENGTH)}…` : replyText,
      }),
    },
    gen_ai: {
      operation: { name: 'invoke_agent' },
      agent: { name: agent },
      conversation: { id: sessionId },
      calls: turnRuns.length,
      ...(models.length === 1 && { request: { model: models[0] } }),
      ...(models.length > 1 && { request: { model: models.at(-1), models } }),
      ...(finishReasons.length > 0 && { response: { finish_reasons: finishReasons } }),
      usage: {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        total_tokens: usage.input_tokens + usage.output_tokens,
        ...(usage.cache_read > 0 && { cache_read: { input_tokens: usage.cache_read } }),
        ...(usage.cache_write > 0 && { cache_write: { input_tokens: usage.cache_write } }),
        ...(usage.cost > 0 && { cost: Math.round(usage.cost * 1_000_000) / 1_000_000 }),
      },
      ...(tools.length > 0 && { tools }),
    },
  }
  const outcome = observed?.outcome
  const status = outcome === 'failed' ? 500 : outcome === 'cancelled' ? 499 : 200
  const failures = failed.flatMap(call => call.error ? [{ name: call.error.name, message: call.error.message }] : [])
  return { fields, status, failures, ...(duration !== undefined && { durationMs: duration }) }
}
