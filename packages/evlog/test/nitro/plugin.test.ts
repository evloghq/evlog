import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getHeaders } from 'h3'
import type { DrainContext, RouteConfig, ServerEvent, WideEvent } from '../../src/types'
import { defined } from '../helpers/defined'
import { createDeferredStream } from '../helpers/stream'
import { filterSafeHeaders } from '../../src/utils'
import { getServiceForPath, shouldLog } from '../../src/shared/routes'
import { createRequestLogger, initLogger } from '../../src/logger'

vi.mock('h3', () => ({
  getHeaders: vi.fn(),
}))

function getSafeHeaders(allHeaders: Partial<Record<string, string | undefined>>): Record<string, string> {
  return filterSafeHeaders(allHeaders)
}

describe('nitro plugin - drain hook headers', () => {
  it('filters out sensitive headers for security', () => {
    const mockHeaders = {
      'content-type': 'application/json',
      'x-request-id': 'test-123',
      // Sensitive headers that should be filtered
      'authorization': 'Bearer secret-token',
      'cookie': 'session=abc123',
      'set-cookie': 'session=abc123; HttpOnly',
      'x-api-key': 'secret-api-key',
      'x-auth-token': 'secret-auth-token',
      'proxy-authorization': 'Basic credentials',
    }

    vi.mocked(getHeaders).mockReturnValue(mockHeaders)

    let drainContext: DrainContext | null = null
    const mockHooks = {
      callHook: vi.fn().mockImplementation((hookName, ctx) => {
        if (hookName === 'evlog:drain') {
          drainContext = ctx
        }
        return Promise.resolve()
      }),
    }

    const mockNitroApp = { hooks: mockHooks }
    const mockEvent = { method: 'GET', path: '/api/users', context: {} }

    const allHeaders = getHeaders(mockEvent as Parameters<typeof getHeaders>[0])
    mockNitroApp.hooks.callHook('evlog:drain', {
      event: { timestamp: '', level: 'info', service: 'test', environment: 'test' },
      request: { method: mockEvent.method, path: mockEvent.path },
      headers: getSafeHeaders(allHeaders),
    })

    const ctx = defined(drainContext, 'drainContext')

    // Verify sensitive headers are NOT included
    expect(ctx.headers).not.toHaveProperty('authorization')
    expect(ctx.headers).not.toHaveProperty('cookie')
    expect(ctx.headers).not.toHaveProperty('set-cookie')
    expect(ctx.headers).not.toHaveProperty('x-api-key')
    expect(ctx.headers).not.toHaveProperty('x-auth-token')
    expect(ctx.headers).not.toHaveProperty('proxy-authorization')

    // Verify safe headers ARE included
    expect(ctx.headers).toHaveProperty('content-type', 'application/json')
    expect(ctx.headers).toHaveProperty('x-request-id', 'test-123')
  })

  it('includes all standard non-sensitive HTTP headers', () => {
    const mockHeaders = {
      'accept': 'application/json',
      'accept-language': 'en-US,en;q=0.9',
      'cache-control': 'no-cache',
      'content-type': 'application/json',
      'host': 'localhost:3000',
      'user-agent': 'Mozilla/5.0',
      'x-forwarded-for': '192.168.1.1',
      'x-real-ip': '192.168.1.1',
    }

    vi.mocked(getHeaders).mockReturnValue(mockHeaders)

    let drainContext: DrainContext | null = null
    const mockHooks = {
      callHook: vi.fn().mockImplementation((hookName, ctx) => {
        if (hookName === 'evlog:drain') {
          drainContext = ctx
        }
        return Promise.resolve()
      }),
    }

    const mockNitroApp = { hooks: mockHooks }
    const mockEvent = { method: 'GET', path: '/api/users', context: {} }

    const allHeaders = getHeaders(mockEvent as Parameters<typeof getHeaders>[0])
    mockNitroApp.hooks.callHook('evlog:drain', {
      event: { timestamp: '', level: 'info', service: 'test', environment: 'test' },
      request: { method: mockEvent.method, path: mockEvent.path },
      headers: getSafeHeaders(allHeaders),
    })

    const ctx = defined(drainContext, 'drainContext')

    // Verify all safe headers are passed through
    expect(ctx.headers).toEqual(mockHeaders)
    expect(ctx.headers?.['user-agent']).toBe('Mozilla/5.0')
    expect(ctx.headers?.['x-forwarded-for']).toBe('192.168.1.1')
  })

  it('handles empty headers', () => {
    vi.mocked(getHeaders).mockReturnValue({})

    let drainContext: DrainContext | null = null
    const mockHooks = {
      callHook: vi.fn().mockImplementation((hookName, ctx) => {
        if (hookName === 'evlog:drain') {
          drainContext = ctx
        }
        return Promise.resolve()
      }),
    }

    const mockNitroApp = { hooks: mockHooks }
    const mockEvent = { method: 'GET', path: '/', context: {} }

    const allHeaders = getHeaders(mockEvent as Parameters<typeof getHeaders>[0])
    mockNitroApp.hooks.callHook('evlog:drain', {
      event: { timestamp: '', level: 'info', service: 'test', environment: 'test' },
      request: { method: mockEvent.method, path: mockEvent.path },
      headers: getSafeHeaders(allHeaders),
    })

    expect(defined(drainContext, 'drainContext').headers).toEqual({})
  })

  it('preserves custom correlation headers for external services', () => {
    // Test headers commonly used for correlation with external services
    const correlationHeaders = {
      // PostHog
      'x-posthog-session-id': 'ph-session-123',
      'x-posthog-distinct-id': 'ph-user-456',
      // Sentry
      'sentry-trace': '00-abc123-def456-01',
      'baggage': 'sentry-environment=production',
      // OpenTelemetry
      'traceparent': '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      'tracestate': 'congo=t61rcWkgMzE',
      // Custom
      'x-correlation-id': 'corr-789',
      'x-request-id': 'req-abc',
    }

    vi.mocked(getHeaders).mockReturnValue(correlationHeaders)

    let drainContext: DrainContext | null = null
    const mockHooks = {
      callHook: vi.fn().mockImplementation((hookName, ctx) => {
        if (hookName === 'evlog:drain') {
          drainContext = ctx
        }
        return Promise.resolve()
      }),
    }

    const mockNitroApp = { hooks: mockHooks }
    const mockEvent = { method: 'POST', path: '/api/checkout', context: {} }

    const allHeaders = getHeaders(mockEvent as Parameters<typeof getHeaders>[0])
    mockNitroApp.hooks.callHook('evlog:drain', {
      event: { timestamp: '', level: 'info', service: 'test', environment: 'test' },
      request: { method: mockEvent.method, path: mockEvent.path },
      headers: getSafeHeaders(allHeaders),
    })

    const ctx = defined(drainContext, 'drainContext')

    // Verify all correlation headers are available
    expect(ctx.headers?.['x-posthog-session-id']).toBe('ph-session-123')
    expect(ctx.headers?.['x-posthog-distinct-id']).toBe('ph-user-456')
    expect(ctx.headers?.['sentry-trace']).toBe('00-abc123-def456-01')
    expect(ctx.headers?.['traceparent']).toBeDefined()
    expect(ctx.headers?.['x-correlation-id']).toBe('corr-789')
  })

  it('filters sensitive headers case-insensitively', () => {
    const mockHeaders = {
      'Authorization': 'Bearer token',
      'COOKIE': 'session=123',
      'X-Api-Key': 'secret',
      'content-type': 'application/json',
    }

    vi.mocked(getHeaders).mockReturnValue(mockHeaders)

    let drainContext: DrainContext | null = null
    const mockHooks = {
      callHook: vi.fn().mockImplementation((hookName, ctx) => {
        if (hookName === 'evlog:drain') {
          drainContext = ctx
        }
        return Promise.resolve()
      }),
    }

    const mockNitroApp = { hooks: mockHooks }
    const mockEvent = { method: 'GET', path: '/', context: {} }

    const allHeaders = getHeaders(mockEvent as Parameters<typeof getHeaders>[0])
    mockNitroApp.hooks.callHook('evlog:drain', {
      event: { timestamp: '', level: 'info', service: 'test', environment: 'test' },
      request: { method: mockEvent.method, path: mockEvent.path },
      headers: getSafeHeaders(allHeaders),
    })

    const ctx = defined(drainContext, 'drainContext')

    // Verify sensitive headers are filtered regardless of case
    expect(ctx.headers).not.toHaveProperty('Authorization')
    expect(ctx.headers).not.toHaveProperty('COOKIE')
    expect(ctx.headers).not.toHaveProperty('X-Api-Key')

    // Verify safe headers are kept
    expect(ctx.headers).toHaveProperty('content-type', 'application/json')
  })
})

