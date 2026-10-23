import { describe, expect, it } from 'vitest'
import { createError as h3CreateError } from 'h3'
import { createError } from '../../src/error'
import { createErrorSerializer } from '../../src/shared/serialize-error'

const { serializeErrorsIn } = createErrorSerializer()

describe('serializeErrorsIn', () => {
  it('returns the value itself when it holds no error', () => {
    const value = { user: { id: 'u_1', tags: ['a', null, 1] }, count: 0, empty: undefined }
    expect(serializeErrorsIn(value)).toBe(value)
  })

  it('copies only the objects on the path to an error', () => {
    const sibling = { plan: 'pro' }
    const list = [sibling]
    const error = new Error('boom')
    const value = { before: 1, nested: { error }, sibling, list, after: 'x' }
    const result = serializeErrorsIn(value) as Record<string, unknown>

    expect(result).not.toBe(value)
    expect(Object.keys(result)).toEqual(['before', 'nested', 'sibling', 'list', 'after'])
    expect(result.sibling).toBe(sibling)
    expect(result.list).toBe(list)
    expect(result.before).toBe(1)
    expect(result.after).toBe('x')
    expect(result.nested).toMatchObject({ error: { name: 'Error', message: 'boom' } })
    expect(value.nested.error).toBe(error)
  })

  it('copies an array that holds an error and keeps its other items', () => {
    const item = { id: 'a' }
    const result = serializeErrorsIn({ items: [item, 2, new Error('boom'), null] }) as { items: unknown[] }
    expect(result.items[0]).toBe(item)
    expect(result.items.slice(1, 2)).toEqual([2])
    expect(result.items[2]).toMatchObject({ message: 'boom' })
    expect(result.items[3]).toBeNull()
  })

  it('stores a __proto__ key as a field when it copies the object', () => {
    const value = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>
    value.error = new Error('boom')
    const result = serializeErrorsIn(value) as Record<string, unknown>

    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    expect(Object.getOwnPropertyDescriptor(result, '__proto__')?.value).toEqual({ polluted: true })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('cuts a cycle and keeps a value reached through two branches', () => {
    const shared = { id: 's' }
    const value: Record<string, unknown> = { a: shared, b: shared, error: new Error('boom') }
    value.self = value
    const result = serializeErrorsIn(value) as Record<string, unknown>

    expect(result.self).toBe('[Circular]')
    expect(result.a).toBe(shared)
    expect(result.b).toBe(shared)
  })

  describe('EvlogError guidance', () => {
    const guided = () => createError({ code: 'PAYMENT_DECLINED', message: 'Payment failed', status: 402, why: 'Card declined', fix: 'Try another card', link: 'https://example.test', data: { retryAfter: 30 } })

    it('logs code, why, fix and link once, at the top level, and data as the payload only', () => {
      const { error } = serializeErrorsIn({ error: guided() }) as { error: Record<string, unknown> }

      expect(error).toMatchObject({ code: 'PAYMENT_DECLINED', status: 402, why: 'Card declined', fix: 'Try another card', link: 'https://example.test' })
      expect(error.data).toEqual({ retryAfter: 30 })
    })

    it('logs no data when the error carries only guidance', () => {
      const { error } = serializeErrorsIn({ error: createError({ message: 'Payment failed', why: 'Card declined' }) }) as { error: Record<string, unknown> }

      expect(error.why).toBe('Card declined')
      expect(error).not.toHaveProperty('data')
    })

    it('logs the guidance once when h3 wraps the error', () => {
      const { error } = serializeErrorsIn({ error: h3CreateError(guided()) }) as { error: Record<string, unknown> }

      expect(error).toMatchObject({ why: 'Card declined', fix: 'Try another card', status: 402 })
      expect(error.data).toEqual({ retryAfter: 30 })
    })
  })
})
