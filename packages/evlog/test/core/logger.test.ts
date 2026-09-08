import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError } from '../../src/error'
import { createLogger, createRequestLogger, getEnvironment, initLogger, isEnabled, log } from '../../src/logger'
import { withFakeTimers } from '../helpers/timers'
import { defined } from '../helpers/defined'

describe('initLogger', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('initializes with default values', () => {
    initLogger()
    const env = getEnvironment()

    expect(env.service).toBe('app')
    expect(env.environment).toBeDefined()
  })

  it('uses custom config values', () => {
    initLogger({
      env: {
        service: 'my-api',
        environment: 'staging',
        version: '1.2.3',
      },
    })

    const env = getEnvironment()

    expect(env.service).toBe('my-api')
    expect(env.environment).toBe('staging')
    expect(env.version).toBe('1.2.3')
  })

  it('reads from environment variables', () => {
    vi.stubEnv('SERVICE_NAME', 'env-service')
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('APP_VERSION', '2.0.0')

    initLogger()
    const env = getEnvironment()

    expect(env.service).toBe('env-service')
    expect(env.environment).toBe('production')
    expect(env.version).toBe('2.0.0')
  })

  it('prefers config over env vars', () => {
    vi.stubEnv('SERVICE_NAME', 'env-service')

    initLogger({
      env: { service: 'config-service' },
    })

    const env = getEnvironment()
    expect(env.service).toBe('config-service')
  })
})

describe('log', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    initLogger({ pretty: false })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs tagged message with info level', () => {
    log.info('auth', 'User logged in')
    expect(infoSpy).toHaveBeenCalled()
    const [[output]] = infoSpy.mock.calls
    expect(output).toContain('"level":"info"')
    expect(output).toContain('"tag":"auth"')
    expect(output).toContain('"message":"User logged in"')
  })

  it('logs wide event object', () => {
    log.info({ action: 'checkout', items: 3 })
    expect(infoSpy).toHaveBeenCalled()
    const [[output]] = infoSpy.mock.calls
    expect(output).toContain('"action":"checkout"')
    expect(output).toContain('"items":3')
  })

  it('uses error console method for error level', () => {
    const errorSpy = vi.spyOn(console, 'error')
    log.error('db', 'Connection failed')
    expect(errorSpy).toHaveBeenCalled()
  })

  it('uses warn console method for warn level', () => {
    const warnSpy = vi.spyOn(console, 'warn')
    log.warn('cache', 'Cache miss')
    expect(warnSpy).toHaveBeenCalled()
  })
})

