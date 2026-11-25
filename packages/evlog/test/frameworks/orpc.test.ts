import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { os } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { RPCLink } from '@orpc/client/fetch'
import { createORPCClient, isDefinedError } from '@orpc/client'
import { initLogger } from '../../src/logger'
import { defineErrorCatalog } from '../../src/catalog'
import { createError } from '../../src/error'
import {
  evlog,
  type EvlogOrpcContext,
  type EvlogOrpcOptions,
  useLogger,
  withEvlog,
} from '../../src/orpc/index'
import {
  assertDrainCalledWith,
  assertEnrichBeforeDrain,
  assertHttpEventEmitted,
  assertSensitiveHeadersFiltered,
  createPipelineSpies,
  findEventViaDrain,
  waitForDrainCalls,
} from '../helpers/framework'
import { AUDIT_PATH, EXCLUDED_AUDIT_PATH, describeStandardHttpMatrix, recordMatrixAudits } from '../helpers/frameworkMatrix'

interface ProcedureContext extends EvlogOrpcContext {
  pingTrace?: { sawLogger: boolean, fromUseLogger: boolean }
}

const billingErrors = defineErrorCatalog('billing', {
  PAYMENT_DECLINED: {
    status: 402,
    message: 'Payment declined',
    why: 'Issuer declined the charge',
    fix: 'Try a different card',
    link: 'https://docs.example.com/payments/declined',
  },
})

function buildRouter(trace?: { sawLogger: boolean, fromUseLogger: boolean }) {
  const base = os.$context<ProcedureContext>().use(evlog())

  return {
    ping: base.handler(({ context }) => {
      if (trace) {
        trace.sawLogger = typeof context.log?.set === 'function'
        try {
          const fromAls = useLogger()
          trace.fromUseLogger = fromAls === context.log
        } catch {
          trace.fromUseLogger = false
        }
      }
      context.log.set({ pinged: true })
      return { ok: true as const }
    }),
    fail: base.handler(() => {
      throw new Error('procedure exploded')
    }),
    profile: base.handler(({ context }) => {
      context.log.set({ user: { id: 'u-1', plan: 'pro' } })
      return { id: 'u-1' as const, plan: 'pro' as const }
    }),
    pay: base.handler(() => {
      throw billingErrors.PAYMENT_DECLINED()
    }),
    payAdHoc: base.handler(() => {
      throw createError({
        message: 'Card declined',
        code: 'PAYMENT_DECLINED',
        status: 402,
        why: 'Adhoc card declined',
        fix: 'Adhoc fix',
        link: 'https://example.com/adhoc',
      })
    }),
    payNoCode: base.handler(() => {
      throw createError({ message: 'Boom', status: 418, why: 'Just because' })
    }),
    payWithData: base.handler(() => {
      throw createError({
        message: 'Card declined',
        code: 'PAYMENT_DECLINED',
        status: 402,
        why: 'Adhoc card declined',
        data: { orderId: 'ord_1', retryable: true },
      })
    }),
  }
}

type Router = ReturnType<typeof buildRouter>

function buildClient(options: EvlogOrpcOptions = {}, trace?: { sawLogger: boolean, fromUseLogger: boolean }) {
  const router = buildRouter(trace)
  const handler = withEvlog(new RPCHandler<ProcedureContext>(router), options)

  const link = new RPCLink({
    url: 'http://test/rpc',
    fetch: async (input, init) => {
      const request = new Request(input, init)
      const { matched, response } = await handler.handle(request, {
        prefix: '/rpc',
        context: {} as ProcedureContext,
      })
      return matched ? response : new Response('Not Found', { status: 404 })
    },
  })

  return {
    handler,
    client: createORPCClient<Router>(link),
  }
}

