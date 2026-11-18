import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Prompt,
  LanguageModelV4FinishReason,
  LanguageModelV4StreamPart,
} from '@ai-sdk/provider'
import type { LanguageModel } from 'ai'
import type { RequestLogger } from '../../src/types'
import { createAILogger, createAIMiddleware, createEvlogIntegration, type AILogger, type AIMetadata, type EvlogTelemetry } from '../../src/ai'
import { createLogger, mergeWideEventFields } from '../../src/logger'
import { defined } from '../helpers/defined'
import { withFakeTimers } from '../helpers/timers'

interface MockLogger extends RequestLogger {
  setCalls: Array<Record<string, unknown>>
  /**
   * Cumulative state assembled from every `log.set()` payload using the
   * same merge semantics as evlog's wide-event pipeline. Assert against
   * this when verifying what consumers will see in the drain.
   */
  merged: Record<string, unknown>
}

function createMockLogger(): MockLogger {
  const setCalls: Array<Record<string, unknown>> = []
  const merged: Record<string, unknown> = {}
  return {
    setCalls,
    merged,
    set: vi.fn((data: Record<string, unknown>) => {
      const cloned = structuredClone(data)
      setCalls.push(cloned)
      mergeWideEventFields(merged, structuredClone(data))
    }),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    setLevel: vi.fn(),
    emit: vi.fn(() => null),
    getContext: vi.fn(() => ({})),
  }
}

function createMockUsage(overrides?: Partial<{
  inputTotal: number
  outputTotal: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
}>) {
  return {
    inputTokens: {
      total: overrides?.inputTotal ?? 100,
      noCache: undefined,
      cacheRead: overrides?.cacheRead ?? undefined,
      cacheWrite: overrides?.cacheWrite ?? undefined,
    },
    outputTokens: {
      total: overrides?.outputTotal ?? 50,
      text: undefined,
      reasoning: overrides?.reasoning ?? undefined,
    },
  }
}

type GenerateResult = Awaited<ReturnType<LanguageModelV4['doGenerate']>>
type StreamResult = Awaited<ReturnType<LanguageModelV4['doStream']>>

/** AI SDK generate results require many fields — partial mocks cast once here. */
function asGenerateResult(value: Record<string, unknown>): GenerateResult {
  return value as GenerateResult
}

function asStreamResult(value: Record<string, unknown>): StreamResult {
  return value as StreamResult
}

type MockLanguageModel = {
  specificationVersion: 'v3' | 'v4'
  provider: string
  modelId: string
  supportedUrls: Record<string, RegExp[]>
  doGenerate: ReturnType<typeof vi.fn>
  doStream: ReturnType<typeof vi.fn>
}

function createMockModel(
  overrides?: Partial<{ provider: string, modelId: string, specificationVersion: 'v3' | 'v4' }>,
): MockLanguageModel {
  return {
    specificationVersion: overrides?.specificationVersion ?? 'v4',
    provider: overrides?.provider ?? 'anthropic',
    modelId: overrides?.modelId ?? 'claude-sonnet-4.6',
    supportedUrls: {},
    doGenerate: vi.fn(),
    doStream: vi.fn(),
  }
}

/** wrap() returns LanguageModel (string | V2 | V3 | V4); tests need the V4 instance API. */
function wrapMock(ai: AILogger, model: MockLanguageModel): LanguageModelV4 {
  return ai.wrap(model as LanguageModel) as LanguageModelV4
}

function createMockCallOptions(prompt: LanguageModelV4Prompt = []): LanguageModelV4CallOptions {
  return { prompt } as LanguageModelV4CallOptions
}

function createFinishReason(unified: LanguageModelV4FinishReason['unified'] = 'stop'): LanguageModelV4FinishReason {
  return { unified, raw: undefined }
}

function makeReadableStream(chunks: LanguageModelV4StreamPart[]): ReadableStream<LanguageModelV4StreamPart> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk)
      }
      controller.close()
    },
  })
}

async function consumeStream(stream: ReadableStream<LanguageModelV4StreamPart>): Promise<LanguageModelV4StreamPart[]> {
  const reader = stream.getReader()
  const result: LanguageModelV4StreamPart[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    result.push(value)
  }
  return result
}

function getLastAiData(log: MockLogger): AIMetadata {
  return defined(log.setCalls.at(-1)?.gen_ai, 'last gen_ai payload') as AIMetadata
}

function callIntegrationOnStart(integration: EvlogTelemetry, event?: Record<string, unknown>) {
  defined(integration.onStart, 'onStart')({
    model: { provider: 'anthropic', modelId: 'claude-sonnet-4.6' },
    maxRetries: 0,
    ...event,
  })
}

/** createEvlogIntegration ignores the onFinish/onEnd payload — cast kept in one place. */
function callIntegrationOnFinish(integration: EvlogTelemetry) {
  if (integration.onFinish) {
    integration.onFinish({})
    return
  }
  defined(integration.onEnd, 'onEnd')({})
}

function callIntegrationOnEnd(integration: EvlogTelemetry) {
  defined(integration.onEnd, 'onEnd')({})
}

function callIntegrationOnToolCallFinish(
  integration: EvlogTelemetry,
  input: {
    toolName: string
    durationMs: number
    success: boolean
    output?: unknown
    error?: unknown
  },
) {
  const base = {
    toolCall: { toolName: input.toolName, toolCallId: 'tc1', input: {} },
    durationMs: input.durationMs,
    messages: [],
    stepNumber: undefined,
    model: undefined,
    abortSignal: undefined,
    functionId: undefined,
    metadata: undefined,
    experimental_context: undefined,
  }

  const event = input.success
    ? { ...base, success: true as const, output: input.output ?? {} }
    : { ...base, success: false as const, error: input.error ?? new Error('failed') }

  defined(integration.onToolCallFinish, 'onToolCallFinish')(event)
}

function callIntegrationOnToolExecutionEnd(
  integration: EvlogTelemetry,
  input: {
    toolName: string
    toolExecutionMs: number
    success: boolean
    output?: unknown
    error?: unknown
  },
) {
  const toolOutput = input.success
    ? { type: 'tool-result' as const, output: input.output ?? {} }
    : { type: 'tool-error' as const, error: input.error ?? new Error('failed') }

  defined(integration.onToolExecutionEnd, 'onToolExecutionEnd')({
    callId: 'call-1',
    toolCall: { toolName: input.toolName, toolCallId: 'tc1', input: {} },
    toolExecutionMs: input.toolExecutionMs,
    toolContext: undefined,
    toolOutput,
    messages: [],
  })
}

function callIntegrationOnEmbedEnd(
  integration: EvlogTelemetry,
  input: {
    modelId?: string
    tokens?: number
    dimensions?: number
    count?: number
  } = {},
) {
  const count = input.count ?? 1
  defined(integration.onEmbedEnd, 'onEmbedEnd')({
    callId: 'embed-1',
    embedCallId: 'embed-call-1',
    operationId: 'ai.embed.doEmbed',
    provider: 'openai',
    modelId: input.modelId ?? 'text-embedding-3-small',
    values: Array.from({ length: count }, (_, i) => `value-${i}`),
    embeddings: [{ length: input.dimensions ?? 1536 }],
    usage: { tokens: input.tokens ?? 10 },
  })
}

function callIntegrationOnAbort(integration: EvlogTelemetry, reason?: unknown) {
  defined(integration.onAbort, 'onAbort')({
    callId: 'call-1',
    steps: [],
    ...(reason !== undefined ? { reason } : {}),
  })
}

function callIntegrationOnError(integration: EvlogTelemetry, error: unknown) {
  defined(integration.onError, 'onError')(error)
}

