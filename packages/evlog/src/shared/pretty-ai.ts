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

export function buildAIEntries(ai: Record<string, unknown>): TreeEntry[] {
  const entries: TreeEntry[] = []

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

  const estimatedCost = asNumber(ai.estimatedCost)
  if (estimatedCost !== undefined) {
    entries.push({ key: 'ai.cost', value: formatCost(estimatedCost) })
  }

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