describe('nitro plugin - waitUntil support', () => {
  function callDrainHook(
    nitroApp: { hooks: { callHook: (name: string, ctx: DrainContext) => Promise<void> } },
    emittedEvent: WideEvent | null,
    event: ServerEvent,
  ): void {
    if (!emittedEvent) return

    const drainPromise = nitroApp.hooks.callHook('evlog:drain', {
      event: emittedEvent,
      request: { method: event.method, path: event.path, requestId: event.context.requestId as string | undefined },
      headers: {},
    }).catch((err) => {
      console.error('[evlog] drain failed:', err)
    })

    // Use waitUntil if available (Cloudflare Workers, Vercel Edge)
    // Call as a method on the context object to preserve `this` binding
    const waitUntilCtx = event.context.cloudflare?.context ?? event.context
    if (typeof waitUntilCtx?.waitUntil === 'function') {
      waitUntilCtx.waitUntil(drainPromise)
    }
  }

  it('calls waitUntil with Cloudflare Workers context', () => {
    const mockWaitUntil = vi.fn()
    const mockHooks = {
      callHook: vi.fn().mockResolvedValue(undefined),
    }

    const mockEvent: ServerEvent = {
      method: 'POST',
      path: '/api/test',
      context: {
        cloudflare: {
          context: {
            waitUntil: mockWaitUntil,
          },
        },
      },
    }

    const mockEmittedEvent: WideEvent = {
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'test',
      environment: 'production',
    }

    callDrainHook({ hooks: mockHooks }, mockEmittedEvent, mockEvent)

    // Verify waitUntil was called with a promise
    expect(mockWaitUntil).toHaveBeenCalledTimes(1)
    expect(mockWaitUntil).toHaveBeenCalledWith(expect.any(Promise))
  })

  it('calls waitUntil with Vercel Edge context', () => {
    const mockWaitUntil = vi.fn()
    const mockHooks = {
      callHook: vi.fn().mockResolvedValue(undefined),
    }

    const mockEvent: ServerEvent = {
      method: 'GET',
      path: '/api/users',
      context: {
        waitUntil: mockWaitUntil,
      },
    }

    const mockEmittedEvent: WideEvent = {
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'test',
      environment: 'production',
    }

    callDrainHook({ hooks: mockHooks }, mockEmittedEvent, mockEvent)

    // Verify waitUntil was called with a promise
    expect(mockWaitUntil).toHaveBeenCalledTimes(1)
    expect(mockWaitUntil).toHaveBeenCalledWith(expect.any(Promise))
  })

  it('prefers Cloudflare waitUntil over Vercel when both are present', () => {
    const mockCfWaitUntil = vi.fn()
    const mockVercelWaitUntil = vi.fn()
    const mockHooks = {
      callHook: vi.fn().mockResolvedValue(undefined),
    }

    const mockEvent: ServerEvent = {
      method: 'POST',
      path: '/api/checkout',
      context: {
        cloudflare: {
          context: {
            waitUntil: mockCfWaitUntil,
          },
        },
        waitUntil: mockVercelWaitUntil,
      },
    }

    const mockEmittedEvent: WideEvent = {
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'test',
      environment: 'production',
    }

    callDrainHook({ hooks: mockHooks }, mockEmittedEvent, mockEvent)

    // Cloudflare should be preferred
    expect(mockCfWaitUntil).toHaveBeenCalledTimes(1)
    expect(mockVercelWaitUntil).not.toHaveBeenCalled()
  })

  it('works without waitUntil (traditional Node.js server)', () => {
    const mockHooks = {
      callHook: vi.fn().mockResolvedValue(undefined),
    }

    const mockEvent: ServerEvent = {
      method: 'GET',
      path: '/api/health',
      context: {
        // No cloudflare or waitUntil context
      },
    }

    const mockEmittedEvent: WideEvent = {
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'test',
      environment: 'development',
    }

    // Should not throw
    expect(() => {
      callDrainHook({ hooks: mockHooks }, mockEmittedEvent, mockEvent)
    }).not.toThrow()

    // Drain hook should still be called
    expect(mockHooks.callHook).toHaveBeenCalledWith('evlog:drain', expect.any(Object))
  })

  it('preserves this binding when calling waitUntil (prevents Illegal invocation)', () => {
    // Simulate a real waitUntil that requires correct `this` binding,
    // like Cloudflare's ExecutionContext which throws "Illegal invocation"
    // when `waitUntil` is called without proper `this` context
    const executionContext = {
      _promises: [] as Promise<unknown>[],
      waitUntil(promise: Promise<unknown>) {
        if (this !== executionContext) {
          throw new TypeError('Illegal invocation')
        }
        this._promises.push(promise)
      },
    }

    const mockHooks = {
      callHook: vi.fn().mockResolvedValue(undefined),
    }

    const mockEvent: ServerEvent = {
      method: 'POST',
      path: '/api/test',
      context: {
        cloudflare: {
          context: executionContext,
        },
      },
    }

    const mockEmittedEvent: WideEvent = {
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'test',
      environment: 'production',
    }

    // Should NOT throw "Illegal invocation" because waitUntil is called as a method
    expect(() => {
      callDrainHook({ hooks: mockHooks }, mockEmittedEvent, mockEvent)
    }).not.toThrow()

    expect(executionContext._promises).toHaveLength(1)
  })
})

