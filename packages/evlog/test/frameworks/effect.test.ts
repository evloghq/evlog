import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context, Effect, Layer, Schema } from 'effect'
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from 'effect/http'
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { createError } from '../../src/error'
import { initLogger } from '../../src/logger'
import type { EvlogEffectOptions } from '../../src/effect/index'
import { WaitUntil, EvlogLogger, routerLayer, useLogger, withRequestLogger } from '../../src/effect/index'
import {
  assertHttpEventEmitted,
  assertSensitiveHeadersFiltered,
  createPipelineSpies,
  findEventViaDrain,
  waitForDrainCalls,
} from '../helpers/framework'
import { defined, getDrainCallArg } from '../helpers/defined'
import { describeStandardHttpMatrix } from '../helpers/frameworkMatrix'

type Routes = Layer.Layer<
  never,
  never,
  HttpRouter.HttpRouter | HttpRouter.Request<'Requires', EvlogLogger> | HttpRouter.Request<'Error', unknown>
>

function mount(routes: Routes, options: EvlogEffectOptions = {}) {
  return HttpRouter.toWebHandler(Layer.provide(routes, routerLayer(options)), { disableLogger: true })
}

const usersRoute = HttpRouter.add('GET', '/api/users', HttpServerResponse.json({ users: [] }))

describeStandardHttpMatrix({
  name: 'effect',
  mount(options) {
    const { handler, dispose } = mount(usersRoute, options)
    return Promise.resolve({
      async fire(req) {
        const res = await handler(new Request(`http://localhost${req.path}`, {
          method: req.method || 'GET',
          headers: req.headers,
        }))
        return { status: res.status }
      },
      cleanup: dispose,
    })
  },
})

describe('evlog/effect http middleware', () => {
  beforeEach(() => {
    initLogger({ env: { service: 'effect-test' }, pretty: false })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('provides the wide event to handlers and drains their fields', async () => {
    const { drain } = createPipelineSpies()
    const { handler, dispose } = mount(HttpRouter.add('GET', '/api/checkout', Effect.gen(function* () {
      const log = yield* EvlogLogger
      log.set({ cart: { items: 3 } })
      const typed = yield* useLogger<{ user: { id: string } }>()
      typed.set({ user: { id: 'u_1' } })
      return HttpServerResponse.text('ok')
    })), { drain })

    await handler(new Request('http://localhost/api/checkout'))
    await dispose()
    await waitForDrainCalls(drain)

    const event = assertHttpEventEmitted(drain, { path: '/api/checkout', method: 'GET', status: 200, level: 'info' })
    expect(event.cart).toEqual({ items: 3 })
    expect(event.user).toEqual({ id: 'u_1' })
  })

  it('records a handler failure with the status the client received', async () => {
    const { drain } = createPipelineSpies()
    const { handler, dispose } = mount(HttpRouter.add('POST', '/api/pay', Effect.fail(createError({
      message: 'Payment declined',
      status: 402,
      why: 'Card expired',
    }))), { drain })

    const res = await handler(new Request('http://localhost/api/pay', { method: 'POST' }))
    await dispose()
    await waitForDrainCalls(drain)

    expect(res.status).toBe(500)
    const event = assertHttpEventEmitted(drain, { path: '/api/pay', method: 'POST', status: 500, level: 'error' })
    expect(event.error).toMatchObject({ message: 'Payment declined', why: 'Card expired' })
  })

  it('uses the status of a respondable failure, such as a missing route', async () => {
    const { drain } = createPipelineSpies()
    const { handler, dispose } = mount(usersRoute, { drain })

    const res = await handler(new Request('http://localhost/api/missing'))
    await dispose()
    await waitForDrainCalls(drain)

    expect(res.status).toBe(404)
    const event = assertHttpEventEmitted(drain, { path: '/api/missing', status: 404, level: 'error' })
    expect(defined(event.error, 'error')).toMatchObject({ name: 'HttpServerError' })
  })

  it('filters sensitive headers out of the drain context', async () => {
    const { drain } = createPipelineSpies()
    const { handler, dispose } = mount(usersRoute, { drain })

    await handler(new Request('http://localhost/api/users', {
      headers: { 'authorization': 'Bearer secret', 'cookie': 'sid=1', 'user-agent': 'vitest' },
    }))
    await dispose()
    await waitForDrainCalls(drain)

    assertSensitiveHeadersFiltered(getDrainCallArg(defined(drain.mock.calls[0], 'drain call')))
  })

  it('runs excluded routes against a no-op logger and emits nothing', async () => {
    const { drain } = createPipelineSpies()
    const { handler, dispose } = mount(HttpRouter.add('GET', '/health', Effect.gen(function* () {
      const log = yield* EvlogLogger
      log.set({ probe: true })
      return HttpServerResponse.text('ok')
    })), { drain, exclude: ['/health'] })

    const res = await handler(new Request('http://localhost/health'))
    await dispose()

    expect(res.status).toBe(200)
    expect(drain).not.toHaveBeenCalled()
  })

  it('reads the request body without copying it into the wide event', async () => {
    const { drain } = createPipelineSpies()
    const { handler, dispose } = mount(HttpRouter.add('POST', '/api/chat', Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const body = yield* request.json
      const log = yield* EvlogLogger
      log.set({ chat: { messages: (body as { messages: unknown[] }).messages.length } })
      return HttpServerResponse.text('ok')
    })), { drain })

    await handler(new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'secret prompt text', messages: [{ content: 'private message body' }] }),
    }))
    await dispose()
    await waitForDrainCalls(drain)

    const event = defined(findEventViaDrain(drain, e => e.path === '/api/chat'), 'chat event')
    expect(event.chat).toEqual({ messages: 1 })
    expect(JSON.stringify(event)).not.toMatch(/secret prompt text|private message body/)
  })

  it('registers drains with the request waitUntil from the handler context', async () => {
    let releaseDrain!: () => void
    const drained = new Promise<void>((resolve) => {
      releaseDrain = resolve
    })
    const drain = vi.fn(() => drained)
    const waitUntil = vi.fn<(promise: Promise<unknown>) => void>()
    const { handler, dispose } = mount(usersRoute, { drain })

    const res = await handler(
      new Request('http://localhost/api/users'),
      Context.make(WaitUntil, waitUntil),
    )

    expect(res.status).toBe(200)
    expect(drain).toHaveBeenCalledTimes(1)
    expect(waitUntil).toHaveBeenCalled()
    releaseDrain()
    await Promise.all(waitUntil.mock.calls.map(([promise]) => promise))
    await dispose()
  })
})

