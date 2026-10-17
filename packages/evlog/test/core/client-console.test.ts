// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError as h3CreateError } from 'h3'
import type { LogLevel } from '../../src/types'
import { EvlogError, createError } from '../../src/error'
import { initLog, log, setMinLevel } from '../../src/runtime/client/log'
import { defined } from '../helpers/defined'

describe('client console option', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('interpolates printf-style args into tagged client messages', () => {
    initLog({ enabled: true, pretty: true })

    log.warn('api', 'quota %d% used for user %s', 80, 'alice')

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toContain('[api]%c quota 80%% used for user alice')
  })

  it('treats a first string with a specifier as a pino-style format string', () => {
    initLog({ enabled: true, pretty: true })

    log.info('user %s logged in', 'alice')

    expect(infoSpy).toHaveBeenCalledTimes(1)
    expect(infoSpy.mock.calls[0]?.[0]).toContain('[log]%c user alice logged in')
  })

  it('outputs to console by default', () => {
    initLog({ enabled: true, pretty: false })

    log.info({ action: 'test' })

    expect(infoSpy).toHaveBeenCalledTimes(1)
  })

  it('uses console.log for debug level (not console.debug) for DevTools visibility', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    initLog({ enabled: true, pretty: false, minLevel: 'debug' })
    log.debug({ action: 'dbg' })
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(infoSpy).not.toHaveBeenCalled()
  })

  it('maps fatal to console.error and outputs trace through console.log', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    initLog({ enabled: true, pretty: false })

    log.fatal({ action: 'fatal-thing' })
    log.trace({ action: 'trace-thing' })

    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledTimes(1)
  })

  it('suppresses console output when console is false', () => {
    initLog({ enabled: true, console: false, pretty: false })

    log.info({ action: 'test' })
    log.error({ action: 'test' })
    log.warn({ action: 'test' })

    expect(infoSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('still sends to transport when console is false', () => {
    initLog({
      enabled: true,
      console: false,
      pretty: false,
      transport: { enabled: true, endpoint: '/api/_evlog/ingest' },
    })

    log.info({ action: 'test' })

    expect(infoSpy).not.toHaveBeenCalled()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('uses custom credentials mode for transport', () => {
    initLog({
      enabled: true,
      console: false,
      pretty: false,
      transport: { enabled: true, endpoint: '/api/_evlog/ingest', credentials: 'include' },
    })

    log.info({ action: 'test' })

    const [, options] = fetchSpy.mock.calls[0]!
    expect(options?.credentials).toBe('include')
  })

  it('suppresses pretty console output when console is false', () => {
    initLog({ enabled: true, console: false, pretty: true })

    log.info({ action: 'test' })

    expect(infoSpy).not.toHaveBeenCalled()
    expect(console.log).not.toHaveBeenCalled()
  })

  it('suppresses tagged logs in pretty mode when console is false', () => {
    initLog({
      enabled: true,
      console: false,
      pretty: true,
      transport: { enabled: true, endpoint: '/api/_evlog/ingest' },
    })

    log.info('auth', 'User logged in')

    expect(infoSpy).not.toHaveBeenCalled()
    expect(console.log).not.toHaveBeenCalled()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('stops everything when enabled is false (regardless of console)', () => {
    initLog({
      enabled: false,
      console: true,
      pretty: false,
      transport: { enabled: true, endpoint: '/api/_evlog/ingest' },
    })

    log.info({ action: 'test' })

    expect(infoSpy).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('restores console output when console is set back to true', () => {
    initLog({ enabled: true, console: false, pretty: false })
    log.info({ action: 'silent' })
    expect(infoSpy).not.toHaveBeenCalled()

    initLog({ enabled: true, console: true, pretty: false })
    log.info({ action: 'visible' })
    expect(infoSpy).toHaveBeenCalledTimes(1)
  })
})

describe('client minLevel', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('suppresses console and transport below minLevel', () => {
    initLog({
      enabled: true,
      pretty: false,
      minLevel: 'warn',
      transport: { enabled: true, endpoint: '/api/_evlog/ingest' },
    })
    log.info({ action: 'x' })
    expect(infoSpy).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('falls back to debug when minLevel is not a valid level', () => {
    initLog({
      enabled: true,
      pretty: false,
      minLevel: '' as LogLevel,
      transport: { enabled: true, endpoint: '/api/_evlog/ingest' },
    })
    log.info({ action: 'x' })
    expect(infoSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('setMinLevel enables verbose logs at runtime', () => {
    initLog({ enabled: true, pretty: false, minLevel: 'warn' })
    log.info({ action: 'hidden' })
    expect(infoSpy).not.toHaveBeenCalled()

    setMinLevel('debug')
    log.info({ action: 'visible' })
    expect(infoSpy).toHaveBeenCalledTimes(1)
  })
})

describe('client log.error with an Error instance', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const emitted = () => JSON.parse(errorSpy.mock.calls[0]![0] as string)

  it('keeps name, message and stack', () => {
    initLog({ enabled: true, pretty: false })

    log.error(new Error('Payment declined'))

    expect(emitted().error).toMatchObject({ name: 'Error', message: 'Payment declined' })
    expect(emitted().error.stack).toBeTruthy()
  })

  it('carries the extra fields attached to the error', () => {
    initLog({ enabled: true, pretty: false })

    log.error(Object.assign(new Error('Nope'), { code: 'E_DECLINED', status: 402 }))

    expect(emitted().error).toMatchObject({ code: 'E_DECLINED', status: 402 })
  })

  it('keeps internal and the EvlogError metadata the server logger stores', () => {
    initLog({ enabled: true, pretty: false })

    log.error(Object.assign(new Error('Declined'), {
      internal: true,
      why: 'card expired',
      fix: 'ask for another card',
      link: 'https://example.com/declined',
    }))

    expect(emitted().error).toMatchObject({
      internal: true,
      why: 'card expired',
      fix: 'ask for another card',
      link: 'https://example.com/declined',
    })
  })

  it('serializes an Error cause instead of flattening it to {}', () => {
    initLog({ enabled: true, pretty: false })

    log.error(new Error('Outer', { cause: new Error('Inner') }))

    expect(emitted().error.cause).toMatchObject({ name: 'Error', message: 'Inner' })
    expect(emitted().error.cause.stack).toBeTruthy()
  })

  it('survives a cyclic cause chain', () => {
    initLog({ enabled: true, pretty: false })

    const outer = new Error('Outer')
    const inner = new Error('Inner', { cause: outer })
    ;(outer as Error & { cause?: unknown }).cause = inner

    expect(() => log.error(outer)).not.toThrow()
    expect(emitted().error.cause).toMatchObject({ message: 'Inner' })
  })

  it('leaves plain event objects untouched', () => {
    initLog({ enabled: true, pretty: false })

    log.error({ action: 'payment', error: 'declined' })

    expect(emitted()).toMatchObject({ action: 'payment', error: 'declined' })
  })

  describe('an Error inside an object event', () => {
    const initTransport = (options: { enabled?: boolean, minLevel?: LogLevel } = {}) => initLog({
      enabled: options.enabled ?? true,
      minLevel: options.minLevel,
      console: false,
      pretty: false,
      transport: { enabled: true, endpoint: '/api/_evlog/ingest' },
    })
    const sent = () => {
      const [, options] = defined(fetchSpy.mock.calls[0], 'transport call')
      return JSON.parse(String(defined(options, 'transport request').body))
    }

    it('is serialized at any depth', () => {
      initTransport()
      const error = new Error('Payment declined', { cause: new Error('Card expired') })

      log.error({ action: 'checkout', error, job: { failure: error } })

      const expected = {
        name: 'Error',
        message: 'Payment declined',
        stack: expect.any(String),
        cause: { name: 'Error', message: 'Card expired', stack: expect.any(String) },
      }
      expect(sent().error).toEqual(expected)
      expect(sent().job.failure).toEqual(expected)
      expect(sent().action).toBe('checkout')
    })

    it('carries the fields it exposes as getters', () => {
      initTransport()
      const error = new Error('[GET] "/api/cart": 500 Internal Server Error')
      Object.defineProperty(error, 'statusCode', { get: () => 500 })

      log.error({ action: 'cart', error })

      expect(sent().error).toMatchObject({ message: '[GET] "/api/cart": 500 Internal Server Error', statusCode: 500 })
    })

    it('serializes an Error inside its own fields', () => {
      initTransport()

      log.error({ action: 'checkout', error: new Error('Payment declined', { cause: { gateway: new Error('Timeout') } }) })

      expect(sent().error.cause.gateway).toMatchObject({ name: 'Error', message: 'Timeout' })
    })

    it('replaces a cycle with [Circular]', () => {
      initTransport()
      const event: Record<string, unknown> = { action: 'checkout', error: new Error('Payment declined') }
      event.self = event

      expect(() => log.error(event)).not.toThrow()
      expect(sent().self).toBe('[Circular]')
    })

    it('leaves an object that defines toJSON to it', () => {
      initTransport()
      class Card {
        constructor(readonly number: string, readonly error: Error) {}
        toJSON() {
          return { last4: this.number.slice(-4) }
        }
      }

      log.error({ action: 'checkout', card: new Card('4242424242424242', new Error('Declined')) })

      expect(sent().card).toEqual({ last4: '4242' })
    })

    it('drops the data and internal fields its own toJSON leaves out', () => {
      initTransport()
      class PaymentError extends Error {
        data = { cardNumber: '4242424242424242' }
        internal = { token: 'tok_secret' }
        toJSON() {
          return { name: this.name, message: this.message }
        }
      }

      log.error({ action: 'checkout', error: new PaymentError('Declined') })

      expect(sent().error).toEqual({ name: 'Error', message: 'Declined', stack: expect.any(String) })
    })

    it('keeps the data an h3 error carries', () => {
      initTransport()

      log.error({ action: 'checkout', error: h3CreateError({ statusCode: 502, message: 'Upstream failed', data: { provider: 'stripe' } }) })

      expect(sent().error).toMatchObject({ statusCode: 502, data: { provider: 'stripe' }, stack: expect.any(String) })
    })

    it('serializes an EvlogError without reading its legacy status getters', () => {
      initTransport()
      const spies = (['statusCode', 'statusText', 'statusMessage'] as const).map(name => vi.spyOn(EvlogError.prototype, name, 'get'))

      log.error({ action: 'checkout', error: createError({ message: 'Payment failed', status: 402 }) })

      expect(sent().error).toMatchObject({ status: 402, statusCode: 402, statusText: 'Payment failed', statusMessage: 'Payment failed' })
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    })

    it.each([
      ['an Error', (error: Error) => log.error(error)],
      ['an object event', (error: Error) => log.error({ action: 'checkout', error })],
    ])('serializes an h3 wrapper once (%s)', (_name, logIt) => {
      initTransport()
      const original = new Error('kaboom')

      logIt(h3CreateError(original as any) as any)

      expect(sent().error).toMatchObject({ name: 'Error', message: 'kaboom', stack: original.stack, statusCode: 500 })
      expect(sent().error).not.toHaveProperty('cause')
    })

    it('drops the options object h3 keeps as cause', () => {
      initTransport()

      log.error({ action: 'checkout', error: h3CreateError({ statusCode: 400, message: 'Missing required field: timestamp' }) })

      expect(sent().error).toMatchObject({ message: 'Missing required field: timestamp', statusCode: 400 })
      expect(sent().error).not.toHaveProperty('cause')
    })

    it.each([
      ['disabled', { enabled: false }],
      ['below minLevel', { minLevel: 'error' as const }],
    ])('is not read when logging is %s', (_name, options) => {
      initTransport(options)
      const event = {
        action: 'checkout',
        get failure(): Error {
          throw new Error('read')
        },
      }

      expect(() => log.warn(event)).not.toThrow()
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })
})

describe('client pretty console', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const printed = () => defined(errorSpy.mock.calls[0], 'console call')[3] as Record<string, unknown>

  it.each([
    ['an Error', (error: Error) => log.error(error)],
    ['an object event', (error: Error) => log.error({ action: 'checkout', error })],
  ])('hands DevTools the Error itself and sends it serialized (%s)', (_name, logIt) => {
    initLog({ enabled: true, pretty: true, transport: { enabled: true, endpoint: '/api/_evlog/ingest' } })
    const error = new Error('Payment declined')

    logIt(error)

    expect(printed().error).toBe(error)
    const [, options] = defined(fetchSpy.mock.calls[0], 'transport call')
    expect(JSON.parse(String(defined(options, 'transport request').body)).error).toMatchObject({ name: 'Error', message: 'Payment declined', stack: error.stack })
  })

  it('reads the event once when nothing sends it as JSON', () => {
    initLog({ enabled: true, pretty: true })
    const read = vi.fn(() => 'value')
    const event = {
      action: 'checkout',
      get detail() {
        return read()
      },
    }

    log.error(event)

    expect(read).toHaveBeenCalledTimes(1)
    expect(printed()).toMatchObject({ action: 'checkout', detail: 'value' })
  })
})