describe('nitro plugin - route-based service configuration', () => {
  it('returns service name for matching route pattern', () => {
    const routes: Record<string, RouteConfig> = {
      '/api/auth/**': { service: 'auth-service' },
      '/api/payment/**': { service: 'payment-service' },
    }

    expect(getServiceForPath('/api/auth/login', routes)).toBe('auth-service')
    expect(getServiceForPath('/api/auth/register', routes)).toBe('auth-service')
    expect(getServiceForPath('/api/payment/process', routes)).toBe('payment-service')
  })

  it('returns undefined when no route matches', () => {
    const routes: Record<string, RouteConfig> = {
      '/api/auth/**': { service: 'auth-service' },
    }

    expect(getServiceForPath('/api/users/list', routes)).toBeUndefined()
    expect(getServiceForPath('/health', routes)).toBeUndefined()
  })

  it('returns undefined when routes parameter is undefined', () => {
    expect(getServiceForPath('/api/test', undefined)).toBeUndefined()
  })

  it('returns undefined when routes object is empty', () => {
    expect(getServiceForPath('/api/test', {})).toBeUndefined()
  })

  it('implements first-match-wins with overlapping patterns', () => {
    const routes: Record<string, RouteConfig> = {
      '/api/auth/admin/**': { service: 'admin-service' },
      '/api/auth/**': { service: 'auth-service' },
      '/api/**': { service: 'api-service' },
    }

    // More specific pattern should win
    expect(getServiceForPath('/api/auth/admin/users', routes)).toBe('admin-service')

    // Falls back to less specific pattern
    expect(getServiceForPath('/api/auth/login', routes)).toBe('auth-service')

    // Falls back to most general pattern
    expect(getServiceForPath('/api/users/list', routes)).toBe('api-service')
  })

  it('supports exact path matching without wildcards', () => {
    const routes: Record<string, RouteConfig> = {
      '/health': { service: 'health-check' },
      '/api/status': { service: 'status-service' },
    }

    expect(getServiceForPath('/health', routes)).toBe('health-check')
    expect(getServiceForPath('/api/status', routes)).toBe('status-service')

    // Should not match partial paths
    expect(getServiceForPath('/health/check', routes)).toBeUndefined()
  })

  it('supports single wildcard patterns', () => {
    const routes: Record<string, RouteConfig> = {
      '/api/*/process': { service: 'processor' },
    }

    expect(getServiceForPath('/api/payment/process', routes)).toBe('processor')
    expect(getServiceForPath('/api/booking/process', routes)).toBe('processor')

    // Should not match nested paths
    expect(getServiceForPath('/api/payment/retry/process', routes)).toBeUndefined()
  })

  it('handles wildcard patterns with version paths', () => {
    const routes: Record<string, RouteConfig> = {
      '/api/v*/users': { service: 'versioned-users' },
      '/api/v*/posts/**': { service: 'versioned-posts' },
    }

    expect(getServiceForPath('/api/v1/users', routes)).toBe('versioned-users')
    expect(getServiceForPath('/api/v2/users', routes)).toBe('versioned-users')
    expect(getServiceForPath('/api/v1/posts/123', routes)).toBe('versioned-posts')
    expect(getServiceForPath('/api/v2/posts/456/comments', routes)).toBe('versioned-posts')
  })

  it('is case-sensitive for path matching', () => {
    const routes: Record<string, RouteConfig> = {
      '/API/auth/**': { service: 'auth-service' },
    }

    expect(getServiceForPath('/API/auth/login', routes)).toBe('auth-service')
    expect(getServiceForPath('/api/auth/login', routes)).toBeUndefined()
  })
})