describe('minLevel', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'debug').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('suppresses simple log calls below minLevel', () => {
    initLogger({ pretty: false, minLevel: 'warn' })
    log.info({ action: 'x' })
    log.debug({ action: 'y' })
    expect(infoSpy).not.toHaveBeenCalled()
    log.warn({ action: 'z' })
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('does not apply minLevel to createLogger.emit wide events', () => {
    initLogger({ pretty: false, minLevel: 'warn' })
    const logger = createRequestLogger({ method: 'GET', path: '/ok' })
    logger.set({ ok: true })
    logger.emit()
    expect(infoSpy).toHaveBeenCalledTimes(1)
    const [[output]] = infoSpy.mock.calls
    expect(String(output)).toContain('"level":"info"')
  })

  it('filters by minLevel even when sampling would keep the level', () => {
    initLogger({
      pretty: false,
      minLevel: 'warn',
      sampling: { rates: { info: 100, warn: 100 } },
    })
    log.info({ n: 1 })
    expect(infoSpy).not.toHaveBeenCalled()
    log.warn({ n: 2 })
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('still applies head sampling when minLevel allows the level', () => {
    initLogger({
      pretty: false,
      minLevel: 'debug',
      sampling: { rates: { info: 0 } },
    })
    log.info({ n: 1 })
    expect(infoSpy).not.toHaveBeenCalled()
  })
})
describe('createLogger', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    initLogger({ pretty: false })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates logger with arbitrary initial context', () => {
    const logger = createLogger({
      jobId: 'job-123',
      queue: 'emails',
      workerId: 'w-1',
    })

    const context = logger.getContext()
    expect(context.jobId).toBe('job-123')
    expect(context.queue).toBe('emails')
    expect(context.workerId).toBe('w-1')
  })

  // A handler that logs the error it then throws hands the same instance to
  // log.error() and to the integration's finish({ error }) (#457).
  it('records the same error twice without touching its read-only fields', () => {
    const internal = Object.defineProperty({}, 'code', {
      value: 'UPSTREAM_TIMEOUT',
      enumerable: true,
      writable: false,
    })
    const error = createError({ message: 'Upstream request failed', internal })
    const logger = createLogger()

    logger.error(error)
    expect(() => logger.error(error)).not.toThrow()

    const event = defined(logger.emit(), 'emitted event')
    expect(event.error).toMatchObject({
      message: 'Upstream request failed',
      internal: { code: 'UPSTREAM_TIMEOUT' },
    })
  })

  it('creates logger with empty context by default', () => {
    const logger = createLogger()

    const context = logger.getContext()
    expect(context).toEqual({})
  })

  it('accumulates context with set()', () => {
    const logger = createLogger({ jobId: 'job-1' })

    logger.set({ batch: { size: 50 } })
    logger.set({ batch: { processed: 12 } })

    const context = logger.getContext()
    expect(context.jobId).toBe('job-1')
    expect(context.batch).toEqual({ size: 50, processed: 12 })
  })

  it('emits wide event with accumulated context', () => {
    const logger = createLogger({ jobId: 'job-1', queue: 'sync' })
    logger.set({ recordsSynced: 150 })
    logger.emit()

    expect(infoSpy).toHaveBeenCalled()
    const [[output]] = infoSpy.mock.calls
    expect(output).toContain('"jobId":"job-1"')
    expect(output).toContain('"queue":"sync"')
    expect(output).toContain('"recordsSynced":150')
    expect(output).toContain('"duration"')
  })

  it('records error and emits at error level', () => {
    const errorSpy = vi.spyOn(console, 'error')
    const logger = createLogger({ workflowId: 'wf-42' })

    logger.error(new Error('Step failed'))
    logger.emit()

    expect(errorSpy).toHaveBeenCalled()
    const output = errorSpy.mock.calls[0]?.[0]
    expect(output).toContain('"level":"error"')
    expect(output).toContain('"workflowId":"wf-42"')
  })

  it('captures info and warn messages in requestLogs', () => {
    const logger = createLogger({ pipeline: 'etl' })

    logger.info('Extracting data')
    logger.warn('Slow downstream query')

    const context = logger.getContext()
    const logs = defined(context.requestLogs, 'requestLogs') as Array<{ message: string }>
    expect(logs.map(entry => entry.message)).toEqual(['Extracting data', 'Slow downstream query'])
  })

  it('returns WideEvent on emit', () => {
    const logger = createLogger({ taskId: 'task-1' })
    logger.set({ result: 'success' })

    const result = logger.emit()

    expect(result).not.toBeNull()
    expect(result).toHaveProperty('timestamp')
    expect(result).toHaveProperty('level', 'info')
    expect(result).toHaveProperty('taskId', 'task-1')
    expect(result).toHaveProperty('result', 'success')
  })

  it('returns null when disabled', () => {
    initLogger({ enabled: false, pretty: false })

    const logger = createLogger({ jobId: 'job-1' })
    const result = logger.emit()

    expect(result).toBeNull()
    expect(infoSpy).not.toHaveBeenCalled()
  })

  it('returns null when sampled out', () => {
    initLogger({ pretty: false, sampling: { rates: { info: 0 } } })

    const logger = createLogger({ jobId: 'job-1' })
    const result = logger.emit()

    expect(result).toBeNull()
  })

  it('does not include undefined values from missing HTTP fields', () => {
    const logger = createLogger({ jobId: 'job-1' })
    logger.emit()

    const [[output]] = infoSpy.mock.calls
    expect(output).not.toContain('"method"')
    expect(output).not.toContain('"path"')
    expect(output).not.toContain('"requestId"')
  })

  it('works with typed fields', () => {
    interface SyncFields {
      source: string
      target: string
      recordsSynced: number
    }

    const logger = createLogger<SyncFields>({ source: 'db', target: 's3' })
    logger.set({ recordsSynced: 100 })

    const ctx = logger.getContext()
    expect(ctx.source).toBe('db')
    expect(ctx.target).toBe('s3')
    expect(ctx.recordsSynced).toBe(100)
  })

  it('calls drain on emit', async () => {
    const drain = vi.fn()
    initLogger({ pretty: false, drain })

    const logger = createLogger({ jobId: 'job-1' })
    logger.set({ processed: 42 })
    logger.emit()

    await vi.waitFor(() => expect(drain).toHaveBeenCalledTimes(1))

    const [[ctx]] = drain.mock.calls
    expect(ctx.event.jobId).toBe('job-1')
    expect(ctx.event.processed).toBe(42)
  })
})

