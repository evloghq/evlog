import { formatDuration } from '../utils'

/** One line of the pretty tree, with optional child lines. */
export interface TreeEntry {
  key: string
  value: string
  children?: string[]
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === 'object' && !Array.isArray(val)
}

function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(6)}`
  if (cost < 1) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(2)}`
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
  duration_ms: number
  success: boolean
  error?: string
}

function isToolUsageEntry(value: unknown): value is ToolUsageEntry {
  return isPlainObject(value)
    && typeof value.name === 'string'
    && typeof value.duration_ms === 'number'
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

function child(value: unknown, key: string): Record<string, unknown> {
  return isPlainObject(value) && isPlainObject(value[key]) ? value[key] as Record<string, unknown> : {}
}

/** The `gen_ai` field of a wide event as tree lines, under one `gen_ai` header. */
export function buildAIEntries(ai: Record<string, unknown>): TreeEntry[] {
  const entries: TreeEntry[] = []
  const request = child(ai, 'request')
  const provider = child(ai, 'provider')
  const usage = child(ai, 'usage')
  const response = child(ai, 'response')

  const headerParts: string[] = []
  if (request.model) {
    let m = String(request.model)
    if (provider.name) m += ` (${provider.name})`
    headerParts.push(m)
  }
  const calls = asNumber(ai.calls)
  if (calls) headerParts.push(`${calls} call${calls > 1 ? 's' : ''}`)
  const steps = asNumber(ai.steps)
  if (steps !== undefined && steps > 1) headerParts.push(`${steps} steps`)
  const agent = child(ai, 'agent').name
  if (typeof agent === 'string') headerParts.push(`agent ${agent}`)
  const conversation = child(ai, 'conversation').id
  if (typeof conversation === 'string') headerParts.push(`conversation ${conversation}`)
  entries.push({ key: 'gen_ai', value: headerParts.join(' · ') })

  const inputTokens = asNumber(usage.input_tokens)
  const outputTokens = asNumber(usage.output_tokens)
  const totalTokens = asNumber(usage.total_tokens)
  if (inputTokens !== undefined && outputTokens !== undefined) {
    let tokLine = `${inputTokens} in → ${outputTokens} out`
    if (totalTokens) tokLine += ` (${totalTokens} total)`
    const extras: string[] = []
    const cacheRead = asNumber(child(usage, 'cache_read').input_tokens)
    const cacheWrite = asNumber(child(usage, 'cache_write').input_tokens)
    const reasoning = asNumber(child(usage, 'reasoning').output_tokens)
    if (cacheRead) extras.push(`${cacheRead} cache read`)
    if (cacheWrite) extras.push(`${cacheWrite} cache write`)
    if (reasoning) extras.push(`${reasoning} reasoning`)
    if (extras.length) tokLine += ` · ${extras.join(' · ')}`
    entries.push({ key: 'gen_ai.usage', value: tokLine })
  }

  const firstChunk = asNumber(response.time_to_first_chunk)
  const msFinish = asNumber(response.duration_ms)
  const tps = asNumber(response.tokens_per_second)
  if (firstChunk !== undefined || msFinish !== undefined) {
    const parts: string[] = []
    if (firstChunk !== undefined) parts.push(`${formatDuration(firstChunk * 1000)} to first chunk`)
    if (msFinish !== undefined) parts.push(`${formatDuration(msFinish)} total`)
    let streamLine = parts.join(' → ')
    if (tps) streamLine += ` · ${tps} tok/s`
    entries.push({ key: 'gen_ai.response', value: streamLine })
  }

  const cost = asNumber(usage.cost) ?? asNumber(usage.estimated_cost)
  if (cost !== undefined) {
    entries.push({ key: 'gen_ai.usage.cost', value: asNumber(usage.cost) === undefined ? `~${formatCost(cost)}` : formatCost(cost) })
  }

  const totalDurationMs = asNumber(ai.duration_ms)
  if (totalDurationMs !== undefined) {
    entries.push({ key: 'gen_ai.duration', value: formatDuration(totalDurationMs) })
  }

  // Tools: what ran (tools) merged with what the model asked for (tool_calls)
  const toolCalls = Array.isArray(ai.tool_calls) ? ai.tool_calls : undefined
  const tools = asToolUsageArray(ai.tools)
  const toolCallEntries = toolCalls ? asToolCallArray(toolCalls) : undefined
  const hasInputs = toolCallEntries !== undefined && toolCallEntries.length > 0

  if (tools?.length) {
    const children = tools.map((t, idx) => {
      const mark = t.success ? '✓' : '✗'
      let line = `${t.name} ${formatDuration(t.duration_ms)} ${mark}`
      if (t.error) line += ` ${t.error}`
      if (hasInputs && toolCallEntries && idx < toolCallEntries.length) {
        const tc = toolCallEntries[idx]
        const inputStr = serializeToolInput(tc.input)
        const truncated = inputStr.length > 100 ? `${inputStr.slice(0, 100)}…` : inputStr
        line += ` ${truncated}`
      }
      return line
    })
    entries.push({ key: 'gen_ai.tools', value: '', children })
  } else if (toolCalls?.length) {
    if (toolCallEntries?.length) {
      const children = toolCallEntries.map((tc) => {
        const inputStr = serializeToolInput(tc.input)
        const truncated = inputStr.length > 100 ? `${inputStr.slice(0, 100)}…` : inputStr
        return `${tc.name}(${truncated})`
      })
      entries.push({ key: 'gen_ai.tools', value: '', children })
    } else {
      const names = asStringArray(toolCalls)
      if (names?.length) entries.push({ key: 'gen_ai.tools', value: names.join(', ') })
    }
  }

  const stepsUsage = Array.isArray(ai.steps_usage)
    ? ai.steps_usage.filter(isPlainObject)
    : undefined
  if (stepsUsage?.length) {
    const firstModel = stepsUsage[0]?.model
    const allSameModel = firstModel !== undefined && stepsUsage.every(s => s.model === firstModel)
    const children = stepsUsage.map((s) => {
      const prefix = allSameModel ? '' : `${String(s.model)} `
      let line = `${prefix}${s.input_tokens} in → ${s.output_tokens} out`
      const stepTools = asStringArray(s.tool_calls)
      if (stepTools?.length) line += ` [${stepTools.join(', ')}]`
      return line
    })
    entries.push({ key: 'gen_ai.steps', value: '', children })
  } else if (steps !== undefined && steps > 1) {
    entries.push({ key: 'gen_ai.steps', value: String(steps) })
  }

  // Captured prompt and output: one console line per message block,
  // truncated here. The full text stays in the wide event for drains.
  const promptLines = asCapturedLines(child(ai, 'input').text)
  if (promptLines) entries.push({ key: 'gen_ai.input', value: '', children: promptLines })
  const outputLines = asCapturedLines(child(ai, 'output').text)
  if (outputLines) entries.push({ key: 'gen_ai.output', value: '', children: outputLines })

  const embedding = isPlainObject(ai.embedding) ? ai.embedding : undefined
  if (embedding) {
    const parts: string[] = []
    if (embedding.model) parts.push(String(embedding.model))
    parts.push(`${embedding.tokens} tokens`)
    if (embedding.dimensions) parts.push(`${embedding.dimensions}d`)
    if (embedding.count) parts.push(`${embedding.count} items`)
    entries.push({ key: 'gen_ai.embedding', value: parts.join(' · ') })
  }

  const reasons = asStringArray(response.finish_reasons)
  if (reasons?.length) entries.push({ key: 'gen_ai.response.finish_reasons', value: reasons.join(', ') })
  if (ai.error) entries.push({ key: 'gen_ai.error', value: String(ai.error) })
  if (response.id) entries.push({ key: 'gen_ai.response.id', value: String(response.id) })

  return entries
}
