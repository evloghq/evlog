import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock next/server to prevent import errors
vi.mock('next/server', () => ({ after: undefined }))

// Spy on initLogger to verify register() calls it correctly
const initLoggerSpy = vi.fn()
const logInfoSpy = vi.fn()
const logErrorSpy = vi.fn()
vi.mock('../../src/logger', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/logger')>()
  return {
    ...mod,
    initLogger: (...args: unknown[]) => {
      initLoggerSpy(...args)
      return mod.initLogger(...(args as Parameters<typeof mod.initLogger>))
    },
    log: {
      ...mod.log,
      info: (...args: unknown[]) => {
        logInfoSpy(...args)
        return mod.log.info(...(args as Parameters<typeof mod.log.info>))
      },
      error: (...args: unknown[]) => {
        logErrorSpy(...args)
        return mod.log.error(...(args as Parameters<typeof mod.log.error>))
      },
    },
  }
})

describe('createInstrumentation', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  let originalStdoutWrite: typeof process.stdout.write
  let originalStderrWrite: typeof process.stderr.write
  let originalNextRuntime: string | undefined

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    originalStdoutWrite = process.stdout.write
    originalStderrWrite = process.stderr.write
    originalNextRuntime = process.env.NEXT_RUNTIME
    initLoggerSpy.mockClear()
    logInfoSpy.mockClear()
    logErrorSpy.mockClear()
  })

  afterEach(() => {
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
    if (originalNextRuntime === undefined) {
      delete process.env.NEXT_RUNTIME
    } else {
      process.env.NEXT_RUNTIME = originalNextRuntime
    }
    vi.restoreAllMocks()
    // Reset module state between tests so `registered` flag is fresh
    vi.resetModules()
  })

  async function loadModule() {
    const mod = await import('../../src/next/instrumentation-create')
    return mod.createInstrumentation
  }

  async function runRegister(register: () => void | Promise<void>) {
    await register()
  }

  it('register() calls initLogger() with correct config', async () => {
    const createInstrumentation = await loadModule()
    const drainMock = vi.fn()
    const { register } = createInstrumentation({
      service: 'my-app',
      pretty: false,
      silent: true,
      drain: drainMock,
      sampling: { rates: { info: 50 } },
      stringify: false,
      redact: { paths: ['error.message', 'error.cause'] },
    })

    await runRegister(register)

    expect(initLoggerSpy).toHaveBeenCalledTimes(1)
    const [[config]] = initLoggerSpy.mock.calls
    expect(config.env.service).toBe('my-app')
    expect(config.pretty).toBe(false)
    expect(config.silent).toBe(true)
    expect(typeof config.drain).toBe('function')
    await config.drain({ event: { message: 'test' } })
    expect(drainMock).toHaveBeenCalledTimes(1)
    expect(config.sampling).toEqual({ rates: { info: 50 } })
    expect(config.stringify).toBe(false)
    expect(config.redact).toEqual({ paths: ['error.message', 'error.cause'] })
  })

  it('register() with captureOutput patches stdout and stderr', async () => {
    const createInstrumentation = await loadModule()
    process.env.NEXT_RUNTIME = 'nodejs'

    const { register } = createInstrumentation({
      captureOutput: true,
      pretty: false,
    })

    await runRegister(register)

    expect(process.stdout.write).not.toBe(originalStdoutWrite)
    expect(process.stderr.write).not.toBe(originalStderrWrite)
  })

  it('register() without captureOutput does NOT patch stdout/stderr', async () => {
    const createInstrumentation = await loadModule()
    process.env.NEXT_RUNTIME = 'nodejs'

    const { register } = createInstrumentation({ pretty: false })

    await runRegister(register)

    expect(process.stdout.write).toBe(originalStdoutWrite)
    expect(process.stderr.write).toBe(originalStderrWrite)
  })

  it('edge runtime safety: no patching when NEXT_RUNTIME is not nodejs', async () => {
    const createInstrumentation = await loadModule()
    process.env.NEXT_RUNTIME = 'edge'

    const { register } = createInstrumentation({
      captureOutput: true,
      pretty: false,
    })

    await runRegister(register)

    expect(process.stdout.write).toBe(originalStdoutWrite)
    expect(process.stderr.write).toBe(originalStderrWrite)
  })

  it('onRequestError() emits structured event with correct fields', async () => {
    const createInstrumentation = await loadModule()
    const drainMock = vi.fn()
    const { register, onRequestError } = createInstrumentation({
      pretty: false,
      drain: drainMock,
    })

    await runRegister(register)

    const error = Object.assign(new Error('Something broke'), { digest: 'abc123' })
    const request = { path: '/api/checkout', method: 'POST', headers: {} }
    const context = {
      routerKind: 'App Router',
      routePath: '/api/checkout',
      routeType: 'route',
      renderSource: 'react-server-components',
    }

    await onRequestError(error, request, context)

    expect(consoleErrorSpy).toHaveBeenCalled()
    const [[output]] = consoleErrorSpy.mock.calls
    const parsed = JSON.parse(output)

    expect(parsed.level).toBe('error')
    expect(parsed.message).toBe('Something broke')
    expect(parsed.digest).toBe('abc123')
    expect(parsed.stack).toBeDefined()
    expect(parsed.path).toBe('/api/checkout')
    expect(parsed.method).toBe('POST')
    expect(parsed.routerKind).toBe('App Router')
    expect(parsed.routePath).toBe('/api/checkout')
    expect(parsed.routeType).toBe('route')
    expect(parsed.renderSource).toBe('react-server-components')
  })

  it('events go through drain', async () => {
    const createInstrumentation = await loadModule()
    const drainMock = vi.fn()
    const { register, onRequestError } = createInstrumentation({
      pretty: false,
      drain: drainMock,
    })

    await runRegister(register)

    const error = Object.assign(new Error('fail'), { digest: 'x' })
    await onRequestError(error, { path: '/test', method: 'GET', headers: {} }, {
      routerKind: 'App Router',
      routePath: '/test',
      routeType: 'page',
      renderSource: 'react-server-components',
    })

    // Drain is called fire-and-forget via Promise.resolve().catch()
    // Give it a tick to resolve
    await vi.waitFor(() => expect(drainMock).toHaveBeenCalledTimes(1))

    const [[drainCtx]] = drainMock.mock.calls
    expect(drainCtx.event).toBeDefined()
    expect(drainCtx.event.message).toBe('fail')
  })

  it('re-entrancy guard prevents infinite recursion', async () => {
    const createInstrumentation = await loadModule()
    process.env.NEXT_RUNTIME = 'nodejs'

    const { register } = createInstrumentation({
      captureOutput: true,
      pretty: true,
    })

    await runRegister(register)

    // This should NOT cause infinite recursion:
    // stdout.write -> log.info -> pretty print -> console.log -> stdout.write -> GUARD stops
    expect(() => {
      process.stdout.write('trigger\n')
    }).not.toThrow()
  })

  it('register() is idempotent — second call is a no-op', async () => {
    const createInstrumentation = await loadModule()
    const { register } = createInstrumentation({ pretty: false })
    await runRegister(register)
    await runRegister(register)
    expect(initLoggerSpy).toHaveBeenCalledTimes(1)
  })

  it('createInstrumentation() with enabled: false', async () => {
    const createInstrumentation = await loadModule()
    const { register, onRequestError } = createInstrumentation({
      enabled: false,
      pretty: false,
    })

    await runRegister(register)

    expect(initLoggerSpy).toHaveBeenCalledTimes(1)
    const [[config]] = initLoggerSpy.mock.calls
    expect(config.enabled).toBe(false)

    const error = Object.assign(new Error('fail'), { digest: 'x' })
    await onRequestError(error, { path: '/test', method: 'GET', headers: {} }, {
      routerKind: 'App Router',
      routePath: '/test',
      routeType: 'route',
      renderSource: 'react-server-components',
    })

    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('createInstrumentation() with default options', async () => {
    const createInstrumentation = await loadModule()
    const { register } = createInstrumentation()
    await expect(runRegister(register)).resolves.toBeUndefined()
    expect(initLoggerSpy).toHaveBeenCalledTimes(1)
  })

  it('onRequestError() with undefined digest', async () => {
    const createInstrumentation = await loadModule()
    const { register, onRequestError } = createInstrumentation({ pretty: false })

    await runRegister(register)

    const error = new Error('fail') as { digest?: string } & Error
    await onRequestError(error, { path: '/test', method: 'GET', headers: {} }, {
      routerKind: 'App Router',
      routePath: '/test',
      routeType: 'route',
      renderSource: 'react-server-components',
    })

    expect(consoleErrorSpy).toHaveBeenCalled()
    const [[output]] = consoleErrorSpy.mock.calls
    const parsed = JSON.parse(output)
    expect(parsed.digest).toBeUndefined()
  })

  it('captureOutput with NEXT_RUNTIME undefined', async () => {
    const createInstrumentation = await loadModule()
    delete process.env.NEXT_RUNTIME

    const { register } = createInstrumentation({
      captureOutput: true,
      pretty: false,
    })

    await runRegister(register)

    expect(process.stdout.write).toBe(originalStdoutWrite)
    expect(process.stderr.write).toBe(originalStderrWrite)
  })

  it('captureOutput ignores default Next.js edge bundler warnings on stderr', async () => {
    const createInstrumentation = await loadModule()
    process.env.NEXT_RUNTIME = 'nodejs'

    const { register } = createInstrumentation({
      captureOutput: true,
      pretty: false,
      silent: true,
    })

    await runRegister(register)

    process.stderr.write('A Node.js module is loaded in the Edge Runtime: node-module-in-edge-runtime\n')
    expect(logErrorSpy).not.toHaveBeenCalled()

    process.stderr.write('real application stderr\n')
    expect(logErrorSpy).toHaveBeenCalledTimes(1)
    expect(logErrorSpy.mock.calls[0]?.[0]).toMatchObject({
      source: 'stderr',
      message: 'real application stderr',
    })
  })

  it('captureOutput object can disable stdout while keeping stderr', async () => {
    const createInstrumentation = await loadModule()
    process.env.NEXT_RUNTIME = 'nodejs'

    const { register } = createInstrumentation({
      captureOutput: { stdout: false, stderr: true },
      pretty: false,
      silent: true,
    })

    await runRegister(register)

    expect(process.stdout.write).toBe(originalStdoutWrite)
    expect(process.stderr.write).not.toBe(originalStderrWrite)

    process.stderr.write('stderr only\n')
    expect(logErrorSpy).toHaveBeenCalledTimes(1)
    expect(logInfoSpy).not.toHaveBeenCalled()
  })

  it('captureOutput without silent suppresses passthrough to avoid terminal duplication', async () => {
    const createInstrumentation = await loadModule()
    process.env.NEXT_RUNTIME = 'nodejs'

    const passthroughSpy = vi.fn()
    process.stdout.write = function(chunk: unknown, ...args: unknown[]) {
      passthroughSpy()
      return originalStdoutWrite.call(process.stdout, chunk as string, ...args as [])
    } as typeof process.stdout.write

    const { register } = createInstrumentation({
      captureOutput: true,
      pretty: false,
      silent: false,
    })

    await runRegister(register)

    passthroughSpy.mockClear()
    process.stdout.write('hello from next\n')

    expect(logInfoSpy).toHaveBeenCalledTimes(1)
    expect(logInfoSpy.mock.calls[0]?.[0]).toMatchObject({
      source: 'stdout',
      message: 'hello from next',
    })
    expect(passthroughSpy).not.toHaveBeenCalled()
  })

  it('captureOutput with silent passthroughs raw output for drain-only setups', async () => {
    const createInstrumentation = await loadModule()
    process.env.NEXT_RUNTIME = 'nodejs'

    const passthroughSpy = vi.fn()
    process.stdout.write = function(chunk: unknown, ...args: unknown[]) {
      passthroughSpy()
      return originalStdoutWrite.call(process.stdout, chunk as string, ...args as [])
    } as typeof process.stdout.write

    const { register } = createInstrumentation({
      captureOutput: true,
      pretty: false,
      silent: true,
    })

    await runRegister(register)

    passthroughSpy.mockClear()
    process.stdout.write('hello from next\n')

    expect(logInfoSpy).toHaveBeenCalledTimes(1)
    expect(passthroughSpy).toHaveBeenCalledTimes(1)
  })

  it('captureOutput custom ignore replaces the default filter', async () => {
    const createInstrumentation = await loadModule()
    process.env.NEXT_RUNTIME = 'nodejs'

    const { register } = createInstrumentation({
      captureOutput: { ignore: ['benign warning'] },
      pretty: false,
      silent: true,
    })

    await runRegister(register)

    process.stderr.write('node-module-in-edge-runtime\n')
    expect(logErrorSpy).toHaveBeenCalledTimes(1)

    logErrorSpy.mockClear()
    process.stderr.write('benign warning from dependency\n')
    expect(logErrorSpy).not.toHaveBeenCalled()
  })

  it('captureOutput uses the latest registration filters without re-wrapping', async () => {
    const createInstrumentation = await loadModule()
    process.env.NEXT_RUNTIME = 'nodejs'

    const first = createInstrumentation({
      captureOutput: { ignore: ['stale-filter'] },
      pretty: false,
      silent: true,
    })
    const second = createInstrumentation({
      captureOutput: { ignore: ['active-filter'] },
      pretty: false,
      silent: true,
    })

    await runRegister(first.register)
    await runRegister(second.register)

    process.stderr.write('matched active-filter\n')
    expect(logErrorSpy).not.toHaveBeenCalled()

    process.stderr.write('unfiltered stderr\n')
    expect(logErrorSpy).toHaveBeenCalledTimes(1)
    expect(logErrorSpy).toHaveBeenCalledWith({ source: 'stderr', message: 'unfiltered stderr' })
  })
})

