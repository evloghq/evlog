import type { ModelMessage } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

const evaluate = vi.fn()
vi.mock('eve/ai', () => ({ evaluate: (...args: unknown[]) => evaluate(...args) }))

const { decideOncePerTurn, reasoningFor, routingMessages, selectReasoning, turnIdOf } = await import('./reasoning-routing')

function user(text: string): ModelMessage {
  return { role: 'user', content: text }
}

function assistant(text: string): ModelMessage {
  return { role: 'assistant', content: text }
}

function answered(choice: string) {
  evaluate.mockResolvedValueOnce({ answers: { effort: { choice } } })
}

afterEach(() => {
  evaluate.mockReset()
})

describe('routingMessages', () => {
  it('keeps the newest user and assistant text in order and drops the rest', () => {
    const messages: ModelMessage[] = [
      { role: 'system', content: 'ignored' },
      user('one'),
      assistant('two'),
      { role: 'tool', content: [] } as unknown as ModelMessage,
      user('three'),
    ]
    expect(routingMessages(messages)).toEqual([
      { role: 'user', text: 'one' },
      { role: 'assistant', text: 'two' },
      { role: 'user', text: 'three' },
    ])
  })

  it('flattens multipart content to its text parts', () => {
    const message: ModelMessage = {
      role: 'user',
      content: [{ type: 'text', text: 'look at this' }, { type: 'image', image: 'data:image/png;base64,AAAA' }],
    }
    expect(routingMessages([message])).toEqual([{ role: 'user', text: 'look at this' }])
  })

  it('truncates an oversized latest message instead of refusing to route', () => {
    const [only] = routingMessages([user('x'.repeat(20_000))])
    expect(only?.text).toHaveLength(16_000)
  })

  it('stops at the budget once the latest message is in', () => {
    const kept = routingMessages([user('a'.repeat(10_000)), user('b'.repeat(10_000))])
    expect(kept).toHaveLength(1)
    expect(kept[0]?.text.startsWith('b')).toBe(true)
  })
})

describe('selectReasoning', () => {
  it('returns the tier the evaluator chose', async () => {
    answered('low')
    await expect(selectReasoning({ messages: [user('thanks!')] })).resolves.toBe('low')
    expect(evaluate).toHaveBeenCalledTimes(1)
    const call = evaluate.mock.calls[0]?.[0] as { state: unknown, questions: { effort: { type: string } } }
    expect(call.state).toEqual({ messages: [{ role: 'user', text: 'thanks!' }] })
    expect(call.questions.effort.type).toBe('choice')
  })

  it('does not call the evaluator when there is no user text', async () => {
    await expect(selectReasoning({ messages: [assistant('hello')] })).resolves.toBeNull()
    expect(evaluate).not.toHaveBeenCalled()
  })

  it('falls back when the evaluator fails', async () => {
    evaluate.mockRejectedValueOnce(new Error('jev down'))
    await expect(selectReasoning({ messages: [user('review this PR')] })).resolves.toBeNull()
  })

  it('falls back when the evaluator answers outside the tiers', async () => {
    answered('xhigh')
    await expect(selectReasoning({ messages: [user('hi')] })).resolves.toBeNull()
  })

  it('propagates a cancelled turn instead of routing it', async () => {
    const controller = new AbortController()
    evaluate.mockImplementationOnce(() => {
      controller.abort()
      return Promise.reject(new Error('aborted'))
    })
    await expect(selectReasoning({ messages: [user('hi')], abortSignal: controller.signal })).rejects.toThrow('aborted')
  })
})

describe('decideOncePerTurn', () => {
  it('asks once per turn and shares the answer with later steps', async () => {
    const select = vi.fn(() => Promise.resolve('medium' as const))
    const key = `turn-${Math.random()}`
    await expect(decideOncePerTurn(key, select)).resolves.toBe('medium')
    await expect(decideOncePerTurn(key, select)).resolves.toBe('medium')
    expect(select).toHaveBeenCalledTimes(1)
  })

  it('remembers a fallback so a turn does not flap between steps', async () => {
    const select = vi.fn(() => Promise.resolve(null))
    const key = `turn-${Math.random()}`
    await expect(decideOncePerTurn(key, select)).resolves.toBe('fallback')
    await expect(decideOncePerTurn(key, select)).resolves.toBe('fallback')
    expect(select).toHaveBeenCalledTimes(1)
    expect(reasoningFor('fallback')).toBe('high')
  })

  it('forgets a turn whose selection threw', async () => {
    const key = `turn-${Math.random()}`
    await expect(decideOncePerTurn(key, () => Promise.reject(new Error('aborted')))).rejects.toThrow('aborted')
    await expect(decideOncePerTurn(key, () => Promise.resolve('low'))).resolves.toBe('low')
  })
})

describe('turnIdOf', () => {
  it('reads the turn id from a step.started event and nothing else', () => {
    expect(turnIdOf({ data: { turnId: 'turn_3' } })).toBe('turn_3')
    expect(turnIdOf({ data: { turnId: '' } })).toBeUndefined()
    expect(turnIdOf({ data: {} })).toBeUndefined()
    expect(turnIdOf(null)).toBeUndefined()
  })
})