class UserNotFound extends Schema.TaggedError<UserNotFound>()('UserNotFound', {}, { httpApiStatus: 404 }) {}

class UsersApi extends HttpApi.make('users-api').add(
  HttpApiGroup.make('users').add(
    HttpApiEndpoint.get('getById', '/users/:id', {
      params: { id: Schema.String },
      success: Schema.Struct({ id: Schema.String }),
      error: UserNotFound,
    }),
  ),
) {}

const usersHandlers = HttpApiBuilder.group(UsersApi, 'users', handlers => handlers.handle('getById', ({ params }) =>
  Effect.gen(function* () {
    const log = yield* EvlogLogger
    log.set({ user: { id: params.id } })
    if (params.id === 'missing') return yield* new UserNotFound()
    if (params.id === 'crash') return yield* Effect.die(new Error('database unavailable'))
    return { id: params.id }
  })))

describe('evlog/effect HttpApi', () => {
  beforeEach(() => {
    initLogger({ env: { service: 'effect-test' }, pretty: false })
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function mountApi(options: EvlogEffectOptions) {
    return HttpRouter.toWebHandler(
      HttpApiBuilder.layer(UsersApi).pipe(
        Layer.provide(usersHandlers),
        Layer.provide(routerLayer(options)),
        Layer.provide(HttpServer.layerServices),
      ),
      { disableLogger: true },
    )
  }

  it('emits one event per HttpApi request without a Hono wrapper', async () => {
    const { drain } = createPipelineSpies()
    const { handler, dispose } = mountApi({ drain })

    const res = await handler(new Request('http://localhost/users/u_1'))
    await dispose()
    await waitForDrainCalls(drain)

    expect(res.status).toBe(200)
    const event = assertHttpEventEmitted(drain, { path: '/users/u_1', method: 'GET', status: 200, level: 'info' })
    expect(event.user).toEqual({ id: 'u_1' })
  })

  it('records the status of a declared API error, which HttpApi encodes as a response', async () => {
    const { drain } = createPipelineSpies()
    const { handler, dispose } = mountApi({ drain })

    const res = await handler(new Request('http://localhost/users/missing'))
    await dispose()
    await waitForDrainCalls(drain)

    expect(res.status).toBe(404)
    const event = assertHttpEventEmitted(drain, { path: '/users/missing', status: 404 })
    expect(event.user).toEqual({ id: 'missing' })
  })

  it('records an unexpected defect as the error of the request', async () => {
    const { drain } = createPipelineSpies()
    const { handler, dispose } = mountApi({ drain })

    const res = await handler(new Request('http://localhost/users/crash'))
    await dispose()
    await waitForDrainCalls(drain)

    expect(res.status).toBe(500)
    const event = assertHttpEventEmitted(drain, { path: '/users/crash', status: 500, level: 'error' })
    expect(event.error).toMatchObject({ message: 'database unavailable' })
  })
})

describe('evlog/effect withRequestLogger', () => {
  beforeEach(() => {
    initLogger({ env: { service: 'effect-test' }, pretty: false })
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emits one event for a Fetch handler with the response status', async () => {
    const { drain } = createPipelineSpies()
    const request = new Request('http://do/rooms/1/join', { method: 'POST', headers: { 'x-request-id': 'req-1' } })

    const res = await Effect.runPromise(Effect.gen(function* () {
      const log = yield* EvlogLogger
      log.set({ room: { id: '1' } })
      return new Response('joined', { status: 201 })
    }).pipe(withRequestLogger(request, { drain })))
    await waitForDrainCalls(drain)

    expect(res.status).toBe(201)
    const event = assertHttpEventEmitted(drain, { path: '/rooms/1/join', method: 'POST', status: 201, level: 'info' })
    expect(event.requestId).toBe('req-1')
    expect(event.room).toEqual({ id: '1' })
  })

  it('takes the status of a failure from the error', async () => {
    const { drain } = createPipelineSpies()
    const request = new Request('http://do/rooms/2')

    const exit = await Effect.runPromiseExit(
      Effect.fail(createError({ message: 'Room is full', status: 409 })).pipe(withRequestLogger(request, { drain })),
    )
    await waitForDrainCalls(drain)

    expect(exit._tag).toBe('Failure')
    assertHttpEventEmitted(drain, { path: '/rooms/2', status: 409, level: 'error' })
  })
})
