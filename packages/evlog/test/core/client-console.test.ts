// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initLog, log, setMinLevel } from '../../src/runtime/client/log'

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

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
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
})