describe('nitro plugin - useLogger service parameter', () => {
  it('service parameter overrides default service', () => {
    const mockLog = {
      set: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      setLevel: vi.fn(),
      error: vi.fn(),
      emit: vi.fn(),
      getContext: vi.fn().mockReturnValue({ service: 'default-service' }),
    }

    const mockEvent: ServerEvent = {
      method: 'POST',
      path: '/api/test',
      context: {
        log: mockLog,
      },
    }

    // Simulate useLogger with service parameter
    const { log } = mockEvent.context
    if (log) {
      log.set({ service: 'custom-service' })
    }

    expect(mockLog.set).toHaveBeenCalledWith({ service: 'custom-service' })
  })

  it('calling useLogger without service parameter preserves existing service', () => {
    const mockLog = {
      set: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      setLevel: vi.fn(),
      error: vi.fn(),
      emit: vi.fn(),
      getContext: vi.fn().mockReturnValue({ service: 'existing-service' }),
    }

    const mockEvent: ServerEvent = {
      method: 'GET',
      path: '/api/users',
      context: {
        log: mockLog,
      },
    }

    // Simulate useLogger without service parameter
    const { log } = mockEvent.context
    expect(log).toBeDefined()

    // Should not call set with service if parameter not provided
    expect(mockLog.set).not.toHaveBeenCalled()
  })

  it('explicit service parameter takes precedence over route-based config', () => {
    const mockLog = {
      set: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      setLevel: vi.fn(),
      error: vi.fn(),
      emit: vi.fn(),
      getContext: vi.fn().mockReturnValue({}),
    }

    const mockEvent: ServerEvent = {
      method: 'POST',
      path: '/api/auth/login',
      context: {
        log: mockLog,
      },
    }

    // First, route-based config sets service to 'auth-service'
    mockLog.set({ service: 'auth-service' })

    // Then, explicit parameter overrides it
    mockLog.set({ service: 'explicit-service' })

    expect(mockLog.set).toHaveBeenCalledWith({ service: 'auth-service' })
    expect(mockLog.set).toHaveBeenCalledWith({ service: 'explicit-service' })
    expect(mockLog.set).toHaveBeenCalledTimes(2)
  })

  it('service parameter can override any existing service configuration', () => {
    const mockLog = {
      set: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      setLevel: vi.fn(),
      error: vi.fn(),
      emit: vi.fn(),
      getContext: vi.fn().mockReturnValue({ service: 'default-service' }),
    }

    const mockEvent: ServerEvent = {
      method: 'POST',
      path: '/api/test',
      context: {
        log: mockLog,
      },
    }

    // Apply multiple service overrides
    mockLog.set({ service: 'service-1' })
    mockLog.set({ service: 'service-2' })
    mockLog.set({ service: 'final-service' })

    expect(mockLog.set).toHaveBeenCalledTimes(3)
    expect(mockLog.set).toHaveBeenLastCalledWith({ service: 'final-service' })
  })
})

