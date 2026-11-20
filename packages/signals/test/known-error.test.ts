import type { EnrichContext, WideEvent } from 'evlog'
import { defineError, defineErrorCatalog } from 'evlog'
import { describe, expect, it, vi } from 'vitest'
import { knownError } from '../src/known-error'
import { createSignals } from '../src/plugin'
import { answers, scriptedEvaluate } from '../src/testing'

const billingErrors = defineErrorCatalog('billing', {
  PAYMENT_DECLINED: { status: 402, message: 'Card declined', why: 'The card issuer refused the charge' },
  INSUFFICIENT_FUNDS: {
    status: 402,
    message: ({ available, required }: { available: number, required: number }) => `Insufficient funds: $${available}/$${required}`,
    why: 'The balance is lower than the amount charged',
  },
})
const sessionExpired = defineError('auth.SESSION_EXPIRED', { status: 401, message: 'Session expired' })

function failed(error: Record<string, unknown>, fields: Record<string, unknown> = {}): EnrichContext {
  const event = { timestamp: '2026-11-20T10:00:00.000Z', level: 'error', service: 'shop', environment: 'production', status: 500, path: '/api/checkout', error, ...fields } as WideEvent
  return { event, request: { method: 'POST', path: '/api/checkout' } }
}

describe('knownError', () => {
  it('offers each catalog entry, described by its message and why, then new', async () => {
    const { evaluate, calls } = scriptedEvaluate((_name, question) => question.type === 'choice' ? answers.choice(question, 'billing.PAYMENT_DECLINED', 0.97) : answers.first(question))
    const plugin = createSignals({ signals: [knownError([billingErrors, sessionExpired])], evaluate })

    const ctx = failed({ name: 'StripeCardError', message: 'Your card was declined.', code: 'card_declined' })
    await plugin.enrich(ctx)

    expect((calls[0]!.questions['known-error'] as { criteria: Record<string, string> }).criteria).toEqual({
      'billing.PAYMENT_DECLINED': 'Card declined. The card issuer refused the charge',
      'billing.INSUFFICIENT_FUNDS': 'The balance is lower than the amount charged',
      'auth.SESSION_EXPIRED': 'Session expired',
      'new': 'None of the above: a failure none of these entries describes',
    })
    expect((ctx.event.signals as Record<string, unknown>)['known-error']).toEqual({ value: 'billing.PAYMENT_DECLINED', confidence: 0.97 })
  })

  it('skips errors thrown through the catalog and events without an error', async () => {
    const evaluate = vi.fn(scriptedEvaluate((_name, question) => question.type === 'choice' ? answers.choice(question, 'new', 0.99) : answers.first(question)).evaluate)
    const plugin = createSignals({ signals: [knownError([billingErrors, sessionExpired])], evaluate })

    await plugin.enrich(failed({ name: 'EvlogError', message: 'Card declined', code: 'billing.PAYMENT_DECLINED' }))
    await plugin.enrich(failed({ name: 'EvlogError', message: 'Session expired', code: 'auth.SESSION_EXPIRED' }))
    await plugin.enrich({ event: { timestamp: '2026-11-20T10:00:00.000Z', level: 'info', service: 'shop', environment: 'production', status: 200 } as WideEvent, request: { path: '/' } })
    expect(evaluate).not.toHaveBeenCalled()

    await plugin.enrich(failed({ name: 'Error', message: 'something odd', code: 'new' }))
    expect(evaluate).toHaveBeenCalledTimes(1)
  })

  it('shares one verdict across errors with the same name and message', async () => {
    const evaluate = vi.fn(scriptedEvaluate((_name, question) => question.type === 'choice' ? answers.choice(question, 'new', 0.99) : answers.first(question)).evaluate)
    const plugin = createSignals({ signals: [knownError([billingErrors])], evaluate })

    for (let i = 0; i < 10; i++) await plugin.enrich(failed({ name: 'TypeError', message: 'Cannot read properties of undefined', stack: `at line ${i}` }, { requestId: `r${i}` }))
    await plugin.enrich(failed({ name: 'TypeError', message: 'Cannot read properties of null' }))
    await plugin.enrich(failed({ name: 'RangeError', message: 'Cannot read properties of undefined' }))

    expect(evaluate).toHaveBeenCalledTimes(3)
    expect(plugin.stats()).toMatchObject({ calls: 3, cached: 9 })
  })

  it('refuses an empty catalog and a code named new', () => {
    expect(() => knownError([])).toThrow('at least one catalog entry')
    expect(() => knownError([defineError('new', { message: 'x' })])).toThrow('reserved')
  })
})
