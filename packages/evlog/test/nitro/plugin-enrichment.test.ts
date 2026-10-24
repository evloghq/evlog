import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NitroApp } from 'nitropack/types'
import { getHeaders } from 'h3'
import type { DrainContext, EnrichContext, ServerEvent, WideEvent } from '../../src/types'
import { defined } from '../helpers/defined'
import { callEnrichAndDrain } from '../../src/nitro/enrich-drain'
import { initLogger } from '../../src/logger'

vi.mock('h3', () => ({
  getHeaders: vi.fn(),
}))

function asNitroApp(hooks: { callHook: NitroApp['hooks']['callHook'] }): NitroApp {
  return { hooks } as NitroApp
}

describe('nitro plugin - enrichment pipeline (T7)', () => {
  beforeEach(() => {
    initLogger({ pretty: false })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls enrich then drain in sequence', async () => {
    const callOrder: string[] = []
    const mockHeaders = { 'content-type': 'application/json' }
    vi.mocked(getHeaders).mockReturnValue(mockHeaders)

    const mockHooks = {
      callHook: vi.fn().mockImplementation((hookName: string) => {
        callOrder.push(hookName)
        return Promise.resolve()
      }),
    }

    const mockEvent: ServerEvent = {
      method: 'POST',
      path: '/api/test',
      context: { requestId: 'req-123' },
    }

    const emittedEvent: WideEvent = {
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'test',
      environment: 'test',
    }

    await callEnrichAndDrain(asNitroApp(mockHooks), emittedEvent, mockEvent)

    expect(callOrder).toEqual(['evlog:enrich', 'evlog:drain'])
  })

  it('skips pipeline when emittedEvent is null', async () => {
    const mockHooks = {
      callHook: vi.fn().mockResolvedValue(undefined),
    }

    const mockEvent: ServerEvent = {
      method: 'GET',
      path: '/api/test',
      context: {},
    }

    await callEnrichAndDrain(asNitroApp(mockHooks), null, mockEvent)

    expect(mockHooks.callHook).not.toHaveBeenCalled()
  })

  it('enrich errors do not prevent drain from running', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mockHeaders = { 'content-type': 'application/json' }
    vi.mocked(getHeaders).mockReturnValue(mockHeaders)

    let drainCalled = false
    const mockHooks = {
      callHook: vi.fn().mockImplementation((hookName: string) => {
        if (hookName === 'evlog:enrich') {
          return Promise.reject(new Error('enrich boom'))
        }
        if (hookName === 'evlog:drain') {
          drainCalled = true
        }
        return Promise.resolve()
      }),
    }

    const mockEvent: ServerEvent = {
      method: 'POST',
      path: '/api/test',
      context: {},
    }

    const emittedEvent: WideEvent = {
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'test',
      environment: 'test',
    }

    await callEnrichAndDrain(asNitroApp(mockHooks), emittedEvent, mockEvent)

    expect(drainCalled).toBe(true)
    expect(consoleSpy).toHaveBeenCalledWith('[evlog] enrich failed:', expect.any(Error))
    consoleSpy.mockRestore()
  })

  it('drain errors are logged but do not throw', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mockHeaders = {}
    vi.mocked(getHeaders).mockReturnValue(mockHeaders)

    const mockHooks = {
      callHook: vi.fn().mockImplementation((hookName: string) => {
        if (hookName === 'evlog:drain') {
          return Promise.reject(new Error('drain boom'))
        }
        return Promise.resolve()
      }),
    }

    const mockEvent: ServerEvent = {
      method: 'GET',
      path: '/api/test',
      context: {},
    }

    const emittedEvent: WideEvent = {
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'test',
      environment: 'test',
    }

    // Should not throw
    await callEnrichAndDrain(asNitroApp(mockHooks), emittedEvent, mockEvent)

    await vi.waitFor(() => expect(consoleSpy).toHaveBeenCalledWith('[evlog] drain failed:', expect.any(Error)))
    consoleSpy.mockRestore()
  })

  it('handles callHook returning undefined (hookable 6, no async hooks)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getHeaders).mockReturnValue({})

    const mockHooks = {
      callHook: vi.fn().mockReturnValue(undefined),
    }

    const mockEvent: ServerEvent = {
      method: 'GET',
      path: '/api/test',
      context: {},
    }

    const emittedEvent: WideEvent = {
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'test',
      environment: 'test',
    }

    await callEnrichAndDrain(asNitroApp(mockHooks), emittedEvent, mockEvent)

    expect(mockHooks.callHook).toHaveBeenCalledWith('evlog:drain', expect.objectContaining({ event: emittedEvent }))
    expect(consoleSpy).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('enricher can mutate the event before drain receives it', async () => {
    const mockHeaders = { 'user-agent': 'TestBot/1.0' }
    vi.mocked(getHeaders).mockReturnValue(mockHeaders)

    let drainEvent: WideEvent | null = null
    const mockHooks = {
      callHook: vi.fn().mockImplementation((hookName: string, ctx: EnrichContext | DrainContext) => {
        if (hookName === 'evlog:enrich') {
          ctx.event.enriched = true
          ctx.event.customField = 'added-by-enricher'
        }
        if (hookName === 'evlog:drain') {
          drainEvent = ctx.event
        }
        return Promise.resolve()
      }),
    }

    const mockEvent: ServerEvent = {
      method: 'POST',
      path: '/api/test',
      context: {},
    }

    const emittedEvent: WideEvent = {
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'test',
      environment: 'test',
    }

    await callEnrichAndDrain(asNitroApp(mockHooks), emittedEvent, mockEvent)

    const drained = defined(drainEvent, 'drainEvent')
    expect(drained.enriched).toBe(true)
    expect(drained.customField).toBe('added-by-enricher')
  })

  it('passes headers to both enrich and drain hooks', async () => {
    const mockHeaders = {
      'content-type': 'application/json',
      'x-request-id': 'req-456',
    }
    vi.mocked(getHeaders).mockReturnValue(mockHeaders)

    let enrichHeaders: Record<string, string> | undefined
    let drainHeaders: Record<string, string> | undefined
    const mockHooks = {
      callHook: vi.fn().mockImplementation((hookName: string, ctx: EnrichContext | DrainContext) => {
        if (hookName === 'evlog:enrich') {
          enrichHeaders = ctx.headers
        }
        if (hookName === 'evlog:drain') {
          drainHeaders = ctx.headers
        }
        return Promise.resolve()
      }),
    }

    const mockEvent: ServerEvent = {
      method: 'POST',
      path: '/api/test',
      context: {},
    }

    const emittedEvent: WideEvent = {
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'test',
      environment: 'test',
    }

    await callEnrichAndDrain(asNitroApp(mockHooks), emittedEvent, mockEvent)

    expect(enrichHeaders).toEqual(mockHeaders)
    expect(drainHeaders).toEqual(mockHeaders)
  })

  it('deferDrain does not register drain on event.waitUntil', async () => {
    const mockWaitUntil = vi.fn()
    let resolveDrain!: () => void
    const slowDrain = new Promise<void>((resolve) => {
      resolveDrain = resolve
    })

    vi.mocked(getHeaders).mockReturnValue({})

    const mockHooks = {
      callHook: vi.fn().mockImplementation((hookName: string) => {
        if (hookName === 'evlog:drain') return slowDrain
        return Promise.resolve()
      }),
    }

    const mockEvent: ServerEvent = {
      method: 'GET',
      path: '/api/fail',
      context: {
        requestId: 'req-wu',
        waitUntil: mockWaitUntil,
      },
    }

    const emittedEvent: WideEvent = {
      timestamp: new Date().toISOString(),
      level: 'error',
      service: 'test',
      environment: 'test',
    }

    await callEnrichAndDrain(asNitroApp(mockHooks), emittedEvent, mockEvent, { deferDrain: true })

    expect(mockWaitUntil).not.toHaveBeenCalled()
    resolveDrain()
    await slowDrain
  })

  it('deferDrain returns before a slow drain hook completes', async () => {
    let resolveDrain!: () => void
    const slowDrain = new Promise<void>((resolve) => {
      resolveDrain = resolve
    })

    vi.mocked(getHeaders).mockReturnValue({})

    const mockHooks = {
      callHook: vi.fn().mockImplementation((hookName: string) => {
        if (hookName === 'evlog:drain') return slowDrain
        return Promise.resolve()
      }),
    }

    const mockEvent: ServerEvent = {
      method: 'GET',
      path: '/api/fail',
      context: { requestId: 'req-slow' },
    }

    const emittedEvent: WideEvent = {
      timestamp: new Date().toISOString(),
      level: 'error',
      service: 'test',
      environment: 'test',
    }

    const started = Date.now()
    await callEnrichAndDrain(asNitroApp(mockHooks), emittedEvent, mockEvent, { deferDrain: true })
    expect(Date.now() - started).toBeLessThan(100)

    resolveDrain()
    await slowDrain
  })
})