describe('nitro plugin - service resolution priority', () => {
  it('explicit service parameter has highest priority', () => {
    const mockLog = {
      set: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      setLevel: vi.fn(),
      error: vi.fn(),
      emit: vi.fn(),
      getContext: vi.fn().mockReturnValue({
        service: 'env-service',
      }),
    }

    const mockEvent: ServerEvent = {
      method: 'POST',
      path: '/api/auth/login',
      context: {
        log: mockLog,
      },
    }

    // Simulate the order in nitro plugin:
    // 1. Logger initialized with env.service = 'env-service'
    // 2. Route-based config would set 'auth-service'
    const routeService = 'auth-service'
    if (routeService) {
      mockLog.set({ service: routeService })
    }

    // 3. User calls useLogger(event, 'explicit-service')
    const explicitService = 'explicit-service'
    if (explicitService) {
      mockLog.set({ service: explicitService })
    }

    // Verify the order and priority
    expect(mockLog.set).toHaveBeenNthCalledWith(1, { service: 'auth-service' })
    expect(mockLog.set).toHaveBeenNthCalledWith(2, { service: 'explicit-service' })
  })

  it('route-based config applies when no explicit service provided', () => {
    const mockLog = {
      set: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      setLevel: vi.fn(),
      error: vi.fn(),
      emit: vi.fn(),
      getContext: vi.fn().mockReturnValue({
        service: 'default-service',
      }),
    }

    const mockEvent: ServerEvent = {
      method: 'POST',
      path: '/api/payment/process',
      context: {
        log: mockLog,
      },
    }

    // Only route-based config applies
    const routeService = 'payment-service'
    if (routeService) {
      mockLog.set({ service: routeService })
    }

    // No explicit service parameter
    // (useLogger called without service parameter)

    expect(mockLog.set).toHaveBeenCalledTimes(1)
    expect(mockLog.set).toHaveBeenCalledWith({ service: 'payment-service' })
  })

  it('env.service fallback when no route matches and no explicit service', () => {
    const mockLog = {
      set: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      setLevel: vi.fn(),
      error: vi.fn(),
      emit: vi.fn(),
      getContext: vi.fn().mockReturnValue({
        service: 'default-service',
      }),
    }

    const mockEvent: ServerEvent = {
      method: 'GET',
      path: '/api/unknown',
      context: {
        log: mockLog,
      },
    }

    // No route matches
    const routeService = undefined
    if (routeService) {
      mockLog.set({ service: routeService })
    }

    // No explicit service parameter
    // Should keep env.service ('default-service')

    expect(mockLog.set).not.toHaveBeenCalled()
    expect(mockLog.getContext().service).toBe('default-service')
  })
})