describe('createAILogger', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('wrap - wrapGenerate', () => {
    it('captures basic token usage from doGenerate', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()

      const wrappedModel = wrapMock(ai, model)

      const mockResult = {
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage({ inputTotal: 200, outputTotal: 800 }),
        response: { modelId: 'claude-sonnet-4.6' },
      }

      vi.mocked(model.doGenerate).mockResolvedValue(asGenerateResult(mockResult))
      await wrappedModel.doGenerate(createMockCallOptions())

      expect(log.set).toHaveBeenCalled()
      const lastSetCall = log.setCalls[log.setCalls.length - 1]
      const aiData = lastSetCall.gen_ai as AIMetadata

      expect(aiData.calls).toBe(1)
      expect(aiData.request?.model).toBe('claude-sonnet-4.6')
      expect(aiData.provider?.name).toBe('anthropic')
      expect(aiData.usage.input_tokens).toBe(200)
      expect(aiData.usage.output_tokens).toBe(800)
      expect(aiData.usage.total_tokens).toBe(1000)
      expect(aiData.response?.finish_reasons).toEqual(['stop'])
    })

    it('captures cache and reasoning token breakdown', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      const mockResult = {
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage({ inputTotal: 500, outputTotal: 300, cacheRead: 150, cacheWrite: 50, reasoning: 100 }),
        response: { modelId: 'claude-sonnet-4.6' },
      }

      vi.mocked(model.doGenerate).mockResolvedValue(asGenerateResult(mockResult))
      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = getLastAiData(log)
      expect(aiData.usage.cache_read?.input_tokens).toBe(150)
      expect(aiData.usage.cache_write?.input_tokens).toBe(50)
      expect(aiData.usage.reasoning?.output_tokens).toBe(100)
    })

    it('omits cache/reasoning fields when zero', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      const mockResult = {
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage({ inputTotal: 100, outputTotal: 50 }),
        response: { modelId: 'claude-sonnet-4.6' },
      }

      vi.mocked(model.doGenerate).mockResolvedValue(asGenerateResult(mockResult))
      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = getLastAiData(log)
      expect(aiData.usage.cache_read?.input_tokens).toBeUndefined()
      expect(aiData.usage.cache_write?.input_tokens).toBeUndefined()
      expect(aiData.usage.reasoning?.output_tokens).toBeUndefined()
    })

    it('captures tool calls from content', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      const mockResult = {
        content: [
          { type: 'tool-call', toolCallId: 'tc1', toolName: 'searchWeb', args: '{}' },
          { type: 'text', id: 't1', text: 'hello' },
          { type: 'tool-call', toolCallId: 'tc2', toolName: 'calculatePrice', args: '{}' },
        ],
        finishReason: createFinishReason('tool-calls'),
        usage: createMockUsage(),
        response: { modelId: 'claude-sonnet-4.6' },
      }

      vi.mocked(model.doGenerate).mockResolvedValue(asGenerateResult(mockResult))
      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = getLastAiData(log)
      expect(aiData.tool_calls).toEqual(['searchWeb', 'calculatePrice'])
      expect(aiData.response?.finish_reasons).toEqual(['tool-calls'])
    })

    it('uses response.modelId over model.modelId', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel({ modelId: 'claude-sonnet-4.6' })
      const wrappedModel = wrapMock(ai, model)

      const mockResult = {
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage(),
        response: { modelId: 'claude-sonnet-4.6-20250514' },
      }

      vi.mocked(model.doGenerate).mockResolvedValue(asGenerateResult(mockResult))
      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = getLastAiData(log)
      expect(aiData.request?.model).toBe('claude-sonnet-4.6-20250514')
    })

    it('falls back to model.modelId when response has no modelId', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel({ modelId: 'claude-sonnet-4.6' })
      const wrappedModel = wrapMock(ai, model)

      const mockResult = {
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage(),
      }

      vi.mocked(model.doGenerate).mockResolvedValue(asGenerateResult(mockResult))
      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = getLastAiData(log)
      expect(aiData.request?.model).toBe('claude-sonnet-4.6')
    })
  })

  describe('wrap - wrapStream', () => {
    it('captures usage from stream finish chunk', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      const chunks: LanguageModelV4StreamPart[] = [
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'Hello ' },
        { type: 'text-delta', id: 't1', delta: 'world' },
        { type: 'text-end', id: 't1' },
        {
          type: 'finish',
          finishReason: createFinishReason(),
          usage: createMockUsage({ inputTotal: 300, outputTotal: 150 }),
        },
      ]

      vi.mocked(model.doStream).mockResolvedValue({
        stream: makeReadableStream(chunks),
      })

      const result = await wrappedModel.doStream(createMockCallOptions())
      await consumeStream(result.stream)

      const aiData = getLastAiData(log)
      expect(aiData.usage.input_tokens).toBe(300)
      expect(aiData.usage.output_tokens).toBe(150)
      expect(aiData.usage.total_tokens).toBe(450)
      expect(aiData.response?.finish_reasons).toEqual(['stop'])
    })

    it('captures streaming metrics', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      const chunks: LanguageModelV4StreamPart[] = [
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'Hi' },
        { type: 'text-end', id: 't1' },
        { type: 'finish', finishReason: createFinishReason(), usage: createMockUsage() },
      ]

      vi.mocked(model.doStream).mockResolvedValue({
        stream: makeReadableStream(chunks),
      })

      const result = await wrappedModel.doStream(createMockCallOptions())
      await consumeStream(result.stream)

      const aiData = getLastAiData(log)
      expect(aiData.response?.time_to_first_chunk).toBeTypeOf('number')
      expect(aiData.response?.time_to_first_chunk).toBeGreaterThanOrEqual(0)
      expect(aiData.response?.duration_ms).toBeTypeOf('number')
      expect(aiData.response?.duration_ms).toBeGreaterThanOrEqual(0)
    })

    it('captures modelId from response-metadata chunk', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel({ modelId: 'claude-sonnet-4.6' })
      const wrappedModel = wrapMock(ai, model)

      const chunks: LanguageModelV4StreamPart[] = [
        { type: 'response-metadata', modelId: 'claude-sonnet-4.6-20250514' } as LanguageModelV4StreamPart,
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'Hi' },
        { type: 'text-end', id: 't1' },
        { type: 'finish', finishReason: createFinishReason(), usage: createMockUsage() },
      ]

      vi.mocked(model.doStream).mockResolvedValue({
        stream: makeReadableStream(chunks),
      })

      const result = await wrappedModel.doStream(createMockCallOptions())
      await consumeStream(result.stream)

      const aiData = getLastAiData(log)
      expect(aiData.request?.model).toBe('claude-sonnet-4.6-20250514')
    })

    it('passes stream chunks through unchanged', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      const inputChunks: LanguageModelV4StreamPart[] = [
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'Hello' },
        { type: 'text-end', id: 't1' },
        { type: 'finish', finishReason: createFinishReason(), usage: createMockUsage() },
      ]

      vi.mocked(model.doStream).mockResolvedValue({
        stream: makeReadableStream(inputChunks),
      })

      const result = await wrappedModel.doStream(createMockCallOptions())
      const outputChunks = await consumeStream(result.stream)

      expect(outputChunks).toHaveLength(inputChunks.length)
      expect(outputChunks.map(c => c.type)).toEqual(['text-start', 'text-delta', 'text-end', 'finish'])
    })
  })

  describe('accumulation', () => {
    it('accumulates tokens across multiple generate calls', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      vi.mocked(model.doGenerate)
        .mockResolvedValueOnce({
          content: [],
          finishReason: createFinishReason(),
          usage: createMockUsage({ inputTotal: 100, outputTotal: 50 }),
          response: { modelId: 'claude-sonnet-4.6' },
        })
        .mockResolvedValueOnce({
          content: [],
          finishReason: createFinishReason(),
          usage: createMockUsage({ inputTotal: 200, outputTotal: 100 }),
          response: { modelId: 'claude-sonnet-4.6' },
        })

      await wrappedModel.doGenerate(createMockCallOptions())
      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = getLastAiData(log)
      expect(aiData.calls).toBe(2)
      expect(aiData.usage.input_tokens).toBe(300)
      expect(aiData.usage.output_tokens).toBe(150)
      expect(aiData.usage.total_tokens).toBe(450)
    })

    it('tracks multiple models in gen_ai.request.models', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)

      const gemini = createMockModel({ provider: 'google', modelId: 'gemini-3-flash' })
      const claude = createMockModel({ provider: 'anthropic', modelId: 'claude-sonnet-4.6' })

      const wrappedGemini = wrapMock(ai, gemini)
      const wrappedClaude = wrapMock(ai, claude)

      vi.mocked(gemini.doGenerate).mockResolvedValue({
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage({ inputTotal: 100, outputTotal: 50 }),
        response: { modelId: 'gemini-3-flash' },
      })

      vi.mocked(claude.doGenerate).mockResolvedValue({
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage({ inputTotal: 200, outputTotal: 100 }),
        response: { modelId: 'claude-sonnet-4.6' },
      })

      await wrappedGemini.doGenerate(createMockCallOptions())
      await wrappedClaude.doGenerate(createMockCallOptions())

      const aiData = getLastAiData(log)
      expect(aiData.request?.model).toBe('claude-sonnet-4.6')
      expect(aiData.request?.models).toEqual(['gemini-3-flash', 'claude-sonnet-4.6'])
      expect(aiData.usage.input_tokens).toBe(300)
      expect(aiData.usage.output_tokens).toBe(150)
    })

    it('does not duplicate models in gen_ai.request.models', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      const mockResult = {
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage(),
        response: { modelId: 'claude-sonnet-4.6' },
      }

      vi.mocked(model.doGenerate).mockResolvedValue(asGenerateResult(mockResult))

      await wrappedModel.doGenerate(createMockCallOptions())
      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = getLastAiData(log)
      expect(aiData.request?.model).toBe('claude-sonnet-4.6')
      expect(aiData.request?.models).toBeUndefined()
    })

    it('does not grow array fields quadratically across multi-step runs', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      const tools = ['list-pages', 'get-page', 'get-page', 'get-page', 'get-page', 'get-page']

      const doGenerate = vi.mocked(model.doGenerate)
      for (const toolName of tools) {
        doGenerate.mockResolvedValueOnce({
          content: [{ type: 'tool-call', toolCallId: `tc-${toolName}`, toolName, args: '{}' }],
          finishReason: createFinishReason('tool-calls'),
          usage: createMockUsage({ inputTotal: 100, outputTotal: 20 }),
          response: { modelId: 'claude-sonnet-4.6' },
        })
        await wrappedModel.doGenerate(createMockCallOptions())
      }

      const merged = log.merged.gen_ai as AIMetadata
      expect((merged.tool_calls as string[])).toEqual(tools)
      expect((merged.steps_usage as unknown[])).toHaveLength(tools.length)
      expect(merged.steps).toBe(tools.length)
      expect(merged.response?.finish_reasons).toEqual(tools.map(() => 'tool-calls'))

      // Each flush should ship at most a single new tool call, not the full
      // cumulative array — guarding against the quadratic regression.
      const totalToolCallEntries = log.setCalls.reduce((sum, call) => {
        const genAi = call.gen_ai as { tool_calls?: unknown[] } | undefined
        return sum + (genAi?.tool_calls?.length ?? 0)
      }, 0)
      expect(totalToolCallEntries).toBe(tools.length)
    })
  })

  describe('gateway provider resolution', () => {
    it('resolves provider from gateway modelId', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel({ provider: 'gateway', modelId: 'google/gemini-3-flash' })
      const wrappedModel = wrapMock(ai, model)

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage(),
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = getLastAiData(log)
      expect(aiData.provider?.name).toBe('google')
      expect(aiData.request?.model).toBe('gemini-3-flash')
    })

    it('uses response.modelId for gateway resolution when available', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel({ provider: 'gateway', modelId: 'anthropic/claude-sonnet-4.6' })
      const wrappedModel = wrapMock(ai, model)

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage(),
        response: { modelId: 'anthropic/claude-sonnet-4.6-20250514' },
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = getLastAiData(log)
      expect(aiData.provider?.name).toBe('anthropic')
      expect(aiData.request?.model).toBe('claude-sonnet-4.6-20250514')
    })

    it('keeps non-gateway provider as-is', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel({ provider: 'anthropic', modelId: 'claude-sonnet-4.6' })
      const wrappedModel = wrapMock(ai, model)

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage(),
        response: { modelId: 'claude-sonnet-4.6' },
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = getLastAiData(log)
      expect(aiData.provider?.name).toBe('anthropic')
      expect(aiData.request?.model).toBe('claude-sonnet-4.6')
    })

    it('resolves provider in stream mode', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel({ provider: 'gateway', modelId: 'anthropic/claude-sonnet-4.6' })
      const wrappedModel = wrapMock(ai, model)

      const chunks: LanguageModelV4StreamPart[] = [
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'Hi' },
        { type: 'text-end', id: 't1' },
        { type: 'finish', finishReason: createFinishReason(), usage: createMockUsage() },
      ]

      vi.mocked(model.doStream).mockResolvedValue({
        stream: makeReadableStream(chunks),
      })

      const result = await wrappedModel.doStream(createMockCallOptions())
      await consumeStream(result.stream)

      const aiData = getLastAiData(log)
      expect(aiData.provider?.name).toBe('anthropic')
      expect(aiData.request?.model).toBe('claude-sonnet-4.6')
    })
  })

  describe('string model support', () => {
    it('accepts a string model via wrap()', () => {
      const log = createMockLogger()
      const ai = createAILogger(log)

      const wrappedModel = ai.wrap('anthropic/claude-sonnet-4.6') as LanguageModelV4
      expect(wrappedModel).toBeDefined()
      expect(wrappedModel.specificationVersion).toBe('v4')
    })
  })

  describe('tokens_per_second', () => {
    it('computes tokens_per_second when stream takes measurable time', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      const chunks: LanguageModelV4StreamPart[] = [
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'Hi' },
        { type: 'text-end', id: 't1' },
        { type: 'finish', finishReason: createFinishReason(), usage: createMockUsage({ outputTotal: 500 }) },
      ]

      vi.mocked(model.doStream).mockImplementation(async () => {
        await new Promise(r => setTimeout(r, 20))
        return { stream: makeReadableStream(chunks) }
      })

      const result = await wrappedModel.doStream(createMockCallOptions())
      await consumeStream(result.stream)

      const aiData = getLastAiData(log)
      expect(aiData.response?.duration_ms).toBeGreaterThan(0)
      expect(aiData.response?.tokens_per_second).toBeTypeOf('number')
      expect(aiData.response?.tokens_per_second).toBeGreaterThan(0)
    })

    it('omits tokens_per_second when stream finishes instantly', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      const chunks: LanguageModelV4StreamPart[] = [
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'Hi' },
        { type: 'text-end', id: 't1' },
        { type: 'finish', finishReason: createFinishReason(), usage: createMockUsage({ outputTotal: 500 }) },
      ]

      vi.mocked(model.doStream).mockResolvedValue({
        stream: makeReadableStream(chunks),
      })

      const result = await wrappedModel.doStream(createMockCallOptions())
      await consumeStream(result.stream)

      const aiData = getLastAiData(log)
      if (aiData.response?.duration_ms === 0) {
        expect(aiData.response?.tokens_per_second).toBeUndefined()
      }
    })
  })

  describe('error capture', () => {
    it('captures error from doGenerate failure', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      vi.mocked(model.doGenerate).mockRejectedValue(new Error('API rate limit exceeded'))

      await expect(wrappedModel.doGenerate(createMockCallOptions())).rejects.toThrow('API rate limit exceeded')

      const aiData = getLastAiData(log)
      expect(aiData.error).toBe('API rate limit exceeded')
      expect(aiData.response?.finish_reasons).toEqual(['error'])
      expect(aiData.calls).toBe(1)
    })

    it('captures error from doStream failure', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      vi.mocked(model.doStream).mockRejectedValue(new Error('Connection timeout'))

      await expect(wrappedModel.doStream(createMockCallOptions())).rejects.toThrow('Connection timeout')

      const aiData = getLastAiData(log)
      expect(aiData.error).toBe('Connection timeout')
      expect(aiData.response?.finish_reasons).toEqual(['error'])
      expect(aiData.calls).toBe(1)
    })

    it('captures error from stream error chunk', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      const chunks: LanguageModelV4StreamPart[] = [
        { type: 'text-start', id: 't1' },
        { type: 'error', error: new Error('Content filter triggered') },
        { type: 'finish', finishReason: createFinishReason('content-filter'), usage: createMockUsage() },
      ]

      vi.mocked(model.doStream).mockResolvedValue({
        stream: makeReadableStream(chunks),
      })

      const result = await wrappedModel.doStream(createMockCallOptions())
      await consumeStream(result.stream)

      const aiData = getLastAiData(log)
      expect(aiData.error).toBe('Content filter triggered')
    })
  })

  describe('captureEmbed', () => {
    it('captures embedding token usage', () => {
      const log = createMockLogger()
      const ai = createAILogger(log)

      ai.captureEmbed({ usage: { tokens: 42 } })

      const aiData = getLastAiData(log)
      expect(aiData.calls).toBe(1)
      expect(aiData.usage.input_tokens).toBe(42)
      expect(aiData.usage.output_tokens).toBe(0)
      expect(aiData.usage.total_tokens).toBe(42)
    })

    it('accumulates with language model calls', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      ai.captureEmbed({ usage: { tokens: 30 } })

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage({ inputTotal: 200, outputTotal: 100 }),
        response: { modelId: 'claude-sonnet-4.6' },
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = getLastAiData(log)
      expect(aiData.calls).toBe(2)
      expect(aiData.usage.input_tokens).toBe(230)
      expect(aiData.usage.output_tokens).toBe(100)
      expect(aiData.usage.total_tokens).toBe(330)
    })
  })

  describe('toolInputs option', () => {
    it('does not capture tool call inputs by default', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'searchWeb', input: '{"query":"weather"}' }],
        finishReason: createFinishReason('tool-calls'),
        usage: createMockUsage(),
        response: { modelId: 'claude-sonnet-4.6' },
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = getLastAiData(log)
      expect(aiData.tool_calls).toEqual(['searchWeb'])
    })

    it('captures tool call inputs from doGenerate when enabled', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log, { toolInputs: true })
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [
          { type: 'tool-call', toolCallId: 'tc1', toolName: 'searchWeb', input: '{"query":"weather in SF"}' },
          { type: 'tool-call', toolCallId: 'tc2', toolName: 'calculate', input: '{"expression":"2+2"}' },
        ],
        finishReason: createFinishReason('tool-calls'),
        usage: createMockUsage(),
        response: { modelId: 'claude-sonnet-4.6' },
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = getLastAiData(log)
      expect(aiData.tool_calls).toEqual([
        { name: 'searchWeb', input: { query: 'weather in SF' } },
        { name: 'calculate', input: { expression: '2+2' } },
      ])
    })

    it('handles non-JSON tool inputs gracefully', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log, { toolInputs: true })
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'run', input: 'not-json' }],
        finishReason: createFinishReason('tool-calls'),
        usage: createMockUsage(),
        response: { modelId: 'claude-sonnet-4.6' },
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = getLastAiData(log)
      const toolCalls = aiData.tool_calls as Array<{ name: string, input: unknown }>
      expect(toolCalls[0].input).toBe('not-json')
    })

    it('captures tool call inputs from stream deltas when enabled', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log, { toolInputs: true })
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      const chunks: LanguageModelV4StreamPart[] = [
        { type: 'tool-input-start', id: 'tc1', toolName: 'searchWeb' },
        { type: 'tool-input-delta', id: 'tc1', delta: '{"que' },
        { type: 'tool-input-delta', id: 'tc1', delta: 'ry":"hello"}' },
        { type: 'tool-input-end', id: 'tc1' },
        { type: 'finish', finishReason: createFinishReason('tool-calls'), usage: createMockUsage() },
      ]

      vi.mocked(model.doStream).mockResolvedValue({
        stream: makeReadableStream(chunks),
      })

      const result = await wrappedModel.doStream(createMockCallOptions())
      await consumeStream(result.stream)

      const aiData = getLastAiData(log)
      expect(aiData.tool_calls).toEqual([{ name: 'searchWeb', input: { query: 'hello' } },])
    })

    it('does not capture stream tool inputs when toolInputs is false', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      const chunks: LanguageModelV4StreamPart[] = [
        { type: 'tool-input-start', id: 'tc1', toolName: 'searchWeb' },
        { type: 'tool-input-delta', id: 'tc1', delta: '{"query":"test"}' },
        { type: 'tool-input-end', id: 'tc1' },
        { type: 'finish', finishReason: createFinishReason('tool-calls'), usage: createMockUsage() },
      ]

      vi.mocked(model.doStream).mockResolvedValue({
        stream: makeReadableStream(chunks),
      })

      const result = await wrappedModel.doStream(createMockCallOptions())
      await consumeStream(result.stream)

      const aiData = getLastAiData(log)
      expect(aiData.tool_calls).toEqual(['searchWeb'])
    })

    it('handles object-type tool inputs from doGenerate', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log, { toolInputs: true })
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'run', input: { already: 'parsed' } }],
        finishReason: createFinishReason('tool-calls'),
        usage: createMockUsage(),
        response: { modelId: 'claude-sonnet-4.6' },
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = getLastAiData(log)
      const toolCalls = aiData.tool_calls as Array<{ name: string, input: unknown }>
      expect(toolCalls[0].input).toEqual({ already: 'parsed' })
    })

    it('truncates inputs exceeding maxLength', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log, { toolInputs: { maxLength: 20 } })
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'queryDB', input: '{"sql":"SELECT * FROM events WHERE status = 200 ORDER BY created_at DESC LIMIT 50"}' },],
        finishReason: createFinishReason('tool-calls'),
        usage: createMockUsage(),
        response: { modelId: 'claude-sonnet-4.6' },
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = getLastAiData(log)
      const inputs = aiData.tool_calls as Array<{ name: string, input: unknown }>
      expect(inputs[0].input).toBeTypeOf('string')
      expect((inputs[0].input as string).length).toBeLessThanOrEqual(21)
      expect((inputs[0].input as string).endsWith('…')).toBe(true)
    })

    it('does not truncate inputs within maxLength', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log, { toolInputs: { maxLength: 500 } })
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'search', input: '{"q":"hello"}' },],
        finishReason: createFinishReason('tool-calls'),
        usage: createMockUsage(),
        response: { modelId: 'claude-sonnet-4.6' },
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = getLastAiData(log)
      const inputs = aiData.tool_calls as Array<{ name: string, input: unknown }>
      expect(inputs[0].input).toEqual({ q: 'hello' })
    })

    it('applies transform function to inputs', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log, {
        toolInputs: {
          transform: (input, toolName) => {
            if (toolName === 'queryDB') {
              return { sql: '***' }
            }
            return input
          },
        },
      })
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [
          { type: 'tool-call', toolCallId: 'tc1', toolName: 'queryDB', input: '{"sql":"SELECT * FROM users"}' },
          { type: 'tool-call', toolCallId: 'tc2', toolName: 'search', input: '{"q":"hello"}' },
        ],
        finishReason: createFinishReason('tool-calls'),
        usage: createMockUsage(),
        response: { modelId: 'claude-sonnet-4.6' },
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = getLastAiData(log)
      const inputs = aiData.tool_calls as Array<{ name: string, input: unknown }>
      expect(inputs[0]).toEqual({ name: 'queryDB', input: { sql: '***' } })
      expect(inputs[1]).toEqual({ name: 'search', input: { q: 'hello' } })
    })

    it('applies transform then maxLength truncation', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log, {
        toolInputs: {
          transform: (input) => input,
          maxLength: 10,
        },
      })
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'search', input: '{"query":"a very long search query that exceeds the limit"}' },],
        finishReason: createFinishReason('tool-calls'),
        usage: createMockUsage(),
        response: { modelId: 'claude-sonnet-4.6' },
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = getLastAiData(log)
      const inputs = aiData.tool_calls as Array<{ name: string, input: unknown }>
      expect((inputs[0].input as string).endsWith('…')).toBe(true)
      expect((inputs[0].input as string).length).toBeLessThanOrEqual(11)
    })

    it('truncates stream tool inputs with maxLength', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log, { toolInputs: { maxLength: 15 } })
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      const chunks: LanguageModelV4StreamPart[] = [
        { type: 'tool-input-start', id: 'tc1', toolName: 'queryDB' },
        { type: 'tool-input-delta', id: 'tc1', delta: '{"sql":"SELECT * FROM events' },
        { type: 'tool-input-delta', id: 'tc1', delta: ' WHERE id = 1"}' },
        { type: 'tool-input-end', id: 'tc1' },
        { type: 'finish', finishReason: createFinishReason('tool-calls'), usage: createMockUsage() },
      ]

      vi.mocked(model.doStream).mockResolvedValue({
        stream: makeReadableStream(chunks),
      })

      const result = await wrappedModel.doStream(createMockCallOptions())
      await consumeStream(result.stream)

      const aiData = getLastAiData(log)
      const inputs = aiData.tool_calls as Array<{ name: string, input: unknown }>
      expect((inputs[0].input as string).endsWith('…')).toBe(true)
      expect((inputs[0].input as string).length).toBeLessThanOrEqual(16)
    })
  })

  describe('prompt and output capture', () => {
    const testPrompt: LanguageModelV4Prompt = [
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: [{ type: 'text', text: 'Hi there' }] },
    ]

    it('captures prompt and output on generate', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log, { prompt: true, output: true })
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      vi.mocked(model.doGenerate).mockResolvedValue(asGenerateResult({
        content: [{ type: 'text', text: 'Hello there' }],
        finishReason: createFinishReason(),
        usage: createMockUsage(),
        response: { modelId: 'claude-sonnet-4.6' },
      }))

      await wrappedModel.doGenerate(createMockCallOptions(testPrompt))

      const aiData = getLastAiData(log)
      expect(aiData.input?.text).toBe('[system] You are helpful\n\n[user] Hi there')
      expect(aiData.output?.text).toBe('Hello there')
    })

    it('does not capture prompt or output by default', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      vi.mocked(model.doGenerate).mockResolvedValue(asGenerateResult({
        content: [{ type: 'text', text: 'Hello there' }],
        finishReason: createFinishReason(),
        usage: createMockUsage(),
      }))

      await wrappedModel.doGenerate(createMockCallOptions(testPrompt))

      const aiData = getLastAiData(log)
      expect(aiData.input?.text).toBeUndefined()
      expect(aiData.output?.text).toBeUndefined()
    })

    it('captures only text parts as generate output', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log, { prompt: true, output: true })
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      vi.mocked(model.doGenerate).mockResolvedValue(asGenerateResult({
        content: [
          { type: 'text', text: 'Searching now' },
          { type: 'tool-call', toolCallId: 'tc1', toolName: 'search', input: {} },
        ],
        finishReason: createFinishReason('tool-calls'),
        usage: createMockUsage(),
      }))

      await wrappedModel.doGenerate(createMockCallOptions(testPrompt))

      const aiData = getLastAiData(log)
      expect(aiData.output?.text).toBe('Searching now')
    })

    it('marks non-text prompt parts', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log, { prompt: true, output: true })
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      const prompt: LanguageModelV4Prompt = [{ role: 'user', content: [{ type: 'text', text: 'Describe this' }, { type: 'file', data: { type: 'url', url: 'https://example.com/a.png' }, mediaType: 'image/png' }] },]

      vi.mocked(model.doGenerate).mockResolvedValue(asGenerateResult({
        content: [{ type: 'text', text: 'ok' }],
        finishReason: createFinishReason(),
        usage: createMockUsage(),
      }))

      await wrappedModel.doGenerate(createMockCallOptions(prompt))

      const aiData = getLastAiData(log)
      expect(aiData.input?.text).toBe('[user] Describe this\n[file]')
    })

    it('marks tool calls and tool results in the prompt', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log, { prompt: true, output: true })
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      const prompt: LanguageModelV4Prompt = [
        { role: 'user', content: [{ type: 'text', text: 'Search the docs' }] },
        { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'search', input: {} }] },
        { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'tc1', toolName: 'search', output: { type: 'text', value: 'found' } }] },
      ]

      vi.mocked(model.doGenerate).mockResolvedValue(asGenerateResult({
        content: [{ type: 'text', text: 'ok' }],
        finishReason: createFinishReason(),
        usage: createMockUsage(),
      }))

      await wrappedModel.doGenerate(createMockCallOptions(prompt))

      const aiData = getLastAiData(log)
      expect(aiData.input?.text).toBe('[user] Search the docs\n\n[assistant] [tool-call search]\n\n[tool] [tool-result search]')
    })

    it('truncates prompt and output with maxLength', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log, { prompt: { maxLength: 10 }, output: { maxLength: 10 } })
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      vi.mocked(model.doGenerate).mockResolvedValue(asGenerateResult({
        content: [{ type: 'text', text: 'a very long generated answer' }],
        finishReason: createFinishReason(),
        usage: createMockUsage(),
      }))

      await wrappedModel.doGenerate(createMockCallOptions([{ role: 'user', content: [{ type: 'text', text: 'a very long user question' }] }]))

      const aiData = getLastAiData(log)
      expect(aiData.input?.text).toBe('[user] a v…')
      expect(aiData.output?.text).toBe('a very lon…')
    })

    it('applies transform before maxLength', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log, {
        prompt: {
          maxLength: 100,
          transform: content => 'redacted',
        },
      })
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      vi.mocked(model.doGenerate).mockResolvedValue(asGenerateResult({
        content: [{ type: 'text', text: 'answer' }],
        finishReason: createFinishReason(),
        usage: createMockUsage(),
      }))

      await wrappedModel.doGenerate(createMockCallOptions(testPrompt))

      const aiData = getLastAiData(log)
      expect(aiData.input?.text).toBe('redacted')
      expect(aiData.output?.text).toBeUndefined()
    })

    it('captures prompt and streamed output', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log, { prompt: true, output: true })
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      const chunks: LanguageModelV4StreamPart[] = [
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'Hello ' },
        { type: 'text-delta', id: 't1', delta: 'world' },
        { type: 'text-end', id: 't1' },
        { type: 'finish', finishReason: createFinishReason(), usage: createMockUsage() },
      ]

      vi.mocked(model.doStream).mockResolvedValue({
        stream: makeReadableStream(chunks),
      })

      const result = await wrappedModel.doStream(createMockCallOptions(testPrompt))
      await consumeStream(result.stream)

      const aiData = getLastAiData(log)
      expect(aiData.input?.text).toBe('[system] You are helpful\n\n[user] Hi there')
      expect(aiData.output?.text).toBe('Hello world')
    })

    it('captures only the prompt when the output option is off', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log, { prompt: true })
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      vi.mocked(model.doGenerate).mockResolvedValue(asGenerateResult({
        content: [{ type: 'text', text: 'Hello there' }],
        finishReason: createFinishReason(),
        usage: createMockUsage(),
      }))

      await wrappedModel.doGenerate(createMockCallOptions(testPrompt))

      const aiData = getLastAiData(log)
      expect(aiData.input?.text).toBe('[system] You are helpful\n\n[user] Hi there')
      expect(aiData.output?.text).toBeUndefined()
    })

    it('captures only the output when the prompt option is off', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log, { output: true })
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      vi.mocked(model.doGenerate).mockResolvedValue(asGenerateResult({
        content: [{ type: 'text', text: 'Hello there' }],
        finishReason: createFinishReason(),
        usage: createMockUsage(),
      }))

      await wrappedModel.doGenerate(createMockCallOptions(testPrompt))

      const aiData = getLastAiData(log)
      expect(aiData.input?.text).toBeUndefined()
      expect(aiData.output?.text).toBe('Hello there')
    })

    it('keeps the first prompt and the last output across steps', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log, { prompt: true, output: true })
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      const secondPrompt: LanguageModelV4Prompt = [{ role: 'user', content: [{ type: 'text', text: 'second turn' }] },]

      vi.mocked(model.doGenerate)
        .mockResolvedValueOnce(asGenerateResult({
          content: [{ type: 'text', text: 'first answer' }],
          finishReason: createFinishReason(),
          usage: createMockUsage(),
        }))
        .mockResolvedValueOnce(asGenerateResult({
          content: [{ type: 'text', text: 'final answer' }],
          finishReason: createFinishReason(),
          usage: createMockUsage(),
        }))

      await wrappedModel.doGenerate(createMockCallOptions(testPrompt))
      await wrappedModel.doGenerate(createMockCallOptions(secondPrompt))

      const merged = log.merged.gen_ai as AIMetadata
      expect(merged.input?.text).toBe('[system] You are helpful\n\n[user] Hi there')
      expect(merged.output?.text).toBe('final answer')

      const metadata = ai.getMetadata()
      expect(metadata.input?.text).toBe('[system] You are helpful\n\n[user] Hi there')
      expect(metadata.output?.text).toBe('final answer')
    })
  })

  describe('response id', () => {
    it('captures the response id from doGenerate', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage(),
        response: { modelId: 'claude-sonnet-4.6', id: 'msg_01XFDUDYJgAACzvnptvVoYEL' },
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = getLastAiData(log)
      expect(aiData.response?.id).toBe('msg_01XFDUDYJgAACzvnptvVoYEL')
    })

    it('captures the response id from stream response-metadata', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      const chunks: LanguageModelV4StreamPart[] = [
        { type: 'response-metadata', id: 'msg_stream_123', modelId: 'claude-sonnet-4.6' } as LanguageModelV4StreamPart,
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'Hi' },
        { type: 'text-end', id: 't1' },
        { type: 'finish', finishReason: createFinishReason(), usage: createMockUsage() },
      ]

      vi.mocked(model.doStream).mockResolvedValue({
        stream: makeReadableStream(chunks),
      })

      const result = await wrappedModel.doStream(createMockCallOptions())
      await consumeStream(result.stream)

      const aiData = getLastAiData(log)
      expect(aiData.response?.id).toBe('msg_stream_123')
    })

    it('omits the response id when not provided', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage(),
        response: { modelId: 'claude-sonnet-4.6' },
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = getLastAiData(log)
      expect(aiData.response?.id).toBeUndefined()
    })
  })

  describe('steps_usage', () => {
    it('omits steps_usage for a single call', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage({ inputTotal: 100, outputTotal: 50 }),
        response: { modelId: 'claude-sonnet-4.6' },
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = getLastAiData(log)
      expect(aiData.steps_usage).toBeUndefined()
      expect(aiData.steps).toBeUndefined()
    })

    it('includes steps_usage for multiple calls', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      vi.mocked(model.doGenerate)
        .mockResolvedValueOnce({
          content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'search', input: '{}' }],
          finishReason: createFinishReason('tool-calls'),
          usage: createMockUsage({ inputTotal: 100, outputTotal: 50 }),
          response: { modelId: 'claude-sonnet-4.6' },
        })
        .mockResolvedValueOnce({
          content: [],
          finishReason: createFinishReason(),
          usage: createMockUsage({ inputTotal: 300, outputTotal: 200 }),
          response: { modelId: 'claude-sonnet-4.6' },
        })

      await wrappedModel.doGenerate(createMockCallOptions())
      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = getLastAiData(log)
      expect(aiData.steps).toBe(2)
      const stepsUsage = aiData.steps_usage as Array<Record<string, unknown>>
      expect(stepsUsage).toHaveLength(2)
      expect(stepsUsage[0]).toEqual({
        model: 'claude-sonnet-4.6',
        input_tokens: 100,
        output_tokens: 50,
        tool_calls: ['search'],
      })
      expect(stepsUsage[1]).toEqual({
        model: 'claude-sonnet-4.6',
        input_tokens: 300,
        output_tokens: 200,
      })
    })

    it('includes steps_usage with stream calls', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      const chunks1: LanguageModelV4StreamPart[] = [
        { type: 'tool-input-start', id: 'tc1', toolName: 'search' },
        { type: 'tool-input-delta', id: 'tc1', delta: '{}' },
        { type: 'tool-input-end', id: 'tc1' },
        { type: 'finish', finishReason: createFinishReason('tool-calls'), usage: createMockUsage({ inputTotal: 150, outputTotal: 80 }) },
      ]

      const chunks2: LanguageModelV4StreamPart[] = [
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'Done' },
        { type: 'text-end', id: 't1' },
        { type: 'finish', finishReason: createFinishReason(), usage: createMockUsage({ inputTotal: 400, outputTotal: 100 }) },
      ]

      vi.mocked(model.doStream)
        .mockResolvedValueOnce({ stream: makeReadableStream(chunks1) })
        .mockResolvedValueOnce({ stream: makeReadableStream(chunks2) })

      const result1 = await wrappedModel.doStream(createMockCallOptions())
      await consumeStream(result1.stream)
      const result2 = await wrappedModel.doStream(createMockCallOptions())
      await consumeStream(result2.stream)

      const aiData = getLastAiData(log)
      expect(aiData.steps).toBe(2)
      const stepsUsage = aiData.steps_usage as Array<Record<string, unknown>>
      expect(stepsUsage).toHaveLength(2)
      expect(stepsUsage[0]).toEqual({
        model: 'claude-sonnet-4.6',
        input_tokens: 150,
        output_tokens: 80,
        tool_calls: ['search'],
      })
      expect(stepsUsage[1]).toEqual({
        model: 'claude-sonnet-4.6',
        input_tokens: 400,
        output_tokens: 100,
      })
    })

    it('tracks per-step models in steps_usage', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const fast = createMockModel({ provider: 'anthropic', modelId: 'claude-haiku-4.5' })
      const smart = createMockModel({ provider: 'anthropic', modelId: 'claude-sonnet-4.6' })

      const wrappedFast = wrapMock(ai, fast)
      const wrappedSmart = wrapMock(ai, smart)

      vi.mocked(fast.doGenerate).mockResolvedValue({
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage({ inputTotal: 50, outputTotal: 20 }),
        response: { modelId: 'claude-haiku-4.5' },
      })

      vi.mocked(smart.doGenerate).mockResolvedValue({
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage({ inputTotal: 200, outputTotal: 100 }),
        response: { modelId: 'claude-sonnet-4.6' },
      })

      await wrappedFast.doGenerate(createMockCallOptions())
      await wrappedSmart.doGenerate(createMockCallOptions())

      const aiData = getLastAiData(log)
      const stepsUsage = aiData.steps_usage as Array<Record<string, unknown>>
      expect(stepsUsage[0].model).toBe('claude-haiku-4.5')
      expect(stepsUsage[1].model).toBe('claude-sonnet-4.6')
    })
  })

  describe('createAIMiddleware', () => {
    it('returns a valid middleware object', () => {
      const log = createMockLogger()
      const middleware = createAIMiddleware(log)

      expect(middleware).toBeDefined()
      expect(middleware.specificationVersion).toBe('v4')
      expect(middleware.wrapGenerate).toBeTypeOf('function')
      expect(middleware.wrapStream).toBeTypeOf('function')
    })

    it('captures data when used with wrapLanguageModel', async () => {
      const { wrapLanguageModel } = await import('ai')
      const log = createMockLogger()
      const middleware = createAIMiddleware(log, { toolInputs: true })
      const model = createMockModel()

      const wrappedModel = wrapLanguageModel({
        model: model as LanguageModelV4,
        middleware,
      })

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'search', input: '{"q":"test"}' }],
        finishReason: createFinishReason('tool-calls'),
        usage: createMockUsage({ inputTotal: 100, outputTotal: 50 }),
        response: { modelId: 'claude-sonnet-4.6', id: 'msg_abc' },
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = getLastAiData(log)
      expect(aiData.calls).toBe(1)
      expect(aiData.tool_calls).toEqual([{ name: 'search', input: { q: 'test' } }])
      expect(aiData.response?.id).toBe('msg_abc')
    })
  })

  describe('LanguageModelV4 wrap support (#406)', () => {
    it('wraps a native V4 model and captures generate usage', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel({ specificationVersion: 'v4', modelId: 'claude-sonnet-4.6' })
      const wrappedModel = wrapMock(ai, model)

      expect(wrappedModel.specificationVersion).toBe('v4')

      vi.mocked(model.doGenerate).mockResolvedValue(asGenerateResult({
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage({ inputTotal: 120, outputTotal: 40 }),
        response: { modelId: 'claude-sonnet-4.6' },
      }))

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = getLastAiData(log)
      expect(aiData.calls).toBe(1)
      expect(aiData.usage.input_tokens).toBe(120)
      expect(aiData.usage.output_tokens).toBe(40)
      expect(aiData.request?.model).toBe('claude-sonnet-4.6')
    })

    it('still accepts a V3 model and upgrades the wrapped result to V4', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel({ specificationVersion: 'v3' })
      const wrappedModel = wrapMock(ai, model)

      expect(wrappedModel.specificationVersion).toBe('v4')

      vi.mocked(model.doGenerate).mockResolvedValue(asGenerateResult({
        content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'search', input: '{"q":"v3"}' }],
        finishReason: createFinishReason('tool-calls'),
        usage: createMockUsage({ inputTotal: 80, outputTotal: 20 }),
        response: { modelId: 'claude-sonnet-4.6', id: 'msg_v3' },
      }))

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = getLastAiData(log)
      expect(aiData.calls).toBe(1)
      expect(aiData.usage.input_tokens).toBe(80)
      expect(aiData.response?.id).toBe('msg_v3')
    })

    it('captures V4 stream finish usage and TTFT', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel({ specificationVersion: 'v4' })
      const wrappedModel = wrapMock(ai, model)

      const chunks: LanguageModelV4StreamPart[] = [
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'hello' },
        { type: 'text-end', id: 't1' },
        { type: 'finish', finishReason: createFinishReason(), usage: createMockUsage({ inputTotal: 10, outputTotal: 5 }) },
      ]

      vi.mocked(model.doStream).mockResolvedValue(asStreamResult({
        stream: makeReadableStream(chunks),
      }))

      const { stream } = await wrappedModel.doStream(createMockCallOptions())
      await consumeStream(stream)

      const aiData = getLastAiData(log)
      expect(aiData.calls).toBe(1)
      expect(aiData.usage.input_tokens).toBe(10)
      expect(aiData.usage.output_tokens).toBe(5)
      expect(aiData.response?.time_to_first_chunk).toBeTypeOf('number')
    })
  })

  describe('captureEmbed v2', () => {
    it('captures embedding model info', () => {
      const log = createMockLogger()
      const ai = createAILogger(log)

      ai.captureEmbed({ usage: { tokens: 500 }, model: 'text-embedding-3-small', dimensions: 1536 })

      const aiData = log.setCalls[0].gen_ai as AIMetadata
      expect(aiData.calls).toBe(1)
      expect(aiData.usage.input_tokens).toBe(500)
      expect(aiData.embedding).toEqual({
        tokens: 500,
        model: 'text-embedding-3-small',
        dimensions: 1536,
      })
    })

    it('captures embedMany count', () => {
      const log = createMockLogger()
      const ai = createAILogger(log)

      ai.captureEmbed({ usage: { tokens: 2000 }, model: 'text-embedding-3-small', count: 10 })

      const aiData = log.setCalls[0].gen_ai as AIMetadata
      const embedding = defined(aiData.embedding, 'embedding')
      expect(embedding.count).toBe(10)
      expect(embedding.tokens).toBe(2000)
    })

    it('accumulates multiple embed calls', () => {
      const log = createMockLogger()
      const ai = createAILogger(log)

      ai.captureEmbed({ usage: { tokens: 100 }, model: 'text-embedding-3-small', dimensions: 1536, count: 5 })
      ai.captureEmbed({ usage: { tokens: 200 }, count: 10 })

      const aiData = getLastAiData(log)
      expect(aiData.calls).toBe(2)
      const embedding = defined(aiData.embedding, 'embedding')
      expect(embedding.tokens).toBe(300)
      expect(embedding.model).toBe('text-embedding-3-small')
      expect(embedding.dimensions).toBe(1536)
      expect(embedding.count).toBe(15)
    })

    it('is backward compatible with basic usage', () => {
      const log = createMockLogger()
      const ai = createAILogger(log)

      ai.captureEmbed({ usage: { tokens: 100 } })

      const aiData = log.setCalls[0].gen_ai as AIMetadata
      expect(aiData.calls).toBe(1)
      expect(aiData.usage.input_tokens).toBe(100)
      expect(aiData.embedding).toEqual({ tokens: 100 })
    })
  })

  describe('cost estimation', () => {
    it('computes usage.estimated_cost from pricing map', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log, {
        cost: {
          'claude-sonnet-4.6': { input: 3, output: 15 },
        },
      })
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage({ inputTotal: 1_000_000, outputTotal: 500_000 }),
        response: { modelId: 'claude-sonnet-4.6' },
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = getLastAiData(log)
      // 1M input * $3/1M = $3 + 500K output * $15/1M = $7.5 => $10.5
      expect(aiData.usage.estimated_cost).toBe(10.5)
    })

    it('omits usage.estimated_cost when model not in pricing map', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log, {
        cost: {
          'gpt-4o': { input: 2.5, output: 10 },
        },
      })
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage({ inputTotal: 100, outputTotal: 50 }),
        response: { modelId: 'claude-sonnet-4.6' },
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = getLastAiData(log)
      expect(aiData.usage.estimated_cost).toBeUndefined()
    })

    it('omits usage.estimated_cost when no pricing map provided', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage({ inputTotal: 100, outputTotal: 50 }),
        response: { modelId: 'claude-sonnet-4.6' },
      })

      await wrappedModel.doGenerate(createMockCallOptions())

      const aiData = getLastAiData(log)
      expect(aiData.usage.estimated_cost).toBeUndefined()
    })
  })

  describe('createEvlogIntegration', () => {
    it('returns a valid telemetry integration with v6 and v7 hooks', () => {
      const log = createMockLogger()
      const integration = createEvlogIntegration(log)

      expect(integration).toBeDefined()
      expect(integration.onStart).toBeTypeOf('function')
      expect(integration.onToolCallFinish).toBeTypeOf('function')
      expect(integration.onToolExecutionEnd).toBeTypeOf('function')
      expect(integration.onFinish).toBeTypeOf('function')
      expect(integration.onEnd).toBeTypeOf('function')
      expect(integration.onEmbedEnd).toBeTypeOf('function')
      expect(integration.onAbort).toBeTypeOf('function')
      expect(integration.onError).toBeTypeOf('function')
    })

    it('captures tool execution timing and success', () => {
      const log = createMockLogger()
      const integration = createEvlogIntegration(log)

      callIntegrationOnStart(integration)
      callIntegrationOnToolCallFinish(integration, {
        toolName: 'getWeather',
        durationMs: 150,
        success: true,
        output: { temperature: 22 },
      })
      callIntegrationOnFinish(integration)

      const aiData = getLastAiData(log)
      const tools = defined(aiData.tools, 'tools')
      expect(tools).toHaveLength(1)
      expect(tools[0]).toEqual({
        name: 'getWeather',
        duration_ms: 150,
        success: true,
      })
      expect(aiData.duration_ms).toBeTypeOf('number')
      expect(aiData.duration_ms).toBeGreaterThanOrEqual(0)
    })

    it('captures tool execution errors', () => {
      const log = createMockLogger()
      const integration = createEvlogIntegration(log)

      callIntegrationOnStart(integration)
      callIntegrationOnToolCallFinish(integration, {
        toolName: 'searchDB',
        durationMs: 50,
        success: false,
        error: new Error('Connection refused'),
      })
      callIntegrationOnFinish(integration)

      const aiData = getLastAiData(log)
      const tools = defined(aiData.tools, 'tools')
      expect(tools).toHaveLength(1)
      expect(tools[0]).toEqual({
        name: 'searchDB',
        duration_ms: 50,
        success: false,
        error: 'Connection refused',
      })
    })

    it('captures multiple tool executions', () => {
      const log = createMockLogger()
      const integration = createEvlogIntegration(log)

      callIntegrationOnStart(integration)
      callIntegrationOnToolCallFinish(integration, {
        toolName: 'getWeather',
        durationMs: 100,
        success: true,
        output: {},
      })
      callIntegrationOnToolCallFinish(integration, {
        toolName: 'searchDB',
        durationMs: 250,
        success: true,
        output: {},
      })
      callIntegrationOnFinish(integration)

      const aiData = getLastAiData(log)
      const tools = defined(aiData.tools, 'tools')
      expect(tools).toHaveLength(2)
      expect(tools[0].name).toBe('getWeather')
      expect(tools[1].name).toBe('searchDB')
    })

    it('shares state with AILogger when passed AILogger', async () => {
      const log = createMockLogger()
      const ai = createAILogger(log)
      const integration = createEvlogIntegration(ai)
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      vi.mocked(model.doGenerate).mockResolvedValue({
        content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'getWeather', input: '{}' }],
        finishReason: createFinishReason('tool-calls'),
        usage: createMockUsage({ inputTotal: 200, outputTotal: 100 }),
        response: { modelId: 'claude-sonnet-4.6' },
      })

      callIntegrationOnStart(integration)
      await wrappedModel.doGenerate(createMockCallOptions())
      callIntegrationOnToolCallFinish(integration, {
        toolName: 'getWeather',
        durationMs: 75,
        success: true,
        output: { temp: 20 },
      })
      callIntegrationOnFinish(integration)

      const aiData = getLastAiData(log)
      expect(aiData.calls).toBe(1)
      expect(aiData.request?.model).toBe('claude-sonnet-4.6')
      expect(aiData.usage.input_tokens).toBe(200)
      expect(aiData.usage.output_tokens).toBe(100)
      const tools = defined(aiData.tools, 'tools')
      expect(tools).toHaveLength(1)
      expect(tools[0].name).toBe('getWeather')
      expect(tools[0].duration_ms).toBe(75)
      expect(aiData.duration_ms).toBeTypeOf('number')
    })

    it('computes duration_ms from onStart to onFinish', async () => {
      await withFakeTimers(() => {
        const log = createMockLogger()
        const integration = createEvlogIntegration(log)

        callIntegrationOnStart(integration)
        vi.advanceTimersByTime(20)
        callIntegrationOnFinish(integration)

        const aiData = getLastAiData(log)
        expect(aiData.duration_ms).toBe(20)
      })
    })

    it('handles string errors from tool execution', () => {
      const log = createMockLogger()
      const integration = createEvlogIntegration(log)

      callIntegrationOnStart(integration)
      callIntegrationOnToolCallFinish(integration, {
        toolName: 'myTool',
        durationMs: 10,
        success: false,
        error: 'Something went wrong',
      })
      callIntegrationOnFinish(integration)

      const aiData = getLastAiData(log)
      const tools = defined(aiData.tools, 'tools')
      expect(tools[0].error).toBe('Something went wrong')
    })

    it('omits tools field when no tool executions', () => {
      const log = createMockLogger()
      const integration = createEvlogIntegration(log)

      callIntegrationOnStart(integration)
      callIntegrationOnFinish(integration)

      const aiData = getLastAiData(log)
      expect(aiData.tools).toBeUndefined()
    })

    describe('AI SDK v7 hooks', () => {
      it('captures tool execution via onToolExecutionEnd', () => {
        const log = createMockLogger()
        const integration = createEvlogIntegration(log)

        callIntegrationOnStart(integration)
        callIntegrationOnToolExecutionEnd(integration, {
          toolName: 'getWeather',
          toolExecutionMs: 150,
          success: true,
          output: { temperature: 22 },
        })
        callIntegrationOnEnd(integration)

        const aiData = getLastAiData(log)
        const tools = defined(aiData.tools, 'tools')
        expect(tools).toHaveLength(1)
        expect(tools[0]).toEqual({
          name: 'getWeather',
          duration_ms: 150,
          success: true,
        })
      })

      it('captures tool errors via onToolExecutionEnd', () => {
        const log = createMockLogger()
        const integration = createEvlogIntegration(log)

        callIntegrationOnStart(integration)
        callIntegrationOnToolExecutionEnd(integration, {
          toolName: 'searchDB',
          toolExecutionMs: 50,
          success: false,
          error: new Error('Connection refused'),
        })
        callIntegrationOnEnd(integration)

        const aiData = getLastAiData(log)
        const tools = defined(aiData.tools, 'tools')
        expect(tools[0]).toEqual({
          name: 'searchDB',
          duration_ms: 50,
          success: false,
          error: 'Connection refused',
        })
      })

      it('computes duration_ms from onStart to onEnd', async () => {
        await withFakeTimers(() => {
          const log = createMockLogger()
          const integration = createEvlogIntegration(log)

          callIntegrationOnStart(integration)
          vi.advanceTimersByTime(20)
          callIntegrationOnEnd(integration)

          const aiData = getLastAiData(log)
          expect(aiData.duration_ms).toBe(20)
        })
      })

      it('auto-captures embeddings via onEmbedEnd', () => {
        const log = createMockLogger()
        const integration = createEvlogIntegration(log)

        callIntegrationOnEmbedEnd(integration, {
          modelId: 'text-embedding-3-small',
          tokens: 42,
          dimensions: 1536,
          count: 3,
        })

        const aiData = getLastAiData(log)
        expect(aiData.calls).toBe(1)
        expect(aiData.usage.input_tokens).toBe(42)
        expect(aiData.embedding).toEqual({
          model: 'text-embedding-3-small',
          tokens: 42,
          dimensions: 1536,
          count: 3,
        })
      })

      it('records abort via onAbort', () => {
        const log = createMockLogger()
        const integration = createEvlogIntegration(log)

        callIntegrationOnStart(integration)
        callIntegrationOnAbort(integration, new Error('User cancelled'))

        const aiData = getLastAiData(log)
        expect(aiData.response?.finish_reasons).toEqual(['abort'])
        expect(aiData.error).toBe('User cancelled')
        expect(aiData.duration_ms).toBeTypeOf('number')
      })

      it('records unrecoverable errors via onError', () => {
        const log = createMockLogger()
        const integration = createEvlogIntegration(log)

        callIntegrationOnError(integration, new Error('Provider unavailable'))

        const aiData = getLastAiData(log)
        expect(aiData.error).toBe('Provider unavailable')
      })
    })
  })

  describe('public metadata API', () => {
    describe('getMetadata', () => {
      it('returns an empty snapshot before any activity', () => {
        const log = createMockLogger()
        const ai = createAILogger(log)

        const metadata = ai.getMetadata()
        expect(metadata).toEqual({
          calls: 0,
          usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        })
        expect(metadata.request?.model).toBeUndefined()
        expect(metadata.provider?.name).toBeUndefined()
      })

      it('returns the same shape as the wide event data', async () => {
        const log = createMockLogger()
        const ai = createAILogger(log, {
          cost: { 'claude-sonnet-4.6': { input: 3, output: 15 } },
        })
        const model = createMockModel()
        const wrappedModel = wrapMock(ai, model)

        vi.mocked(model.doGenerate).mockResolvedValue({
          content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'search', input: '{}' }],
          finishReason: createFinishReason('tool-calls'),
          usage: createMockUsage({ inputTotal: 1_000_000, outputTotal: 500_000 }),
          response: { modelId: 'claude-sonnet-4.6', id: 'msg_abc' },
        })

        await wrappedModel.doGenerate(createMockCallOptions())

        const aiData = getLastAiData(log)
        const metadata = ai.getMetadata()

        expect(metadata).toEqual(aiData)
        expect(metadata.calls).toBe(1)
        expect(metadata.request?.model).toBe('claude-sonnet-4.6')
        expect(metadata.provider?.name).toBe('anthropic')
        expect(metadata.usage.input_tokens).toBe(1_000_000)
        expect(metadata.usage.output_tokens).toBe(500_000)
        expect(metadata.usage.total_tokens).toBe(1_500_000)
        expect(metadata.usage.estimated_cost).toBe(10.5)
        expect(metadata.response?.id).toBe('msg_abc')
        expect(metadata.tool_calls).toEqual(['search'])
        expect(metadata.response?.finish_reasons).toEqual(['tool-calls'])
      })

      it('returns a fresh copy that does not mutate underlying state', async () => {
        const log = createMockLogger()
        const ai = createAILogger(log)
        const model = createMockModel()
        const wrappedModel = wrapMock(ai, model)

        vi.mocked(model.doGenerate).mockResolvedValue({
          content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'search', input: '{}' }],
          finishReason: createFinishReason('tool-calls'),
          usage: createMockUsage({ inputTotal: 100, outputTotal: 50 }),
          response: { modelId: 'claude-sonnet-4.6' },
        })

        await wrappedModel.doGenerate(createMockCallOptions())

        const first = ai.getMetadata()
        ;(first.tool_calls as string[]).push('mutated')
        first.calls = 999

        const second = ai.getMetadata()
        expect(second.calls).toBe(1)
        expect(second.tool_calls).toEqual(['search'])
      })

      it('updates after each step in a multi-step run', async () => {
        const log = createMockLogger()
        const ai = createAILogger(log)
        const model = createMockModel()
        const wrappedModel = wrapMock(ai, model)

        vi.mocked(model.doGenerate)
          .mockResolvedValueOnce({
            content: [],
            finishReason: createFinishReason(),
            usage: createMockUsage({ inputTotal: 100, outputTotal: 50 }),
            response: { modelId: 'claude-sonnet-4.6' },
          })
          .mockResolvedValueOnce({
            content: [],
            finishReason: createFinishReason(),
            usage: createMockUsage({ inputTotal: 200, outputTotal: 100 }),
            response: { modelId: 'claude-sonnet-4.6' },
          })

        await wrappedModel.doGenerate(createMockCallOptions())
        const afterStep1 = ai.getMetadata()
        expect(afterStep1.calls).toBe(1)
        expect(afterStep1.usage.total_tokens).toBe(150)

        await wrappedModel.doGenerate(createMockCallOptions())
        const afterStep2 = ai.getMetadata()
        expect(afterStep2.calls).toBe(2)
        expect(afterStep2.usage.total_tokens).toBe(450)
        expect(afterStep2.response?.finish_reasons).toEqual(['stop', 'stop'])
      })

      it('reflects embedding capture', () => {
        const log = createMockLogger()
        const ai = createAILogger(log)

        ai.captureEmbed({ usage: { tokens: 500 }, model: 'text-embedding-3-small', dimensions: 1536 })

        const metadata = ai.getMetadata()
        expect(metadata.calls).toBe(1)
        expect(metadata.usage.input_tokens).toBe(500)
        expect(metadata.embedding).toEqual({
          tokens: 500,
          model: 'text-embedding-3-small',
          dimensions: 1536,
        })
      })

      it('reflects errors from a failed generation', async () => {
        const log = createMockLogger()
        const ai = createAILogger(log)
        const model = createMockModel()
        const wrappedModel = wrapMock(ai, model)

        vi.mocked(model.doGenerate).mockRejectedValue(new Error('quota exceeded'))

        await expect(wrappedModel.doGenerate(createMockCallOptions())).rejects.toThrow('quota exceeded')

        const metadata = ai.getMetadata()
        expect(metadata.error).toBe('quota exceeded')
        expect(metadata.response?.finish_reasons).toEqual(['error'])
      })
    })

    describe('getEstimatedCost', () => {
      it('returns undefined without a cost map', async () => {
        const log = createMockLogger()
        const ai = createAILogger(log)
        const model = createMockModel()
        const wrappedModel = wrapMock(ai, model)

        vi.mocked(model.doGenerate).mockResolvedValue({
          content: [],
          finishReason: createFinishReason(),
          usage: createMockUsage({ inputTotal: 100, outputTotal: 50 }),
          response: { modelId: 'claude-sonnet-4.6' },
        })

        await wrappedModel.doGenerate(createMockCallOptions())
        expect(ai.getEstimatedCost()).toBeUndefined()
      })

      it('returns the same value as metadata.usage.estimated_cost', async () => {
        const log = createMockLogger()
        const ai = createAILogger(log, {
          cost: { 'claude-sonnet-4.6': { input: 3, output: 15 } },
        })
        const model = createMockModel()
        const wrappedModel = wrapMock(ai, model)

        vi.mocked(model.doGenerate).mockResolvedValue({
          content: [],
          finishReason: createFinishReason(),
          usage: createMockUsage({ inputTotal: 1_000_000, outputTotal: 500_000 }),
          response: { modelId: 'claude-sonnet-4.6' },
        })

        await wrappedModel.doGenerate(createMockCallOptions())

        expect(ai.getEstimatedCost()).toBe(10.5)
        expect(ai.getEstimatedCost()).toBe(ai.getMetadata().usage.estimated_cost)
      })

      it('returns undefined for an unpriced model', async () => {
        const log = createMockLogger()
        const ai = createAILogger(log, { cost: { 'gpt-4o': { input: 2.5, output: 10 } } })
        const model = createMockModel()
        const wrappedModel = wrapMock(ai, model)

        vi.mocked(model.doGenerate).mockResolvedValue({
          content: [],
          finishReason: createFinishReason(),
          usage: createMockUsage(),
          response: { modelId: 'claude-sonnet-4.6' },
        })

        await wrappedModel.doGenerate(createMockCallOptions())
        expect(ai.getEstimatedCost()).toBeUndefined()
      })
    })

    describe('onUpdate', () => {
      it('fires the callback on each step with a metadata snapshot', async () => {
        const log = createMockLogger()
        const ai = createAILogger(log)
        const model = createMockModel()
        const wrappedModel = wrapMock(ai, model)

        const updates: Array<ReturnType<typeof ai.getMetadata>> = []
        ai.onUpdate((metadata) => {
          updates.push(metadata)
        })

        vi.mocked(model.doGenerate)
          .mockResolvedValueOnce({
            content: [],
            finishReason: createFinishReason(),
            usage: createMockUsage({ inputTotal: 100, outputTotal: 50 }),
            response: { modelId: 'claude-sonnet-4.6' },
          })
          .mockResolvedValueOnce({
            content: [],
            finishReason: createFinishReason(),
            usage: createMockUsage({ inputTotal: 200, outputTotal: 100 }),
            response: { modelId: 'claude-sonnet-4.6' },
          })

        await wrappedModel.doGenerate(createMockCallOptions())
        await wrappedModel.doGenerate(createMockCallOptions())

        expect(updates).toHaveLength(2)
        expect(updates[0].calls).toBe(1)
        expect(updates[0].usage.total_tokens).toBe(150)
        expect(updates[1].calls).toBe(2)
        expect(updates[1].usage.total_tokens).toBe(450)
      })

      it('fires on captureEmbed', () => {
        const log = createMockLogger()
        const ai = createAILogger(log)

        const updates: Array<ReturnType<typeof ai.getMetadata>> = []
        ai.onUpdate(metadata => updates.push(metadata))

        ai.captureEmbed({ usage: { tokens: 42 } })

        expect(updates).toHaveLength(1)
        expect(updates[0].embedding).toEqual({ tokens: 42 })
      })

      it('fires on errors', async () => {
        const log = createMockLogger()
        const ai = createAILogger(log)
        const model = createMockModel()
        const wrappedModel = wrapMock(ai, model)

        const updates: Array<ReturnType<typeof ai.getMetadata>> = []
        ai.onUpdate(metadata => updates.push(metadata))

        vi.mocked(model.doGenerate).mockRejectedValue(new Error('boom'))
        await expect(wrappedModel.doGenerate(createMockCallOptions())).rejects.toThrow('boom')

        expect(updates).toHaveLength(1)
        expect(updates[0].error).toBe('boom')
        expect(updates[0].response?.finish_reasons).toEqual(['error'])
      })

      it('fires on createEvlogIntegration onFinish when sharing state', async () => {
        const log = createMockLogger()
        const ai = createAILogger(log)
        const integration = createEvlogIntegration(ai)
        const model = createMockModel()
        const wrappedModel = wrapMock(ai, model)

        const updates: Array<ReturnType<typeof ai.getMetadata>> = []
        ai.onUpdate(metadata => updates.push(metadata))

        vi.mocked(model.doGenerate).mockResolvedValue({
          content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'getWeather', input: '{}' }],
          finishReason: createFinishReason('tool-calls'),
          usage: createMockUsage({ inputTotal: 200, outputTotal: 100 }),
          response: { modelId: 'claude-sonnet-4.6' },
        })

        callIntegrationOnStart(integration)
        await wrappedModel.doGenerate(createMockCallOptions())
        callIntegrationOnToolCallFinish(integration, {
          toolName: 'getWeather',
          durationMs: 50,
          success: true,
          output: {},
        })
        callIntegrationOnFinish(integration)

        expect(updates.length).toBeGreaterThanOrEqual(2)
        const last = updates[updates.length - 1]
        expect(last.tools).toHaveLength(1)
        expect(last.duration_ms).toBeTypeOf('number')
      })

      it('returns an unsubscribe function', async () => {
        const log = createMockLogger()
        const ai = createAILogger(log)
        const model = createMockModel()
        const wrappedModel = wrapMock(ai, model)

        let count = 0
        const off = ai.onUpdate(() => {
          count++ 
        })

        vi.mocked(model.doGenerate).mockResolvedValue({
          content: [],
          finishReason: createFinishReason(),
          usage: createMockUsage(),
          response: { modelId: 'claude-sonnet-4.6' },
        })

        await wrappedModel.doGenerate(createMockCallOptions())
        expect(count).toBe(1)

        off()

        await wrappedModel.doGenerate(createMockCallOptions())
        expect(count).toBe(1)
      })

      it('supports multiple subscribers', () => {
        const log = createMockLogger()
        const ai = createAILogger(log)

        let a = 0
        let b = 0
        ai.onUpdate(() => {
          a++ 
        })
        ai.onUpdate(() => {
          b++ 
        })

        ai.captureEmbed({ usage: { tokens: 10 } })
        ai.captureEmbed({ usage: { tokens: 20 } })

        expect(a).toBe(2)
        expect(b).toBe(2)
      })

      it('isolates subscriber errors so the AI flow continues', async () => {
        const log = createMockLogger()
        const ai = createAILogger(log)
        const model = createMockModel()
        const wrappedModel = wrapMock(ai, model)

        ai.onUpdate(() => {
          throw new Error('listener crashed')
        })
        let calls = 0
        ai.onUpdate(() => {
          calls++ 
        })

        vi.mocked(model.doGenerate).mockResolvedValue({
          content: [],
          finishReason: createFinishReason(),
          usage: createMockUsage(),
          response: { modelId: 'claude-sonnet-4.6' },
        })

        await expect(wrappedModel.doGenerate(createMockCallOptions())).resolves.toBeDefined()
        expect(calls).toBe(1)
      })

      it('delivers an immutable snapshot to listeners', () => {
        const log = createMockLogger()
        const ai = createAILogger(log)

        const seen: Array<ReturnType<typeof ai.getMetadata>> = []
        ai.onUpdate((metadata) => {
          seen.push(metadata) 
        })

        ai.captureEmbed({ usage: { tokens: 10 } })
        seen[0].calls = 999

        ai.captureEmbed({ usage: { tokens: 20 } })
        expect(seen[1].calls).toBe(2)
      })
    })
  })

  describe('end-to-end with the real logger', () => {
    it('produces a wide event with linear array growth across a multi-step run', async () => {
      const log = createLogger()
      const ai = createAILogger(log)
      const model = createMockModel()
      const wrappedModel = wrapMock(ai, model)

      const tools = ['list-pages', 'get-page', 'get-page', 'get-page', 'get-page', 'get-page']
      const doGenerate = vi.mocked(model.doGenerate)
      for (const toolName of tools) {
        doGenerate.mockResolvedValueOnce({
          content: [{ type: 'tool-call', toolCallId: `tc-${toolName}`, toolName, args: '{}' }],
          finishReason: createFinishReason('tool-calls'),
          usage: createMockUsage({ inputTotal: 100, outputTotal: 20 }),
          response: { modelId: 'claude-sonnet-4.6' },
        })
        await wrappedModel.doGenerate(createMockCallOptions())
      }

      const wide = defined(log.emit({ _forceKeep: true }), 'wide event')
      expect(wide).not.toBeNull()
      const aiData = defined(wide.gen_ai, 'wide event gen_ai') as AIMetadata

      expect((aiData.tool_calls as string[])).toEqual(tools)
      expect((aiData.steps_usage as unknown[])).toHaveLength(tools.length)
      expect(aiData.steps).toBe(tools.length)
      expect(aiData.calls).toBe(tools.length)
      expect(aiData.response?.finish_reasons).toEqual(tools.map(() => 'tool-calls'))
      expect(aiData.usage.input_tokens).toBe(100 * tools.length)
      expect(aiData.usage.output_tokens).toBe(20 * tools.length)
    })

    it('keeps `request.models` deduplicated across many flushes on the real wide event', async () => {
      const log = createLogger()
      const ai = createAILogger(log)

      const gemini = createMockModel({ provider: 'google', modelId: 'gemini-3-flash' })
      const claude = createMockModel({ provider: 'anthropic', modelId: 'claude-sonnet-4.6' })
      const wrappedGemini = wrapMock(ai, gemini)
      const wrappedClaude = wrapMock(ai, claude)

      const baseResult = (modelId: string) => ({
        content: [],
        finishReason: createFinishReason(),
        usage: createMockUsage({ inputTotal: 50, outputTotal: 10 }),
        response: { modelId },
      })
      vi.mocked(gemini.doGenerate).mockResolvedValue(baseResult('gemini-3-flash'))
      vi.mocked(claude.doGenerate).mockResolvedValue(baseResult('claude-sonnet-4.6'))

      // Alternate models so each `flushState` re-evaluates the unique set.
      await wrappedGemini.doGenerate(createMockCallOptions())
      await wrappedClaude.doGenerate(createMockCallOptions())
      await wrappedGemini.doGenerate(createMockCallOptions())
      await wrappedClaude.doGenerate(createMockCallOptions())

      const wide = defined(log.emit({ _forceKeep: true }), 'wide event')
      const aiData = defined(wide.gen_ai, 'wide event gen_ai') as AIMetadata
      expect(aiData.request?.models).toEqual(['gemini-3-flash', 'claude-sonnet-4.6'])
    })
  })
})
