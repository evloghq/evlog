import type { AIFieldData, GenAIEventData } from './index'

/**
 * Convert the accumulator's fields to the `gen_ai` event shape.
 * Shared by `evlog/ai` and `evlog/eve`; not a package export.
 */
export function toGenAIField(data: AIFieldData): GenAIEventData {
  const usage: GenAIEventData['usage'] = {
    input_tokens: data.inputTokens,
    output_tokens: data.outputTokens,
    total_tokens: data.totalTokens,
  }
  if (data.cacheReadTokens !== undefined) usage.cache_read = { input_tokens: data.cacheReadTokens }
  if (data.cacheWriteTokens !== undefined) usage.cache_write = { input_tokens: data.cacheWriteTokens }
  if (data.reasoningTokens !== undefined) usage.reasoning = { output_tokens: data.reasoningTokens }
  if (data.costUsd !== undefined) usage.cost = data.costUsd
  if (data.estimatedCost !== undefined) usage.estimated_cost = data.estimatedCost

  const out: GenAIEventData = { calls: data.calls, usage }
  if (data.provider) out.provider = { name: data.provider }
  if (data.model || data.models) {
    out.request = {}
    if (data.model) out.request.model = data.model
    if (data.models) out.request.models = data.models
  }
  const response: NonNullable<GenAIEventData['response']> = {}
  if (data.responseId) response.id = data.responseId
  if (data.finishReasons?.length) response.finish_reasons = data.finishReasons
  if (data.msToFirstChunk !== undefined) response.time_to_first_chunk = data.msToFirstChunk / 1000
  if (data.msToFinish !== undefined) response.duration_ms = data.msToFinish
  if (data.tokensPerSecond !== undefined) response.tokens_per_second = data.tokensPerSecond
  if (Object.keys(response).length > 0) out.response = response

  if (data.steps !== undefined) out.steps = data.steps
  if (data.stepsUsage) {
    out.steps_usage = data.stepsUsage.map(s => ({
      model: s.model,
      input_tokens: s.inputTokens,
      output_tokens: s.outputTokens,
      ...(s.toolCalls ? { tool_calls: s.toolCalls } : {}),
    }))
  }
  if (data.toolCalls) out.tool_calls = data.toolCalls
  if (data.tools) {
    out.tools = data.tools.map(t => ({
      name: t.name,
      duration_ms: t.durationMs,
      success: t.success,
      ...(t.error !== undefined ? { error: t.error } : {}),
      ...(t.inputTokens !== undefined ? { input_tokens: t.inputTokens } : {}),
    }))
  }
  if (data.prompt !== undefined) out.input = { text: data.prompt }
  if (data.output !== undefined) out.output = { text: data.output }
  if (data.error) out.error = data.error
  if (data.totalDurationMs !== undefined) out.duration_ms = data.totalDurationMs
  if (data.embedding) out.embedding = data.embedding
  return out
}