describe('createRequestLogger wraps createLogger', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    initLogger({ pretty: false })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('omits undefined options from context', () => {
    const logger = createRequestLogger({})

    const context = logger.getContext()
    expect(context).not.toHaveProperty('method')
    expect(context).not.toHaveProperty('path')
    expect(context).not.toHaveProperty('requestId')
  })
})

describe('drain callback', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    initLogger({ pretty: false })
  })

  it('calls drain with DrainContext on log.info()', async () => {
    const drain = vi.fn()
    initLogger({ pretty: false, drain })

    log.info({ action: 'test' })
    await vi.waitFor(() => expect(drain).toHaveBeenCalledTimes(1))

    const [[ctx]] = drain.mock.calls
    expect(ctx.event).toBeDefined()
    expect(ctx.event.level).toBe('info')
    expect(ctx.event.action).toBe('test')
  })

  it('calls drain on requestLogger.emit()', async () => {
    const drain = vi.fn()
    initLogger({ pretty: false, drain })

    const logger = createRequestLogger({ method: 'POST', path: '/checkout' })
    logger.set({ userId: '123' })
    logger.emit()

    await vi.waitFor(() => expect(drain).toHaveBeenCalledTimes(1))

    const [[ctx]] = drain.mock.calls
    expect(ctx.event.method).toBe('POST')
    expect(ctx.event.path).toBe('/checkout')
    expect(ctx.event.userId).toBe('123')
  })

  it('registers emit drain promise with waitUntil when provided', async () => {
    const drain = vi.fn().mockResolvedValue(undefined)
    const waitUntil = vi.fn()
    initLogger({ pretty: false, drain })

    const logger = createRequestLogger({
      method: 'GET',
      path: '/workers',
      waitUntil,
    })
    logger.emit()

    await vi.waitFor(() => expect(drain).toHaveBeenCalledTimes(1))
    expect(waitUntil).toHaveBeenCalledTimes(1)
    const [[scheduled]] = waitUntil.mock.calls
    expect(scheduled).toBeInstanceOf(Promise)
    await scheduled
  })

  it('does not call waitUntil when emit is sampled out', () => {
    const drain = vi.fn()
    const waitUntil = vi.fn()
    initLogger({
      pretty: false,
      drain,
      sampling: { rates: { info: 0 } },
    })

    const logger = createRequestLogger({
      method: 'GET',
      path: '/x',
      waitUntil,
    })
    logger.emit()

    expect(drain).not.toHaveBeenCalled()
    expect(waitUntil).not.toHaveBeenCalled()
  })

  it('does not call drain when event is sampled out', () => {
    const drain = vi.fn()
    initLogger({
      pretty: false,
      drain,
      sampling: { rates: { info: 0 } },
    })

    log.info({ action: 'sampled-out' })
    expect(drain).not.toHaveBeenCalled()
  })

  it('catches drain errors without throwing', async () => {
    const errorSpy = vi.spyOn(console, 'error')
    const drain = vi.fn().mockRejectedValue(new Error('drain error'))
    initLogger({ pretty: false, drain })

    log.info({ action: 'test' })

    await vi.waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith('[evlog] drain failed:', expect.any(Error)),
    )
  })

  it('works with async drain functions', async () => {
    const events: unknown[] = []
    const drain = vi.fn((ctx: { event: unknown }) => {
      events.push(ctx.event)
    })
    initLogger({ pretty: false, drain })

    log.info({ action: 'async-test' })
    await vi.waitFor(() => expect(events).toHaveLength(1))
  })

  it('does not call drain when no drain is configured', () => {
    initLogger({ pretty: false })
    // Should not throw
    log.info({ action: 'no-drain' })
  })
})

