import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError } from '../../src/error'
import { createRequestLogger, initLogger } from '../../src/logger'
import type { FieldContext } from '../../src/types'
import { withFakeTimers } from '../helpers/timers'
import { defined } from '../helpers/defined'

describe('createRequestLogger', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    initLogger({ pretty: false })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates logger with request context', () => {
    const logger = createRequestLogger({
      method: 'POST',
      path: '/api/checkout',
      requestId: 'req-123',
    })

    const context = logger.getContext()
    expect(context.method).toBe('POST')
    expect(context.path).toBe('/api/checkout')
    expect(context.requestId).toBe('req-123')
  })

  it('accumulates context with set()', () => {
    const logger = createRequestLogger({ method: 'GET', path: '/api/user' })

    logger.set({ user: { id: '123' } })
    logger.set({ cart: { items: 3 } })

    const context = logger.getContext()
    expect(context.user).toEqual({ id: '123' })
    expect(context.cart).toEqual({ items: 3 })
  })

  it('overwrites existing primitive keys with set()', () => {
    const logger = createRequestLogger({})

    logger.set({ phase: 'pending' })
    logger.set({ phase: 'complete' })

    const context = logger.getContext()
    expect(context.phase).toBe('complete')
  })

  it('deep merges nested objects with set()', () => {
    const logger = createRequestLogger({})

    logger.set({ user: { name: 'Alice' } })
    logger.set({ user: { id: '123' } })

    const context = logger.getContext()
    expect(context.user).toEqual({ name: 'Alice', id: '123' })
  })

  it('deep merges multiple levels of nesting', () => {
    const logger = createRequestLogger({})

    logger.set({ order: { customer: { name: 'Alice' } } })
    logger.set({ order: { customer: { email: 'alice@example.com' } } })
    logger.set({ order: { total: 99.99 } })

    const context = logger.getContext()
    expect(context.order).toEqual({
      customer: { name: 'Alice', email: 'alice@example.com' },
      total: 99.99,
    })
  })

  it('new values override existing values in nested objects', () => {
    const logger = createRequestLogger({})

    logger.set({ user: { status: 'pending' } })
    logger.set({ user: { status: 'active' } })

    const context = logger.getContext()
    expect(context.user).toEqual({ status: 'active' })
  })

  it('handles arrays in nested objects', () => {
    const logger = createRequestLogger({})

    logger.set({ cart: { items: ['item1'] } })
    logger.set({ cart: { total: 50 } })

    const context = logger.getContext()
    expect(context.cart).toEqual({ items: ['item1'], total: 50 })
  })

  it('concatenates arrays on the same key with set()', () => {
    const logger = createRequestLogger({})

    logger.set({ array: [1, 2] })
    logger.set({ array: [3] })

    expect(logger.getContext().array).toEqual([1, 2, 3])
  })

  it('concatenates nested arrays on the same key with set()', () => {
    const logger = createRequestLogger({})

    logger.set({ job: { steps: ['a'] } })
    logger.set({ job: { steps: ['b', 'c'] } })

    expect(logger.getContext().job).toEqual({ steps: ['a', 'b', 'c'] })
  })

  it('replaces array with non-array on the same key with set()', () => {
    const logger = createRequestLogger({})

    logger.set({ tags: ['a', 'b'] })
    logger.set({ tags: 'done' })

    expect(logger.getContext().tags).toBe('done')
  })

  it('does not drop prior array elements when appending an empty array', () => {
    const logger = createRequestLogger({})

    logger.set({ ids: [1, 2] })
    logger.set({ ids: [] })

    expect(logger.getContext().ids).toEqual([1, 2])
  })

  it('records error with error()', () => {
    const logger = createRequestLogger({})
    const error = new Error('Payment failed')

    logger.error(error, { step: 'payment' })

    const context = logger.getContext()
    expect(context.error).toEqual({
      name: 'Error',
      message: 'Payment failed',
      stack: expect.any(String),
    })
    expect(context.step).toBe('payment')
  })

  it('captures info messages in requestLogs array', () => {
    const logger = createRequestLogger({})

    logger.info('Cache miss, fetching from database')

    const context = logger.getContext()
    expect(context.requestLogs).toEqual([
      {
        level: 'info',
        message: 'Cache miss, fetching from database',
        timestamp: expect.any(String),
      },
    ])
  })

  it('captures warning messages in requestLogs array and escalates final level', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const logger = createRequestLogger({})

    logger.warn('Deprecated parameter used')
    logger.emit()

    const context = logger.getContext()
    expect(context.requestLogs).toEqual([
      {
        level: 'warn',
        message: 'Deprecated parameter used',
        timestamp: expect.any(String),
      },
    ])

    expect(warnSpy).toHaveBeenCalled()
    const output = warnSpy.mock.calls[0]?.[0]
    expect(output).toContain('"level":"warn"')
  })

  it('preserves chronological request logs and escalates warn over info', () => {
    const logger = createRequestLogger({})

    logger.info('User authenticated')
    logger.info('Cache miss')
    logger.warn('Deprecated parameter used')

    const result = logger.emit()

    expect(result).not.toBeNull()
    expect(result).toHaveProperty('level', 'warn')
    expect(result).toHaveProperty('requestLogs')
    expect(Array.isArray(result?.requestLogs)).toBe(true)
    expect((result?.requestLogs as Array<Record<string, unknown>>).map(entry => entry.level)).toEqual(['info', 'info', 'warn'])
    expect((result?.requestLogs as Array<Record<string, unknown>>).map(entry => entry.message)).toEqual([
      'User authenticated',
      'Cache miss',
      'Deprecated parameter used',
    ])
  })

  it('merges context passed to info() and warn()', () => {
    const logger = createRequestLogger({})

    logger.info('Starting request', { user: { id: '123' } })
    logger.warn('Slow downstream call', { downstream: { service: 'billing' } })

    const context = logger.getContext()
    expect(context.user).toEqual({ id: '123' })
    expect(context.downstream).toEqual({ service: 'billing' })
  })

  it('does not clobber requestLogs when context contains requestLogs key', () => {
    const logger = createRequestLogger({})

    logger.info('First entry')
    logger.info('Second entry', { requestLogs: 'should be ignored' } as FieldContext)
    logger.warn('Third entry', { requestLogs: [{ fake: true }] } as FieldContext)

    const context = logger.getContext()
    const logs = defined(context.requestLogs, 'requestLogs') as Array<{ message: string }>
    expect(logs.map(entry => entry.message)).toEqual(['First entry', 'Second entry', 'Third entry'])
  })

  it('captures custom error properties (statusCode, data, cause)', () => {
    const logger = createRequestLogger({})
    const error = Object.assign(new Error('Something went wrong'), {
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      data: { code: 'VALIDATION_ERROR', why: 'Invalid input' },
      cause: new Error('original cause'),
    })

    logger.error(error)

    const context = logger.getContext()
    expect(context.error).toEqual({
      name: 'Error',
      message: 'Something went wrong',
      stack: expect.any(String),
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      data: { code: 'VALIDATION_ERROR', why: 'Invalid input' },
      cause: { name: 'Error', message: 'original cause', stack: expect.any(String) },
    })
  })

  it('captures EvlogError internal on wide-event error object', () => {
    const logger = createRequestLogger({})
    const error = createError({
      message: 'Forbidden',
      status: 403,
      internal: { tenantId: 't-9', attemptedResource: 'proj/secret' },
    })

    logger.error(error)

    const context = logger.getContext()
    expect(context.error).toMatchObject({
      name: 'EvlogError',
      message: 'Forbidden',
      status: 403,
      internal: { tenantId: 't-9', attemptedResource: 'proj/secret' },
    })
  })

  it('captures EvlogError code on wide-event error object', () => {
    const logger = createRequestLogger({})
    const error = createError({
      code: 'PAYMENT_DECLINED',
      message: 'Payment failed',
      status: 402,
    })

    logger.error(error)

    const context = logger.getContext()
    expect(context.error).toMatchObject({
      name: 'EvlogError',
      message: 'Payment failed',
      status: 402,
      code: 'PAYMENT_DECLINED',
    })
  })

  it('captures status/statusText from new-style H3 errors (Nuxt v4.3+)', () => {
    const logger = createRequestLogger({})
    const error = Object.assign(new Error('Not Found'), {
      status: 404,
      statusText: 'Not Found',
    })

    logger.error(error)

    const context = logger.getContext()
    expect(context.error).toEqual({
      name: 'Error',
      message: 'Not Found',
      stack: expect.any(String),
      status: 404,
      statusText: 'Not Found',
    })
  })

  it('does not include custom properties when absent', () => {
    const logger = createRequestLogger({})
    logger.error(new Error('Plain error'))

    const context = logger.getContext()
    expect(context.error).toEqual({
      name: 'Error',
      message: 'Plain error',
      stack: expect.any(String),
    })
    expect(context.error).not.toHaveProperty('statusCode')
    expect(context.error).not.toHaveProperty('status')
    expect(context.error).not.toHaveProperty('data')
    expect(context.error).not.toHaveProperty('cause')
  })

  it('accepts string error', () => {
    const logger = createRequestLogger({})
    logger.error('Something went wrong')

    const context = logger.getContext()
    expect(context.error).toEqual({
      name: 'Error',
      message: 'Something went wrong',
      stack: expect.any(String),
    })
  })

  it('deep merges errorContext with nested objects after set()', () => {
    const logger = createRequestLogger({})

    logger.set({ order: { id: '123', status: 'pending' } })
    logger.error(new Error('Payment failed'), { order: { payment: { method: 'card' } } })

    const context = logger.getContext()
    expect(context.order).toEqual({
      id: '123',
      status: 'pending',
      payment: { method: 'card' },
    })
    expect(context.error).toEqual({
      name: 'Error',
      message: 'Payment failed',
      stack: expect.any(String),
    })
  })

  it('emits wide event on emit()', () => {
    const logger = createRequestLogger({
      method: 'GET',
      path: '/api/test',
    })

    logger.set({ user: { id: '123' } })
    logger.emit()

    expect(infoSpy).toHaveBeenCalled()
    const [[output]] = infoSpy.mock.calls
    expect(output).toContain('"level":"info"')
    expect(output).toContain('"method":"GET"')
    expect(output).toContain('"path":"/api/test"')
    expect(output).toContain('"duration"')
  })

  it('emits error level when error recorded', () => {
    const errorSpy = vi.spyOn(console, 'error')
    const logger = createRequestLogger({})

    logger.error(new Error('Failed'))
    logger.emit()

    expect(errorSpy).toHaveBeenCalled()
    const output = errorSpy.mock.calls[0]?.[0]
    expect(output).toContain('"level":"error"')
  })

  it('setLevel() promotes the wide event level without touching the error context', () => {
    const errorSpy = vi.spyOn(console, 'error')
    const logger = createRequestLogger({})

    logger.setLevel('error')
    logger.set({ error: { code: 'INVALID_INPUT' } })
    const result = logger.emit()

    expect(result).toHaveProperty('level', 'error')
    expect(result).toHaveProperty('error', { code: 'INVALID_INPUT' })
    expect(errorSpy).toHaveBeenCalled()
  })

  it('setLevel("warn") emits at warn level without writing to requestLogs', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const logger = createRequestLogger({})

    logger.setLevel('warn')
    const result = logger.emit()

    expect(result).toHaveProperty('level', 'warn')
    expect((result as Record<string, unknown>).requestLogs).toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('setLevel() wins over the level computed from .error()/.warn()', () => {
    const errorSpy = vi.spyOn(console, 'error')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const logger = createRequestLogger({})
    logger.error(new Error('Boom'))
    logger.setLevel('warn')
    const result = logger.emit()

    expect(result).toHaveProperty('level', 'warn')
    expect(warnSpy).toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('setLevel() warns and is a no-op after emit()', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const logger = createRequestLogger({})

    logger.emit()
    consoleWarnSpy.mockClear()
    logger.setLevel('error')

    expect(consoleWarnSpy).toHaveBeenCalledTimes(1)
    expect(consoleWarnSpy.mock.calls[0]?.[0]).toContain('log.setLevel() called after the wide event was emitted')
  })

  it('includes duration in emitted event', async () => {
    await withFakeTimers(() => {
      const logger = createRequestLogger({})
      vi.advanceTimersByTime(50)
      logger.emit()

      const [[output]] = infoSpy.mock.calls
      expect(output).toMatch(/"duration":"[0-9]+ms"/)
    })
  })

  it('includes durationMs as a number alongside the formatted duration', async () => {
    await withFakeTimers(() => {
      const logger = createRequestLogger({})
      vi.advanceTimersByTime(1500)
      const event = logger.emit()

      expect(event?.durationMs).toBe(1500)
      expect(event?.duration).toBe('1.50s')
    })
  })

  it('never reports a negative duration when the clock steps backwards', () => {
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(10_000)
    const logger = createRequestLogger({})

    // NTP step or manual clock change mid-request.
    now.mockReturnValue(9_000)
    const event = logger.emit()

    expect(event?.durationMs).toBe(0)
    expect(event?.duration).toBe('0ms')
  })

  it('allows overrides on emit()', () => {
    const logger = createRequestLogger({})
    logger.set({ original: true })
    logger.emit({ override: true })

    const [[output]] = infoSpy.mock.calls
    expect(output).toContain('"original":true')
    expect(output).toContain('"override":true')
  })

  it('returns WideEvent when log is emitted', () => {
    const logger = createRequestLogger({
      method: 'GET',
      path: '/api/test',
    })

    logger.set({ user: { id: '123' } })
    const result = logger.emit()

    expect(result).not.toBeNull()
    expect(result).toHaveProperty('timestamp')
    expect(result).toHaveProperty('level', 'info')
    expect(result).toHaveProperty('method', 'GET')
    expect(result).toHaveProperty('path', '/api/test')
    expect(result).toHaveProperty('user', { id: '123' })
  })

  it('returns null when log is sampled out', () => {
    initLogger({
      pretty: false,
      sampling: {
        rates: { info: 0 },
      },
    })

    const logger = createRequestLogger({ method: 'GET', path: '/test' })
    const result = logger.emit()

    expect(result).toBeNull()
  })

  it('returns null when head sampling excludes the log', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.9)

    initLogger({
      pretty: false,
      sampling: {
        rates: { info: 50 },
      },
    })

    const logger = createRequestLogger({ method: 'GET', path: '/test' })
    const result = logger.emit()

    expect(result).toBeNull()
    randomSpy.mockRestore()
  })

  it('seals logger after emit so set() warns and does not mutate context', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const logger = createRequestLogger({ method: 'GET', path: '/x', requestId: 'r1' })
    logger.set({ before: true })
    logger.emit()
    logger.set({ after: true })
    expect(warnSpy).toHaveBeenCalled()
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('log.set()')
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('after')
    expect(logger.getContext().after).toBeUndefined()
    warnSpy.mockRestore()
  })

  it('merges ai fields onto the emitted wide event before drain starts', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const logger = createRequestLogger(
      { method: 'POST', path: '/api/chat', requestId: 'r1' },
      { _deferDrain: true },
    )
    const emitted = logger.emit({ status: 200 })
    logger.set({ ai: { calls: 1, totalTokens: 42 } })
    expect(warnSpy).not.toHaveBeenCalled()
    expect(emitted?.ai).toEqual({ calls: 1, totalTokens: 42 })
    logger.set({ action: 'chat' })
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('does not merge ai fields after immediate drain when deferDrain is false', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const logger = createRequestLogger({ method: 'POST', path: '/api/chat', requestId: 'r1' })
    logger.emit({ status: 200 })
    logger.set({ ai: { calls: 1, totalTokens: 42 } })
    expect(warnSpy).toHaveBeenCalled()
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('Keys dropped: ai')
    warnSpy.mockRestore()
  })

  it('seals logger when emit returns null due to sampling', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    initLogger({
      pretty: false,
      sampling: { rates: { info: 0 } },
    })
    const logger = createRequestLogger({ method: 'GET', path: '/test' })
    expect(logger.emit()).toBeNull()
    logger.set({ lost: true })
    expect(warnSpy).toHaveBeenCalled()
    expect(logger.getContext().lost).toBeUndefined()
    warnSpy.mockRestore()
  })

  it('warns on second emit()', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const logger = createRequestLogger({ method: 'GET', path: '/x' })
    logger.emit()
    expect(logger.emit()).toBeNull()
    expect(warnSpy).toHaveBeenCalled()
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('log.emit()')
    warnSpy.mockRestore()
  })
})