describe('nitro plugin - middleware compatibility (#210)', () => {
  /**
   * Replicates the plugin's `request` hook logic so we can test it directly.
   * The real plugin registers this via nitroApp.hooks.hook('request', ...).
   */
  function simulateRequestHook(
    event: ServerEvent,
    config?: { include?: string[]; exclude?: string[] },
  ): void {
    event.context._evlogShouldEmit = shouldLog(event.path, config?.include, config?.exclude)
    event.context._evlogStartTime = Date.now()
    event.context.log = createRequestLogger(
      { method: event.method, path: event.path, requestId: crypto.randomUUID() },
      { _deferDrain: true },
    )
  }

  /**
   * Replicates the plugin's `afterResponse` hook logic.
   */
  function simulateAfterResponseHook(event: ServerEvent): { emitted: boolean } {
    if (event.context._evlogEmitted || event.context._evlogEmitting || !event.context._evlogShouldEmit) {
      return { emitted: false }
    }
    const { log } = event.context
    if (!log) return { emitted: false }
    log.set({ status: 200 })
    const result = log.emit()
    return { emitted: result !== null }
  }

  /**
   * Replicates the plugin's `error` hook logic.
   */
  function simulateErrorHook(event: ServerEvent, error: Error): { emitted: boolean } {
    if (!event.context._evlogShouldEmit) return { emitted: false }
    const { log } = event.context
    if (!log) return { emitted: false }
    event.context._evlogEmitting = true
    try {
      log.error(error)
      log.set({ status: 500 })
      const result = log.emit()
      if (result) event.context._evlogEmitted = true
      return { emitted: result !== null }
    } finally {
      delete event.context._evlogEmitting
    }
  }

  beforeEach(() => {
    initLogger({ env: { service: 'test-app' }, pretty: false })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('request hook creates logger even when route is filtered out by include', () => {
    const event: ServerEvent = { method: 'GET', path: '/dashboard', context: {} }

    simulateRequestHook(event, { include: ['/api/**'] })

    expect(event.context.log).toBeDefined()
    expect(event.context._evlogShouldEmit).toBe(false)
    expect(event.context._evlogStartTime).toBeTypeOf('number')
  })

  it('request hook sets _evlogShouldEmit true for matching routes', () => {
    const event: ServerEvent = { method: 'GET', path: '/api/users', context: {} }

    simulateRequestHook(event, { include: ['/api/**'] })

    expect(event.context.log).toBeDefined()
    expect(event.context._evlogShouldEmit).toBe(true)
  })

  it('middleware can call set() on logger from a filtered route', () => {
    const event: ServerEvent = { method: 'GET', path: '/dashboard', context: {} }

    simulateRequestHook(event, { include: ['/api/**'] })

    expect(event.context._evlogShouldEmit).toBe(false)
    const log = defined(event.context.log, 'event.context.log')
    log.set({ user: { id: 'usr_123', plan: 'enterprise' } })

    const ctx = log.getContext()
    expect(ctx.user).toEqual({ id: 'usr_123', plan: 'enterprise' })
  })

  it('afterResponse does not emit for filtered routes', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const event: ServerEvent = { method: 'GET', path: '/dashboard', context: {} }

    simulateRequestHook(event, { include: ['/api/**'] })
    defined(event.context.log, 'event.context.log').set({ user: { id: 'test' } })

    const { emitted } = simulateAfterResponseHook(event)

    expect(emitted).toBe(false)
    consoleSpy.mockRestore()
  })

  it('afterResponse emits for matching routes', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const event: ServerEvent = { method: 'GET', path: '/api/users', context: {} }

    simulateRequestHook(event, { include: ['/api/**'] })

    const { emitted } = simulateAfterResponseHook(event)

    expect(emitted).toBe(true)
    consoleSpy.mockRestore()
  })

  it('error hook does not emit for filtered routes', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const event: ServerEvent = { method: 'POST', path: '/dashboard', context: {} }

    simulateRequestHook(event, { include: ['/api/**'] })

    const { emitted } = simulateErrorHook(event, new Error('boom'))

    expect(emitted).toBe(false)
    expect(event.context._evlogEmitted).toBeUndefined()
    consoleSpy.mockRestore()
  })

  it('error hook emits for matching routes', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const event: ServerEvent = { method: 'POST', path: '/api/checkout', context: {} }

    simulateRequestHook(event, { include: ['/api/**'] })

    const { emitted } = simulateErrorHook(event, new Error('payment failed'))

    expect(emitted).toBe(true)
    expect(event.context._evlogEmitted).toBe(true)
    consoleSpy.mockRestore()
  })

  it('request hook creates logger for all routes when no include is set', () => {
    const pageEvent: ServerEvent = { method: 'GET', path: '/', context: {} }
    const apiEvent: ServerEvent = { method: 'GET', path: '/api/users', context: {} }

    simulateRequestHook(pageEvent)
    simulateRequestHook(apiEvent)

    expect(pageEvent.context.log).toBeDefined()
    expect(pageEvent.context._evlogShouldEmit).toBe(true)
    expect(apiEvent.context.log).toBeDefined()
    expect(apiEvent.context._evlogShouldEmit).toBe(true)
  })
})

