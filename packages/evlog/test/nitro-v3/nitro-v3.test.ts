import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import {
  build,
  createDevServer,
  createNitro,
  prepare,
} from 'nitro/builder'
import { resolve } from 'pathe'
import { consola } from 'consola'
import { parseError } from '../../src/runtime/utils/parseError'

const rootDir = resolve(__dirname, './fixture')

describe.sequential('Nitro v3 Server with evlog', () => {
  let nitro: Awaited<ReturnType<typeof createNitro>>
  let devServer: ReturnType<typeof createDevServer>
  let server: Awaited<ReturnType<ReturnType<typeof createDevServer>['listen']>>
  let prevEvlogTestLog: string | undefined

  beforeAll(async () => {
    prevEvlogTestLog = process.env.EVLOG_TEST_LOG
    process.env.EVLOG_TEST_LOG = '1'
    nitro = await createNitro({
      dev: true,
      rootDir,
    })
    devServer = createDevServer(nitro)
    server = devServer.listen({})
    await prepare(nitro)
    const reloaded = new Promise<void>((resolve) => {
      nitro.hooks.hook('dev:reload', () => resolve())
    })
    await build(nitro)
    await reloaded
    // srvx binds asynchronously: `server.url` stays undefined until the listener is up.
    await server.ready()
  })

  afterAll(async () => {
    if (prevEvlogTestLog === undefined) delete process.env.EVLOG_TEST_LOG
    else process.env.EVLOG_TEST_LOG = prevEvlogTestLog
    await devServer?.close()
    await nitro?.close()
  })

  it('should be able to get the correct result', async () => {
    const res = await server.fetch(new Request(new URL('/works', server.url)))
    const json = await res.json()

    expect(json).toEqual({ success: true })
  })

  it.sequential('should have displayed the correct log message', async () => {
    const logs: any[] = []
    const mockFn = vi.fn((context) => {
      logs.push(String(context))
    })
    
    consola.mockTypes((typeName, type) => mockFn)
    consola.wrapAll()

    try {
      await server.fetch(new Request(new URL('/works', server.url)))

      // Wait for async logs to be written
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(mockFn).toHaveBeenCalled()
      const logOutput = logs.join('\n')
      
      expect(logOutput).toMatch(/INFO.*GET \/works.*200/)
      expect(logOutput).toContain('payment:')
      expect(logOutput).toContain('method=card')
      expect(logOutput).toContain('status=success')
      expect(logOutput).toContain('cart:')
      expect(logOutput).toContain('id=42')
      expect(logOutput).toContain('items=3')
      expect(logOutput).toContain('total=9999')
      expect(logOutput).toContain('user:')
      expect(logOutput).toContain('id=1')
      expect(logOutput).toContain('plan=pro')
      expect(logOutput).toContain('requestId:')
    } finally {
      consola.restoreAll()
    }
  })

  it.sequential('should pass streaming responses through and emit at header time', async () => {
    const logs: any[] = []
    const mockFn = vi.fn((context) => {
      logs.push(String(context))
    })

    consola.mockTypes((typeName, type) => mockFn)
    consola.wrapAll()

    try {
      const res = await server.fetch(new Request(new URL('/stream', server.url)))

      expect(res.status).toBe(200)

      // The plugin must not lock, wrap, or replace the streaming body
      const text = await res.text()
      expect(text).toContain('data: one')
      expect(text).toContain('data: two')

      // Wait for the async log write deterministically instead of sleeping
      await vi.waitFor(
        () => expect(logs.join('\n')).toMatch(/INFO.*GET \/stream.*200/),
        { timeout: 1000, interval: 5 },
      )

      const logOutput = logs.join('\n')
      expect(logOutput).toContain('stream:')
      expect(logOutput).toContain('kind=sse')
    } finally {
      consola.restoreAll()
    }
  })

  it.sequential('should handle structured errors correctly', async () => {
    const logs: any[] = []
    const mockFn = vi.fn((context) => {
      logs.push(String(context))
    })
    
    consola.mockTypes((typeName, type) => mockFn)
    consola.wrapAll()

    try {
      const res = await server.fetch(new Request(new URL('/throws', server.url)))
      
      expect(res.status).toBe(402)
      
      const json = await res.json()
      const error = parseError(json)
      
      // Verify all error fields are accessible at top level
      expect(error.message).toBe('Payment failed')
      expect(error.status).toBe(402)
      expect(error.why).toBe('Card declined by issuer (insufficient funds)')
      expect(error.fix).toBe('Try a different payment method or contact your bank')
      expect(error.link).toBe('https://docs.example.com/payments/declined')

      // Wait for async logs to be written
      await new Promise(resolve => setTimeout(resolve, 100))

      // Verify error logs include wide context
      expect(mockFn).toHaveBeenCalled()
      const logOutput = logs.join('\n')

      expect(logOutput).toMatch(/ERROR.*GET \/throws.*402/)
      expect(logOutput).toContain('user:')
      expect(logOutput).toContain('id=42')
      expect(logOutput).toContain('plan=enterprise')
      expect(logOutput).toContain('transaction:')
      expect(logOutput).toContain('id=txn_123')
      expect(logOutput).toContain('amount=5000')
      expect(logOutput).toContain('attempt:')
      expect(logOutput).toContain('count=3')
      expect(logOutput).toContain('method=credit_card')
      expect(logOutput).toContain('error:')
      expect(logOutput).toContain('Payment failed')
    } finally {
      consola.restoreAll()
    }
  })

  it.sequential('should call evlog:drain hook with safe headers', async () => {
    const logs: any[] = []
    const mockFn = vi.fn((context) => {
      logs.push(String(context))
    })
    
    consola.mockTypes((typeName, type) => mockFn)
    consola.wrapAll()

    try {
      await server.fetch(new Request(new URL('/works', server.url), {
        headers: {
          'Authorization': 'Bearer secret-token',
          'Cookie': 'session=abc123',
          'User-Agent': 'Test Browser',
          'X-Custom-Header': 'custom-value',
        },
      }))

      // Wait for async logs and hooks to be called
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(mockFn).toHaveBeenCalled()
      const logOutput = logs.join('\n')
      
      // Find the drain hook log
      const drainLogMatch = logOutput.match(/\[TEST:DRAIN\] (.+)/)
      expect(drainLogMatch).toBeTruthy()
      
      const drainData = JSON.parse(drainLogMatch![1])
      
      // Verify sensitive headers are filtered out
      expect(drainData.hasAuthHeader).toBe(false)
      expect(drainData.hasCookieHeader).toBe(false)
      
      // Verify safe headers are included
      expect(drainData.hasUserAgent).toBe(true)
      expect(drainData.headerKeys).toContain('user-agent')
      expect(drainData.headerKeys).toContain('x-custom-header')
      
      // Verify sensitive headers are not in the keys
      expect(drainData.headerKeys).not.toContain('authorization')
      expect(drainData.headerKeys).not.toContain('cookie')
      
      // Verify request metadata
      expect(drainData.requestPath).toBe('/works')
      expect(drainData.requestMethod).toBe('GET')
      expect(drainData.eventLevel).toBe('info')
    } finally {
      consola.restoreAll()
    }
  })

  it.sequential('should call evlog:enrich hook with correct context', async () => {
    const logs: any[] = []
    const mockFn = vi.fn((context) => {
      logs.push(String(context))
    })
    
    consola.mockTypes((typeName, type) => mockFn)
    consola.wrapAll()

    try {
      await server.fetch(new Request(new URL('/works', server.url)))

      // Wait for async logs and hooks to be called
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(mockFn).toHaveBeenCalled()
      const logOutput = logs.join('\n')
      
      // Find the enrich hook log
      const enrichLogMatch = logOutput.match(/\[TEST:ENRICH\] (.+)/)
      expect(enrichLogMatch).toBeTruthy()
      
      const enrichData = JSON.parse(enrichLogMatch![1])
      
      // Verify enrich hook received the event before enrichment
      expect(enrichData.hasCustomField).toBe(false)
      expect(enrichData.requestPath).toBe('/works')
      expect(enrichData.eventLevel).toBe('info')
      
      // Verify headers were passed to enrich hook
      expect(enrichData.headerKeys).toBeTruthy()
      expect(enrichData.headerKeys.length).toBeGreaterThan(0)
      
      // Verify drain hook received the enriched event
      const drainLogMatch = logOutput.match(/\[TEST:DRAIN\] (.+)/)
      expect(drainLogMatch).toBeTruthy()
      
      const drainData = JSON.parse(drainLogMatch![1])
      
      // Enrichment should be present in drain hook (runs after enrich)
      expect(drainData.hasEnrichment).toBe(true)
      expect(drainData.enrichmentValue).toBe('enriched')
    } finally {
      consola.restoreAll()
    }
  })

  it.sequential('should call evlog:emit:keep hook for tail sampling', async () => {
    const logs: any[] = []
    const mockFn = vi.fn((context) => {
      logs.push(String(context))
    })
    
    consola.mockTypes((typeName, type) => mockFn)
    consola.wrapAll()

    try {
      await server.fetch(new Request(new URL('/works', server.url)))

      // Wait for async logs and hooks to be called
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(mockFn).toHaveBeenCalled()
      const logOutput = logs.join('\n')
      
      // Find the sampling hook log
      const samplingLogMatch = logOutput.match(/\[TEST:SAMPLING\] (.+)/)
      expect(samplingLogMatch).toBeTruthy()
      
      const samplingData = JSON.parse(samplingLogMatch![1])
      
      // Verify context is available
      expect(samplingData.contextKeys).toContain('payment')
      expect(samplingData.contextKeys).toContain('cart')
      expect(samplingData.contextKeys).toContain('user')
      expect(samplingData.hasUserInContext).toBe(true)
      
      // Verify request metadata
      expect(samplingData.requestPath).toBe('/works')
      expect(samplingData.requestMethod).toBe('GET')
      expect(samplingData.status).toBe(200)
      expect(samplingData.duration).toBeGreaterThanOrEqual(0)
      
      // Verify sampling decision
      expect(samplingData.initialShouldKeep).toBe(false)
    } finally {
      consola.restoreAll()
    }
  })

  it('preserves data and message from a deliberate HTTPError', async () => {
    const res = await server.fetch(new Request(new URL('/throws-h3-data', server.url)))

    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({
      statusCode: 500,
      url: '/throws-h3-data',
      error: true,
      message: 'Payment provider rejected the charge',
      data: { orderId: 'ord_1', retryable: true },
    })
  })
})