describe('instrumentation entry split', () => {
  it('gate entry exports defineNodeInstrumentation only (Edge-safe)', async () => {
    const gate = await import('../../src/next/instrumentation')
    expect(gate.defineNodeInstrumentation).toBeTypeOf('function')
    expect('createInstrumentation' in gate).toBe(false)
  })

  it('create entry exports createInstrumentation and captureOutput types', async () => {
    const create = await import('../../src/next/instrumentation-create')
    expect(create.createInstrumentation).toBeTypeOf('function')
    expect(create.DEFAULT_CAPTURE_OUTPUT_IGNORE.length).toBeGreaterThan(0)
  })
})

describe('defineNodeInstrumentation', () => {
  let originalNextRuntime: string | undefined

  beforeEach(() => {
    originalNextRuntime = process.env.NEXT_RUNTIME
    vi.resetModules()
  })

  afterEach(() => {
    if (originalNextRuntime === undefined) {
      delete process.env.NEXT_RUNTIME
    } else {
      process.env.NEXT_RUNTIME = originalNextRuntime
    }
  })

  it('options overload returns register and onRequestError hooks', async () => {
    const { defineNodeInstrumentation } = await import('../../src/next/instrumentation')
    const hooks = defineNodeInstrumentation({ service: 'test-app' })
    expect(hooks.register).toBeTypeOf('function')
    expect(hooks.onRequestError).toBeTypeOf('function')
  })

  it('does not call loader when NEXT_RUNTIME is edge', async () => {
    process.env.NEXT_RUNTIME = 'edge'
    const loader = vi.fn().mockResolvedValue({
      register: vi.fn(),
      onRequestError: vi.fn(),
    })
    const { defineNodeInstrumentation } = await import('../../src/next/instrumentation')
    const { register, onRequestError } = defineNodeInstrumentation(loader)
    await register()
    await onRequestError(
      new Error('x'),
      { path: '/', method: 'GET', headers: {} },
      {
        routerKind: 'App Router',
        routePath: '/',
        routeType: 'route',
        renderSource: 'react-server-components',
      },
    )
    expect(loader).not.toHaveBeenCalled()
  })

  it('caches loader: one import for register plus multiple onRequestError', async () => {
    process.env.NEXT_RUNTIME = 'nodejs'
    const registerFn = vi.fn()
    const onRequestErrorFn = vi.fn()
    const loader = vi.fn().mockResolvedValue({
      register: registerFn,
      onRequestError: onRequestErrorFn,
    })
    const { defineNodeInstrumentation } = await import('../../src/next/instrumentation')
    const { register, onRequestError } = defineNodeInstrumentation(loader)
    await register()
    await onRequestError(
      new Error('a'),
      { path: '/a', method: 'GET', headers: {} },
      {
        routerKind: 'App Router',
        routePath: '/a',
        routeType: 'route',
        renderSource: 'react-server-components',
      },
    )
    await onRequestError(
      new Error('b'),
      { path: '/b', method: 'GET', headers: {} },
      {
        routerKind: 'App Router',
        routePath: '/b',
        routeType: 'route',
        renderSource: 'react-server-components',
      },
    )
    expect(loader).toHaveBeenCalledTimes(1)
    expect(registerFn).toHaveBeenCalledTimes(1)
    expect(onRequestErrorFn).toHaveBeenCalledTimes(2)
  })
})
