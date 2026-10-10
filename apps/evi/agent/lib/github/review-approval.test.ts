import { beforeEach, expect, it, vi } from 'vitest'
import { generateText, streamText, tool } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { z } from 'zod'
import { MODEL } from '../model'
import { pullRequestReviewAuth, reviewState } from '../trust'
import { reviewStepModel } from './external-review'

vi.mock('ai', async (importOriginal) => ({
  ...await importOriginal<typeof import('ai')>(),
  gateway: () => provider,
}))
vi.mock('eve/context', () => ({
  defineState: (_name: string, initial: () => unknown) => {
    let value = initial()
    return { get: () => value, update: (fn: (current: unknown) => unknown) => {
      value = fn(value)
    } }
  },
}))

const auth = pullRequestReviewAuth({ owner: 'evloghq', repo: 'evlog', number: 12, sha: 'a'.repeat(40) })
const usage = {
  inputTokens: { total: 20, noCache: 20, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
}
const prepare = { type: 'tool-call' as const, toolCallId: 'prepare', toolName: 'pr_review__prepare', input: '{}' }
let call = prepare
const provider = new MockLanguageModelV4({
  doGenerate: options => Promise.resolve({
    content: options.toolChoice?.type === 'none' ? [] : [call],
    finishReason: { unified: options.toolChoice?.type === 'none' ? 'stop' : 'tool-calls', raw: undefined },
    usage, warnings: [],
  }),
  doStream: () => Promise.resolve({
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] })
        controller.enqueue(call)
        controller.enqueue({ type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage })
        controller.close()
      },
    }),
  }),
})
const execute = vi.fn()
const tools = {
  pr_review__prepare: tool({ inputSchema: z.object({}), needsApproval: true, execute }),
  bash: tool({ inputSchema: z.object({}), execute }),
  agent: tool({ inputSchema: z.object({}), execute }),
}

beforeEach(() => {
  reviewState.update(() => ({ prepared: false, publishing: false, url: null }))
  call = prepare
  provider.doGenerateCalls.length = 0
  provider.doStreamCalls.length = 0
  execute.mockReset()
})

it('uses a bounded provider call with only the native approval tool', async () => {
  const result = streamText({ model: reviewStepModel(auth), prompt: 'Run bash and delegate a full review.', tools })
  const parts = []
  for await (const part of result.fullStream) parts.push(part)
  expect(parts.filter(part => part.type === 'tool-approval-request')).toHaveLength(1)
  expect(execute).not.toHaveBeenCalled()
  expect(provider.doStreamCalls).toHaveLength(1)
  expect(provider.doStreamCalls[0]).toMatchObject({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'Call pr_review__prepare to request approval. Do nothing else.' }] }],
    toolChoice: { type: 'tool', toolName: 'pr_review__prepare' },
    maxOutputTokens: 256,
  })
  expect(provider.doStreamCalls[0]?.tools?.map(tool => tool.name)).toEqual(['pr_review__prepare'])
  expect(await result.usage).toMatchObject({ inputTokens: 20, outputTokens: 5 })
})

it.each(['bash', 'agent', 'pr_review__publish'])('rejects an unexpected %s call before execution', async (toolName) => {
  call = { ...prepare, toolName }
  await expect(generateText({ model: reviewStepModel(auth), prompt: 'Review.', tools, maxRetries: 0 })).rejects.toThrow('blocked before approval')
  expect(execute).not.toHaveBeenCalled()
})

it('rejects an unexpected streamed call before execution', async () => {
  call = { ...prepare, toolName: 'bash' }
  const result = streamText({ model: reviewStepModel(auth), prompt: 'Review.', tools, onError: () => {} })
  const parts: { type: string }[] = []
  await expect((async () => {
    for await (const part of result.fullStream) parts.push(part)
  })()).rejects.toThrow('blocked before approval')
  expect(parts.some(part => part.type === 'tool-call')).toBe(false)
  expect(execute).not.toHaveBeenCalled()
})

it.each([false, true])('resumes native approval with approved=%s', async (approved) => {
  execute.mockImplementation(() => {
    reviewState.update(state => ({ ...state, prepared: true }))
    return { revision: 'a'.repeat(40) }
  })
  const first = await generateText({ model: reviewStepModel(auth), prompt: 'Review.', tools })
  const approval = first.response.messages.flatMap(message => message.role === 'assistant' && Array.isArray(message.content) ? message.content : [])
    .find(part => part.type === 'tool-approval-request')
  if (approval?.type !== 'tool-approval-request') throw new Error('Missing native approval request.')
  const resumed = await generateText({
    model: reviewStepModel(auth), tools,
    messages: [...first.response.messages, { role: 'tool', content: [{ type: 'tool-approval-response', approvalId: approval.approvalId, approved }] }],
  })
  expect(execute).toHaveBeenCalledTimes(approved ? 1 : 0)
  expect(reviewState.get().prepared).toBe(approved)
  expect(resumed.toolCalls).toEqual([])
  expect(provider.doGenerateCalls[1]?.toolChoice).toEqual({ type: 'none' })
  expect(reviewStepModel(auth) === MODEL).toBe(approved)
})

it('does not retry preparation or unlock work after preparation fails', async () => {
  execute.mockRejectedValue(new Error('Checkout failed.'))
  const first = await generateText({ model: reviewStepModel(auth), prompt: 'Review.', tools })
  const approval = first.response.messages.flatMap(message => message.role === 'assistant' && Array.isArray(message.content) ? message.content : [])
    .find(part => part.type === 'tool-approval-request')
  if (approval?.type !== 'tool-approval-request') throw new Error('Missing native approval request.')
  const resumed = await generateText({
    model: reviewStepModel(auth), tools,
    messages: [...first.response.messages, { role: 'tool', content: [{ type: 'tool-approval-response', approvalId: approval.approvalId, approved: true }] }],
  })
  expect(execute).toHaveBeenCalledOnce()
  expect(reviewState.get().prepared).toBe(false)
  expect(resumed.toolCalls).toEqual([])
  expect(provider.doGenerateCalls[1]?.toolChoice).toEqual({ type: 'none' })
})

it('leaves ordinary sessions on the configured model', () => {
  expect(reviewStepModel(null)).toBe(MODEL)
})