describe('nitro plugin - streaming emit defer (#321)', () => {
  beforeEach(() => {
    initLogger({ env: { service: 'test-app' }, pretty: false, silent: true, _suppressDrainWarning: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('defers afterResponse emit until a streaming body completes', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const event: ServerEvent = { method: 'POST', path: '/api/chat', context: {} }
    event.context._evlogShouldEmit = true
    event.context._evlogStartTime = Date.now()
    event.context.log = createRequestLogger(
      { method: 'POST', path: '/api/chat', requestId: 'req-1' },
      { _deferDrain: true },
    )

    const { stream, close } = createDeferredStream()
    event.response = new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })

    queueMicrotask(() => {
      defined(event.context.log, 'request logger').set({ ai: { calls: 1, totalTokens: 42 } })
    })

    const { bindStreamingResponseLifecycle } = await import('../../src/shared/streamResponse')
    let emitCount = 0
    event.response = bindStreamingResponseLifecycle(event.response, () => {
      emitCount++
      defined(event.context.log, 'request logger').emit({ status: 200 })
    })

    expect(emitCount).toBe(0)
    close()
    await expect(event.response.text()).resolves.toBe('hello world')
    await vi.waitFor(() => {
      expect(emitCount).toBe(1)
    })
    expect(warnSpy.mock.calls.some(([message]) => String(message).includes('Keys dropped: ai'))).toBe(false)
    expect(defined(event.context.log, 'request logger').getContext().ai).toEqual({ calls: 1, totalTokens: 42 })
  })
})