describe('sampling', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs everything when no sampling configured', () => {
    initLogger({ pretty: false })

    log.info('test', 'info message')
    log.warn('test', 'warn message')
    log.error('test', 'error message')

    expect(infoSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('logs everything when sampling rates are 100%', () => {
    initLogger({
      pretty: false,
      sampling: {
        rates: { info: 100, warn: 100, debug: 100, error: 100 },
      },
    })

    log.info('test', 'info message')
    log.warn('test', 'warn message')
    log.error('test', 'error message')

    expect(infoSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('skips all logs when sampling rate is 0%', () => {
    initLogger({
      pretty: false,
      sampling: {
        rates: { info: 0, warn: 0, debug: 0, error: 0 },
      },
    })

    log.info('test', 'info message')
    log.warn('test', 'warn message')
    log.debug('test', 'debug message')
    log.error('test', 'error message')

    expect(infoSpy).toHaveBeenCalledTimes(0)
    expect(warnSpy).toHaveBeenCalledTimes(0)
    expect(errorSpy).toHaveBeenCalledTimes(0)
  })

  it('always logs errors by default even when other levels are sampled', () => {
    initLogger({
      pretty: false,
      sampling: {
        rates: { info: 0, warn: 0, debug: 0 }, // error not specified, should default to 100%
      },
    })

    log.info('test', 'info message')
    log.warn('test', 'warn message')
    log.error('test', 'error message')

    expect(infoSpy).toHaveBeenCalledTimes(0)
    expect(warnSpy).toHaveBeenCalledTimes(0)
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('applies sampling to request logger emit', () => {
    initLogger({
      pretty: false,
      sampling: {
        rates: { info: 0 },
      },
    })

    const logger = createRequestLogger({ method: 'GET', path: '/test' })
    logger.emit()

    expect(infoSpy).toHaveBeenCalledTimes(0)
  })

  it('respects error rate for request logger with errors', () => {
    initLogger({
      pretty: false,
      sampling: {
        rates: { error: 0 }, // Explicitly set error to 0%
      },
    })

    const logger = createRequestLogger({ method: 'GET', path: '/test' })
    logger.error(new Error('test error'))
    logger.emit()

    expect(errorSpy).toHaveBeenCalledTimes(0)
  })

  it('samples probabilistically for rates between 0 and 100', () => {
    // Mock Math.random to control the sampling outcome
    const randomSpy = vi.spyOn(Math, 'random')

    initLogger({
      pretty: false,
      sampling: {
        rates: { info: 50 },
      },
    })

    // Simulate random returning 0.3 (30%) - should log (30 < 50)
    randomSpy.mockReturnValueOnce(0.3)
    log.info('test', 'should log')
    expect(infoSpy).toHaveBeenCalledTimes(1)

    // Simulate random returning 0.7 (70%) - should not log (70 >= 50)
    randomSpy.mockReturnValueOnce(0.7)
    log.info('test', 'should not log')
    expect(infoSpy).toHaveBeenCalledTimes(1) // Still 1, not logged

    randomSpy.mockRestore()
  })

  it('applies sampling to tagged logs in pretty mode', () => {
    // Pretty mode uses console.log for formatted output
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    initLogger({
      pretty: true,
      sampling: {
        rates: { info: 0 },
      },
    })

    log.info('test', 'should not log')
    expect(logSpy).toHaveBeenCalledTimes(0)
  })

  it('logs tagged messages in pretty mode when sampling rate is 100%', () => {
    // Pretty mode uses console.log for formatted output
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    initLogger({
      pretty: true,
      sampling: {
        rates: { info: 100 },
      },
    })

    log.info('test', 'should log')
    expect(logSpy).toHaveBeenCalledTimes(1)
  })
})

describe('tail sampling', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps logs when status meets threshold', () => {
    initLogger({
      pretty: false,
      sampling: {
        rates: { info: 0 }, // Would normally drop all info logs
        keep: [{ status: 400 }], // But keep if status >= 400
      },
    })

    const logger = createRequestLogger({ method: 'GET', path: '/test' })
    logger.set({ status: 500 }) // Error status
    logger.emit()

    expect(infoSpy).toHaveBeenCalledTimes(1)
  })

  it('does not keep logs when status is below threshold', () => {
    initLogger({
      pretty: false,
      sampling: {
        rates: { info: 0 },
        keep: [{ status: 400 }],
      },
    })

    const logger = createRequestLogger({ method: 'GET', path: '/test' })
    logger.set({ status: 200 }) // Success status
    logger.emit()

    expect(infoSpy).toHaveBeenCalledTimes(0)
  })

  it('keeps logs when duration meets threshold', async () => {
    initLogger({
      pretty: false,
      sampling: {
        rates: { info: 0 },
        keep: [{ duration: 50 }],
      },
    })

    await withFakeTimers(() => {
      const logger = createRequestLogger({ method: 'GET', path: '/test' })
      vi.advanceTimersByTime(60)
      logger.emit()

      expect(infoSpy).toHaveBeenCalledTimes(1)
    })
  })

  it('does not keep logs when duration is below threshold', () => {
    initLogger({
      pretty: false,
      sampling: {
        rates: { info: 0 },
        keep: [{ duration: 1000 }], // Keep if duration >= 1000ms
      },
    })

    const logger = createRequestLogger({ method: 'GET', path: '/test' })
    // Emit immediately (duration < 1000ms)
    logger.emit()

    expect(infoSpy).toHaveBeenCalledTimes(0)
  })

  it('keeps logs when path matches pattern', () => {
    initLogger({
      pretty: false,
      sampling: {
        rates: { info: 0 },
        keep: [{ path: '/api/critical/**' }],
      },
    })

    const logger = createRequestLogger({ method: 'GET', path: '/api/critical/checkout' })
    logger.emit()

    expect(infoSpy).toHaveBeenCalledTimes(1)
  })

  it('does not keep logs when path does not match pattern', () => {
    initLogger({
      pretty: false,
      sampling: {
        rates: { info: 0 },
        keep: [{ path: '/api/critical/**' }],
      },
    })

    const logger = createRequestLogger({ method: 'GET', path: '/api/normal/users' })
    logger.emit()

    expect(infoSpy).toHaveBeenCalledTimes(0)
  })

  it('uses OR logic for multiple conditions', () => {
    initLogger({
      pretty: false,
      sampling: {
        rates: { info: 0 },
        keep: [
          { status: 500 }, // Keep if status >= 500
          { path: '/api/critical/**' }, // OR path matches
        ],
      },
    })

    // Only path matches, status is 200
    const logger1 = createRequestLogger({ method: 'GET', path: '/api/critical/test' })
    logger1.set({ status: 200 })
    logger1.emit()
    expect(infoSpy).toHaveBeenCalledTimes(1)

    // Only status matches, path doesn't
    infoSpy.mockClear()
    const logger2 = createRequestLogger({ method: 'GET', path: '/api/normal' })
    logger2.set({ status: 500 })
    logger2.emit()
    expect(infoSpy).toHaveBeenCalledTimes(1)
  })

  it('force keeps logs via _forceKeep override', () => {
    initLogger({
      pretty: false,
      sampling: {
        rates: { info: 0 },
        // No keep conditions
      },
    })

    const logger = createRequestLogger({ method: 'GET', path: '/test' })
    logger.emit({ _forceKeep: true })

    expect(infoSpy).toHaveBeenCalledTimes(1)
  })

  it('strips _auditForceKeep from emitted events when _forceKeep is set', () => {
    initLogger({
      pretty: false,
      sampling: {
        rates: { info: 0 },
      },
    })

    const logger = createRequestLogger({ method: 'GET', path: '/test' })
    logger.audit({
      action: 'invoice.refund',
      actor: { type: 'user', id: 'u1' },
      target: { type: 'invoice', id: 'inv_1' },
    })
    const event = logger.emit({ _forceKeep: true })

    expect(event).toBeDefined()
    expect(event).not.toHaveProperty('_auditForceKeep')
  })

  it('head sampling still works when no tail conditions match', () => {
    initLogger({
      pretty: false,
      sampling: {
        rates: { info: 100 }, // Keep all info logs
        keep: [{ status: 500 }], // Tail condition won't match
      },
    })

    const logger = createRequestLogger({ method: 'GET', path: '/test' })
    logger.set({ status: 200 })
    logger.emit()

    // Should be logged because head sampling rate is 100%
    expect(infoSpy).toHaveBeenCalledTimes(1)
  })

  it('combines head and tail sampling correctly', () => {
    // Mock Math.random to control head sampling
    const randomSpy = vi.spyOn(Math, 'random')

    initLogger({
      pretty: false,
      sampling: {
        rates: { info: 50 }, // 50% head sampling
        keep: [{ status: 400 }], // Always keep errors
      },
    })

    // Random returns 0.9 (would fail 50% head sampling), but status is 400
    randomSpy.mockReturnValue(0.9)
    const logger1 = createRequestLogger({ method: 'GET', path: '/test' })
    logger1.set({ status: 400 })
    logger1.emit()
    expect(infoSpy).toHaveBeenCalledTimes(1) // Kept by tail sampling

    // Random returns 0.9 (would fail 50% head sampling), status is 200
    infoSpy.mockClear()
    const logger2 = createRequestLogger({ method: 'GET', path: '/test' })
    logger2.set({ status: 200 })
    logger2.emit()
    expect(infoSpy).toHaveBeenCalledTimes(0) // Dropped by head sampling

    randomSpy.mockRestore()
  })

  it('tail sampling keeps error-level logs that would be dropped by head sampling', () => {
    initLogger({
      pretty: false,
      sampling: {
        rates: { error: 0 }, // Explicitly drop all error logs via head sampling
        keep: [{ status: 500 }], // But keep via tail sampling if status >= 500
      },
    })

    const logger = createRequestLogger({ method: 'GET', path: '/test' })
    logger.error(new Error('test error')) // Sets hasError = true, level = error
    logger.set({ status: 500 })
    logger.emit()

    // Should be logged because tail sampling rescues it (status >= 500)
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('error-level logs respect head sampling when no tail conditions match', () => {
    initLogger({
      pretty: false,
      sampling: {
        rates: { error: 0 }, // Drop all error logs
        keep: [{ status: 500 }], // Only keep if status >= 500
      },
    })

    const logger = createRequestLogger({ method: 'GET', path: '/test' })
    logger.error(new Error('test error'))
    logger.set({ status: 400 }) // Status < 500, won't match tail condition
    logger.emit()

    // Should NOT be logged because head sampling drops it and tail condition doesn't match
    expect(errorSpy).toHaveBeenCalledTimes(0)
  })
})

describe('typed fields', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    initLogger({ pretty: false })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('accepts typed fields via set()', () => {
    interface MyFields {
      user: { id: string; plan: string }
      action: string
    }

    const logger = createRequestLogger<MyFields>({ method: 'GET', path: '/test' })
    logger.set({ user: { id: '123', plan: 'pro' } })
    logger.set({ action: 'checkout' })

    const ctx = logger.getContext()
    expect(ctx.user).toEqual({ id: '123', plan: 'pro' })
    expect(ctx.action).toBe('checkout')
  })

  it('accepts internal fields (status, service) alongside typed fields', () => {
    interface MyFields {
      user: { id: string }
    }

    const logger = createRequestLogger<MyFields>({})
    logger.set({ user: { id: '123' } })
    logger.set({ status: 200 })
    logger.set({ service: 'checkout' })

    const ctx = logger.getContext()
    expect(ctx.user).toEqual({ id: '123' })
    expect(ctx.status).toBe(200)
    expect(ctx.service).toBe('checkout')
  })

  it('getContext returns typed fields', () => {
    interface MyFields {
      action: string
      count: number
    }

    const logger = createRequestLogger<MyFields>({})
    logger.set({ action: 'test', count: 42 })

    const ctx = logger.getContext()
    expect(ctx.action).toBe('test')
    expect(ctx.count).toBe(42)
  })

  it('error() accepts typed context', () => {
    interface MyFields {
      order: { id: string }
    }

    const logger = createRequestLogger<MyFields>({})
    logger.error(new Error('fail'), { order: { id: 'ord-1' } })

    const ctx = logger.getContext()
    expect(ctx.order).toEqual({ id: 'ord-1' })
    expect(ctx.error).toBeDefined()
  })

  it('emit() accepts typed overrides', () => {
    const infoSpy = vi.spyOn(console, 'info')
    interface MyFields {
      result: string
    }

    const logger = createRequestLogger<MyFields>({})
    logger.emit({ result: 'success' })

    expect(infoSpy).toHaveBeenCalled()
    const [[output]] = infoSpy.mock.calls
    expect(output).toContain('"result":"success"')
  })

  it('untyped createRequestLogger still accepts any fields', () => {
    const logger = createRequestLogger({})
    logger.set({ anything: true, nested: { deep: 'value' } })

    const ctx = logger.getContext()
    expect(ctx.anything).toBe(true)
    expect(ctx.nested).toEqual({ deep: 'value' })
  })
})

describe('enabled option', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    initLogger({ pretty: false })
  })

  it('defaults to enabled', () => {
    initLogger()
    expect(isEnabled()).toBe(true)
  })

  it('can be explicitly enabled', () => {
    initLogger({ enabled: true })
    expect(isEnabled()).toBe(true)
  })

  it('silences log.info/error/warn/debug when disabled', () => {
    initLogger({ enabled: false, pretty: false })

    log.info('test', 'should not log')
    log.error('test', 'should not log')
    log.warn('test', 'should not log')
    log.debug('test', 'should not log')

    expect(infoSpy).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('silences wide event objects when disabled', () => {
    initLogger({ enabled: false, pretty: false })

    log.info({ action: 'test' })
    expect(infoSpy).not.toHaveBeenCalled()
  })

  it('makes createRequestLogger().emit() return null when disabled', () => {
    initLogger({ enabled: false, pretty: false })

    const logger = createRequestLogger({ method: 'GET', path: '/test' })
    const result = logger.emit()

    expect(result).toBeNull()
    expect(infoSpy).not.toHaveBeenCalled()
  })

  it('makes createRequestLogger().set/error no-op and getContext returns {}', () => {
    initLogger({ enabled: false, pretty: false })

    const logger = createRequestLogger({ method: 'GET', path: '/test' })
    logger.set({ user: { id: '123' } })
    logger.error(new Error('fail'))

    expect(logger.getContext()).toEqual({})
  })

  it('does not call drain when disabled', () => {
    const drain = vi.fn()
    initLogger({ enabled: false, pretty: false, drain })

    log.info({ action: 'test' })
    const logger = createRequestLogger({})
    logger.emit()

    expect(drain).not.toHaveBeenCalled()
  })

  it('works normally when enabled (default)', () => {
    initLogger({ pretty: false })

    log.info('test', 'should log')
    expect(infoSpy).toHaveBeenCalledTimes(1)

    const logger = createRequestLogger({ method: 'GET', path: '/test' })
    logger.set({ user: { id: '123' } })
    const result = logger.emit()

    expect(result).not.toBeNull()
    expect(result).toHaveProperty('level', 'info')
  })
})

describe('silent option', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    initLogger({ pretty: false })
  })

  it('suppresses console output for wide events', () => {
    initLogger({ silent: true, pretty: false })

    log.info({ action: 'test' })

    expect(infoSpy).not.toHaveBeenCalled()
  })

  it('suppresses console output for tagged logs (non-pretty)', () => {
    initLogger({ silent: true, pretty: false })

    log.info('auth', 'User logged in')

    expect(infoSpy).not.toHaveBeenCalled()
  })

  it('suppresses console output for tagged logs (pretty)', () => {
    initLogger({ silent: true, pretty: true })

    log.info('auth', 'User logged in')

    expect(logSpy).not.toHaveBeenCalled()
  })

  it('suppresses console output for request logger emit', () => {
    initLogger({ silent: true, pretty: false })

    const logger = createRequestLogger({ method: 'GET', path: '/test' })
    logger.set({ user: { id: '123' } })
    const result = logger.emit()

    expect(result).not.toBeNull()
    expect(infoSpy).not.toHaveBeenCalled()
  })

  it('still returns WideEvent from emit', () => {
    initLogger({ silent: true, pretty: false })

    const logger = createRequestLogger({ method: 'GET', path: '/test' })
    logger.set({ action: 'checkout' })
    const result = logger.emit()

    expect(result).not.toBeNull()
    expect(result).toHaveProperty('level', 'info')
    expect(result).toHaveProperty('action', 'checkout')
  })

  it('still calls drain when silent', async () => {
    const drain = vi.fn()
    initLogger({ silent: true, pretty: false, drain })

    log.info({ action: 'test' })

    await vi.waitFor(() => expect(drain).toHaveBeenCalledTimes(1))
    const [[ctx]] = drain.mock.calls
    expect(ctx.event.action).toBe('test')
  })

  it('still calls drain for request logger when silent', async () => {
    const drain = vi.fn()
    initLogger({ silent: true, pretty: false, drain })

    const logger = createRequestLogger({ method: 'POST', path: '/checkout' })
    logger.set({ cart: { items: 3 } })
    logger.emit()

    await vi.waitFor(() => expect(drain).toHaveBeenCalledTimes(1))
    const [[ctx]] = drain.mock.calls
    expect(ctx.event.path).toBe('/checkout')
  })

  it('still applies sampling when silent', () => {
    const drain = vi.fn()
    initLogger({
      silent: true,
      pretty: false,
      drain,
      sampling: { rates: { info: 0 } },
    })

    log.info({ action: 'sampled-out' })
    expect(drain).not.toHaveBeenCalled()
  })

  it('tagged logs in silent+pretty mode go through drain as structured events', async () => {
    const drain = vi.fn()
    initLogger({ silent: true, pretty: true, drain })

    log.info('auth', 'User logged in')

    expect(logSpy).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(drain).toHaveBeenCalledTimes(1))
    const [[ctx]] = drain.mock.calls
    expect(ctx.event.tag).toBe('auth')
    expect(ctx.event.message).toBe('User logged in')
  })
})

