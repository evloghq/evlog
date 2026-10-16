import { bench, describe } from 'vitest'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { createAILogger } from '../../src/ai/index'
import { createLogger } from '../../src/logger'
import type { RequestLogger } from '../../src/types'

function makeMockResult(toolName: string) {
  return {
    content: [{ type: 'tool-call', toolCallId: `tc-${toolName}`, toolName, args: '{}' }],
    finishReason: { unified: 'tool-calls', raw: undefined },
    usage: {
      inputTokens: { total: 100, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 20, reasoning: undefined },
    },
    response: { modelId: 'claude-sonnet-4.6' },
  }
}

function makeWrappedModel(steps: number) {
  const calls: ReturnType<typeof makeMockResult>[] = []
  for (let i = 0; i < steps; i++) calls.push(makeMockResult(`tool-${i}`))
  let i = 0
  return {
    specificationVersion: 'v3',
    provider: 'anthropic',
    modelId: 'claude-sonnet-4.6',
    defaultObjectGenerationMode: 'json',
    doGenerate: () => Promise.resolve(calls[i++]),
    doStream: () => Promise.resolve({ stream: new ReadableStream() }),
  } as unknown as LanguageModelV3
}

async function runScenario(steps: number, withSubscriber: boolean): Promise<void> {
  const log = createLogger()
  const ai = createAILogger(log as unknown as RequestLogger)
  if (withSubscriber) ai.onUpdate(() => { /* noop */ })
  const wrapped = ai.wrap(makeWrappedModel(steps))
  for (let i = 0; i < steps; i++) {
    await wrapped.doGenerate({ prompt: [] } as any)
  }
  log.emit({ _forceKeep: true } as any)
}

describe('multi-step agent flush throughput', () => {
  bench('6 steps, no subscriber', async () => {
    await runScenario(6, false)
  })

  bench('6 steps, with subscriber', async () => {
    await runScenario(6, true)
  })

  bench('50 steps, no subscriber', async () => {
    await runScenario(50, false)
  })

  bench('50 steps, with subscriber', async () => {
    await runScenario(50, true)
  })
})
