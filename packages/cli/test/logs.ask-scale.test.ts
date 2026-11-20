import type { WideEvent } from 'evlog'
import { describe, expect, it } from 'vitest'
import { answers, scriptedEvaluate } from '@evlog/signals/testing'
import { askEvents, askState, estimateAsk } from '../src/lib/logs/ask'
// @ts-expect-error a plain .mjs fixture, also run by hand to write a sink
import { scaleEvents } from './fixtures/ask-scale.mjs'

type Seeded = { event: WideEvent, needle?: boolean, declined?: boolean }
const day = scaleEvents(10_000) as Seeded[]
const tokens = (events: unknown[]): number => events.reduce<number>((sum, event) => sum + Math.ceil(JSON.stringify(event).length / 4), 0)

/* Answers from the state the model is sent, never from the event: a needle it cannot tell apart is one the projection or the grouping lost. */
const { evaluate, calls } = scriptedEvaluate((_name, _question, state) => {
  const seen = state as { path?: string, status?: number, order?: unknown }
  return answers.boolean(seen.path === '/api/checkout' && seen.status === 200 && !seen.order ? 0.95 : seen.status === 402 ? 0.85 : 0.03)
})

describe('evlog logs --ask over a day of events', () => {
  it('ranks every unordered payment and declined card above the rest, from the cut-down state', async () => {
    calls.length = 0
    const events = day.map(seeded => seeded.event)
    const result = await askEvents(events, 'The customer tried to pay but did not end up with a confirmed order', { evaluate })
    const wanted = new Set(day.filter(seeded => seeded.needle || seeded.declined).map(seeded => seeded.event.requestId))

    expect(wanted.size).toBeGreaterThan(100)
    expect(result.answered.slice(0, wanted.size).every(answer => wanted.has(answer.event.requestId))).toBe(true)
    expect(result.answered).toHaveLength(events.length)
    expect(calls).toHaveLength(estimateAsk(events).calls)
    expect(result.shared).toBe(events.length - calls.length)
  })

  it('asks once for each distinct health check, however many there are', () => {
    const health = day.filter(seeded => seeded.event.path === '/api/health').map(seeded => seeded.event)
    expect(health.length).toBeGreaterThan(1000)
    expect(estimateAsk(health).calls).toBe(5)
  })

  it('sends an agent turn with its tool list cut down to under a third of the tokens', () => {
    const turns = day.filter(seeded => seeded.event.path === '/agents/support/turns').map(seeded => seeded.event)
    expect(tokens(turns.map(askState))).toBeLessThan(tokens(turns) / 3)
  })
})