describe('pretty dev timestamp consistency', () => {
  const timestampPattern = /\d{2}:\d{2}:\d{2}\.\d{3}/

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    initLogger({ pretty: true })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('includes timestamp in dev pretty wide event and tagged log headers', () => {
    const logSpy = vi.mocked(console.log)

    log.info({ message: 'Test' })
    log.warn('server', 'test')

    expect(logSpy).toHaveBeenCalledTimes(2)

    const wideOutput = String(logSpy.mock.calls[0]![0])
    const taggedOutput = String(logSpy.mock.calls[1]![0])

    expect(wideOutput).toMatch(timestampPattern)
    expect(taggedOutput).toMatch(timestampPattern)
  })
})

describe('pretty-print tool input serialization', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    initLogger({ pretty: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not throw on BigInt or circular tool inputs', () => {
    const circular: Record<string, unknown> = { a: 1 }
    circular.self = circular
    const logger = createRequestLogger({ method: 'GET', path: '/ai', requestId: 'r1' })
    logger.set({
      ai: {
        toolCalls: [
          { name: 'big', input: { n: 1n } },
          { name: 'circ', input: circular },
        ],
      },
    })
    expect(() => logger.emit()).not.toThrow()
  })
})

describe('pretty-print captured prompt and output', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    initLogger({ pretty: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders captured prompt and output as tree lines', () => {
    const logger = createRequestLogger({ method: 'POST', path: '/chat', requestId: 'r1' })
    logger.set({
      ai: {
        calls: 1,
        prompt: '[system] You are helpful\n\n[user] Hi there',
        output: 'Hello! How can I help?',
      },
    })
    logger.emit()

    const logSpy = vi.mocked(console.log)
    const output = logSpy.mock.calls.map(call => String(call[0])).join('\n')

    expect(output).toContain('ai.prompt:')
    expect(output).toContain('[system] You are helpful')
    expect(output).toContain('[user] Hi there')
    expect(output).toContain('ai.output:')
    expect(output).toContain('Hello! How can I help?')
  })

  it('truncates long captured text in the console', () => {
    const logger = createRequestLogger({ method: 'POST', path: '/chat', requestId: 'r2' })
    const longLine = 'x'.repeat(300)
    logger.set({
      ai: {
        output: longLine,
      },
    })
    logger.emit()

    const logSpy = vi.mocked(console.log)
    const output = logSpy.mock.calls.map(call => String(call[0])).join('\n')

    expect(output).toContain('ai.output:')
    expect(output).toContain(`${'x'.repeat(160)}…`)
    expect(output).not.toContain('x'.repeat(200))
  })

  it('marks additional lines beyond the console cap', () => {
    const logger = createRequestLogger({ method: 'POST', path: '/chat', requestId: 'r3' })
    const manyLines = Array.from({ length: 12 }, (_, i) => `line ${i}`)
    logger.set({
      ai: {
        prompt: manyLines.join('\n'),
      },
    })
    logger.emit()

    const logSpy = vi.mocked(console.log)
    const output = logSpy.mock.calls.map(call => String(call[0])).join('\n')

    expect(output).toContain('+4 more lines (full text in the event)')
  })

  it('omits entries when nothing was captured', () => {
    const logger = createRequestLogger({ method: 'POST', path: '/chat', requestId: 'r4' })
    logger.set({
      ai: { calls: 1 },
    })
    logger.emit()

    const logSpy = vi.mocked(console.log)
    const output = logSpy.mock.calls.map(call => String(call[0])).join('\n')

    expect(output).not.toContain('ai.prompt:')
    expect(output).not.toContain('ai.output:')
  })
})

describe('pretty-print array field values', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    initLogger({ pretty: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('serializes top-level array of objects as JSON instead of [object Object]', () => {
    log.info({ action: 'demo', issues: [{ code: 'invalid_union', path: [], message: 'Invalid input' }] })

    const logSpy = vi.mocked(console.log)
    const output = logSpy.mock.calls.map(call => String(call[0])).join('\n')

    expect(output).not.toContain('[object Object]')
    expect(output).toContain('[{"code":"invalid_union","path":[],"message":"Invalid input"}]')
  })

  it('serializes array of strings', () => {
    log.info({ action: 'test', tags: ['a', 'b', 'c'] })

    const logSpy = vi.mocked(console.log)
    const output = logSpy.mock.calls.map(call => String(call[0])).join('\n')

    expect(output).not.toContain('[object Object]')
    expect(output).toContain('["a","b","c"]')
  })
})