describe('evlog/orpc', () => {
  beforeEach(() => {
    initLogger({ env: { service: 'orpc-test' }, pretty: false })
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('handler wrapper', () => {
    it('exposes the request logger as context.log inside the procedure', async () => {
      const trace = { sawLogger: false, fromUseLogger: false }
      const { client } = buildClient({}, trace)

      const result = await client.ping({})
      expect(result).toEqual({ ok: true })
      expect(trace.sawLogger).toBe(true)
    })

    it('emits a wide event with method, path, status', async () => {
      const { drain } = createPipelineSpies()
      const { client } = buildClient({ drain })

      await client.ping({})
      await waitForDrainCalls(drain)

      const event = assertHttpEventEmitted(drain, { path: '/rpc/ping', status: 200, level: 'info' })
      expect(event.duration).toBeDefined()
      expect(event.method).toBe('POST')
    })

    it('captures context set by the procedure handler', async () => {
      const { drain } = createPipelineSpies()
      const { client } = buildClient({ drain })

      await client.profile({})
      await waitForDrainCalls(drain)

      const event = findEventViaDrain(drain, e => e.path === '/rpc/profile')
      expect(event).toBeDefined()
      expect(event!.user).toEqual({ id: 'u-1', plan: 'pro' })
    })

    it('logs at error level when a procedure throws', async () => {
      const { drain } = createPipelineSpies()
      const { client } = buildClient({ drain })

      await expect(client.fail({})).rejects.toBeDefined()
      await waitForDrainCalls(drain)

      const event = findEventViaDrain(drain, e => e.path === '/rpc/fail')
      expect(event).toBeDefined()
      expect(event!.level).toBe('error')
    })

    it('emits status 404 when the request does not match any procedure', async () => {
      const { drain } = createPipelineSpies()
      const router = buildRouter()
      const handler = withEvlog(new RPCHandler<ProcedureContext>(router), { drain })

      await handler.handle(
        new Request('http://test/rpc/unknown', { method: 'POST', body: '{}' }),
        { prefix: '/rpc', context: {} as ProcedureContext },
      )
      await waitForDrainCalls(drain)

      const event = findEventViaDrain(drain, e => e.path === '/rpc/unknown')
      expect(event).toBeDefined()
      expect(event!.status).toBe(404)
    })

    it('preserves the underlying handler identity (Proxy passthrough)', () => {
      const router = buildRouter()
      const original = new RPCHandler<ProcedureContext>(router)
      const wrapped = withEvlog(original)
      expect(wrapped).not.toBe(original)
      expect(wrapped.handle).toBeDefined()
      expect(wrapped instanceof RPCHandler).toBe(true)
    })

    it('honors x-request-id when present on the request', async () => {
      const { drain } = createPipelineSpies()
      const router = buildRouter()
      const handler = withEvlog(new RPCHandler<ProcedureContext>(router), { drain })

      const link = new RPCLink({
        url: 'http://test/rpc',
        headers: () => ({ 'x-request-id': 'rid-orpc-42' }),
        fetch: async (input, init) => {
          const request = new Request(input, init)
          const { matched, response } = await handler.handle(request, {
            prefix: '/rpc',
            context: {} as ProcedureContext,
          })
          return matched ? response : new Response('Not Found', { status: 404 })
        },
      })
      const client = createORPCClient<Router>(link)

      await client.ping({})
      await waitForDrainCalls(drain)

      const event = findEventViaDrain(drain, e => e.path === '/rpc/ping')
      expect(event).toBeDefined()
      expect(event!.requestId).toBe('rid-orpc-42')
    })
  })

  describe('procedure middleware', () => {
    it('adds operation = procedure path on the wide event', async () => {
      const { drain } = createPipelineSpies()
      const { client } = buildClient({ drain })

      await client.ping({})
      await waitForDrainCalls(drain)

      const event = findEventViaDrain(drain, e => e.path === '/rpc/ping')
      expect(event).toBeDefined()
      expect(event!.operation).toBe('ping')
    })

    it('does not throw when context.log is missing', async () => {
      const middleware = evlog()
      const next = vi.fn(() => Promise.resolve({ output: undefined, context: {} }))
      await expect(
        middleware({
          context: {} as ProcedureContext,
          next: next as never,
          path: ['nested', 'op'],
          procedure: {} as never,
          errors: {} as never,
          lastEventId: undefined,
        }),
      ).resolves.toBeDefined()
      expect(next).toHaveBeenCalledOnce()
    })
  })

  describe('evlog error catalog → ORPCError bridge', () => {
    it('preserves catalog code, status, message, and why/fix/link in data', async () => {
      const { drain } = createPipelineSpies()
      const { client } = buildClient({ drain })

      const result = await client.pay({}).catch(err => err)
      expect(result).toBeInstanceOf(Error)
      expect(isDefinedError(result)).toBe(false)
      expect(result.code).toBe('billing.PAYMENT_DECLINED')
      expect(result.status).toBe(402)
      expect(result.message).toBe('Payment declined')
      expect(result.data).toEqual({
        why: 'Issuer declined the charge',
        fix: 'Try a different card',
        link: 'https://docs.example.com/payments/declined',
      })

      await waitForDrainCalls(drain)
      const event = findEventViaDrain(drain, e => e.path === '/rpc/pay')
      expect(event).toBeDefined()
      expect(event!.level).toBe('error')
      expect(event!.status).toBe(402)
      expect(event!.error).toMatchObject({ code: 'billing.PAYMENT_DECLINED' })
    })

    it('does not wrap non-EvlogError throws (lets oRPC handle them)', async () => {
      const { drain } = createPipelineSpies()
      const { client } = buildClient({ drain })

      const result = await client.fail({}).catch(err => err)
      // Generic Error becomes oRPC's INTERNAL_SERVER_ERROR
      expect(result.code).toBe('INTERNAL_SERVER_ERROR')

      await waitForDrainCalls(drain)
      const event = findEventViaDrain(drain, e => e.path === '/rpc/fail')
      expect(event!.level).toBe('error')
    })

    it('bridges ad-hoc createError() the same way as a catalog factory', async () => {
      const { drain } = createPipelineSpies()
      const { client } = buildClient({ drain })

      const result = await client.payAdHoc({}).catch(err => err)
      expect(result.code).toBe('PAYMENT_DECLINED')
      expect(result.status).toBe(402)
      expect(result.message).toBe('Card declined')
      expect(result.data).toEqual({
        why: 'Adhoc card declined',
        fix: 'Adhoc fix',
        link: 'https://example.com/adhoc',
      })

      await waitForDrainCalls(drain)
      const event = findEventViaDrain(drain, e => e.path === '/rpc/payAdHoc')
      expect(event!.level).toBe('error')
      expect(event!.status).toBe(402)
    })

    it('forwards the createError() data payload without the code', async () => {
      const { client } = buildClient()

      const result = await client.payWithData({}).catch(err => err)
      expect(result.code).toBe('PAYMENT_DECLINED')
      expect(result.data).toEqual({
        why: 'Adhoc card declined',
        orderId: 'ord_1',
        retryable: true,
      })
    })

    it('falls back to EVLOG_ERROR code when createError() omits code', async () => {
      const { client } = buildClient()

      const result = await client.payNoCode({}).catch(err => err)
      expect(result.code).toBe('EVLOG_ERROR')
      expect(result.status).toBe(418)
      expect(result.message).toBe('Boom')
      expect(result.data).toEqual({ why: 'Just because' })
    })
  })

  describe('useLogger() ALS access', () => {
    it('returns the same logger as context.log inside a procedure', async () => {
      const trace = { sawLogger: false, fromUseLogger: false }
      const { client } = buildClient({}, trace)

      await client.ping({})
      expect(trace.fromUseLogger).toBe(true)
    })

    it('throws when called outside of a wrapped handler', () => {
      expect(() => useLogger()).toThrow(/oRPC handler/)
    })
  })

  describe('route filtering', () => {
    it('skips drain when the route is excluded', async () => {
      const { drain } = createPipelineSpies()
      const { client } = buildClient({ drain, exclude: ['/rpc/ping'] })

      await client.ping({})

      expect(drain).not.toHaveBeenCalled()
    })

    it('only emits when the include pattern matches', async () => {
      const { drain } = createPipelineSpies()
      const { client } = buildClient({ drain, include: ['/rpc/profile'] })

      await client.ping({})
      await client.profile({})
      await waitForDrainCalls(drain)

      const events = drain.mock.calls.map(c => (c[0] as { event: { path: string } }).event.path)
      expect(events).toContain('/rpc/profile')
      expect(events).not.toContain('/rpc/ping')
    })
  })

  describe('drain / enrich / keep / headers', () => {
    it('calls drain with the emitted event', async () => {
      const { drain } = createPipelineSpies()
      const { client } = buildClient({ drain })

      await client.ping({})
      await waitForDrainCalls(drain)

      assertDrainCalledWith(drain, { path: '/rpc/ping', method: 'POST', level: 'info', status: 200 })
    })

    it('calls enrich before drain', async () => {
      const { drain, enrich } = createPipelineSpies()
      enrich.mockImplementation((ctx) => {
        ctx.event.enriched = true
      })
      const { client } = buildClient({ drain, enrich })

      await client.ping({})
      await waitForDrainCalls(drain)

      assertEnrichBeforeDrain(enrich, drain)
      expect((drain.mock.calls[0][0] as { event: { enriched?: boolean } }).event.enriched).toBe(true)
    })

    it('filters sensitive headers from the drain context', async () => {
      const { drain } = createPipelineSpies()
      const router = buildRouter()
      const handler = withEvlog(new RPCHandler<ProcedureContext>(router), { drain })

      const link = new RPCLink({
        url: 'http://test/rpc',
        headers: () => ({
          'authorization': 'Bearer secret',
          'cookie': 'session=abc',
          'x-safe': 'visible',
        }),
        fetch: async (input, init) => {
          const request = new Request(input, init)
          const { matched, response } = await handler.handle(request, {
            prefix: '/rpc',
            context: {} as ProcedureContext,
          })
          return matched ? response : new Response('Not Found', { status: 404 })
        },
      })
      const client = createORPCClient<Router>(link)

      await client.ping({})
      await waitForDrainCalls(drain)

      const ctx = drain.mock.calls[0][0] as Parameters<typeof assertSensitiveHeadersFiltered>[0]
      assertSensitiveHeadersFiltered(ctx)
      expect(ctx.headers!['x-safe']).toBe('visible')
    })

    it('lets the keep callback force-keep based on context', async () => {
      initLogger({ env: { service: 'orpc-test' }, pretty: false, sampling: { rates: { info: 0 } } })
      const { drain, keep } = createPipelineSpies()
      let sawPinged = false
      keep.mockImplementation((ctx) => {
        if (ctx.context.pinged) {
          ctx.shouldKeep = true
          sawPinged = true
        }
      })
      const { client } = buildClient({ drain, keep })

      await client.ping({})
      await waitForDrainCalls(drain)

      expect(keep).toHaveBeenCalledOnce()
      expect(sawPinged).toBe(true)
      expect(drain).toHaveBeenCalledOnce()
    })

    it('does not break the request when drain throws', async () => {
      const drain = vi.fn(() => {
        throw new Error('drain exploded')
      })
      const { client } = buildClient({ drain })

      const result = await client.ping({})

      expect(result).toEqual({ ok: true })
      expect(drain).toHaveBeenCalledOnce()
    })
  })
})

describeStandardHttpMatrix({
  name: 'orpc',
  mount(options) {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const base = os.$context<EvlogOrpcContext>().use(evlog())
    const audit = base.route({ method: 'GET' }).handler(async ({ context }) => {
      await recordMatrixAudits(context.log)
      return { ok: true }
    })
    const handler = withEvlog(new RPCHandler({
      users: base.route({ method: 'GET' }).handler(() => ({ users: [] })),
      [AUDIT_PATH.slice('/api/'.length)]: audit,
      [EXCLUDED_AUDIT_PATH.slice('/api/'.length)]: audit,
    }), options)
    return Promise.resolve({
      async fire({ method, path, headers }) {
        const { response } = await handler.handle(new Request(`http://localhost${path}`, { method, headers }), { prefix: '/api' })
        return { status: response?.status ?? 404 }
      },
      cleanup() {
        vi.restoreAllMocks()
        return Promise.resolve()
      },
    })
  },
})
