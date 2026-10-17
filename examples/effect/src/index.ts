import { createServer } from 'node:http'
import { NodeHttpServer, NodeRuntime } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/http'
import { createError, parseError, type EnrichContext } from 'evlog'
import { EvlogLogger, initLoggerLayer, loggerLayer, routerLayer, useLogger, withLogger } from 'evlog/effect'
import { createPostHogDrain } from 'evlog/posthog'
import { testUI } from './ui'

const options = {
  drain: createPostHogDrain(),
  enrich: (ctx: EnrichContext) => {
    ctx.event.runtime = 'node'
    ctx.event.pid = process.pid
  },
}

interface UserFields {
  user: { id: string, name?: string, plan?: string, email?: string }
  orders: { count: number, totalRevenue: number }
}

const findUser = (id: string) => Effect.gen(function* () {
  const log = yield* useLogger<UserFields>()
  log.set({ user: { id } })
  const user = { id, name: 'Alice', plan: 'pro', email: 'alice@example.com' }

  const [local, domain] = user.email.split('@')
  log.set({ user: { id, name: user.name, plan: user.plan, email: `${local?.[0]}***@${domain}` } })

  const orders = [{ id: 'order_1', total: 4999 }, { id: 'order_2', total: 1299 }]
  log.set({ orders: { count: orders.length, totalRevenue: orders.reduce((sum, o) => sum + o.total, 0) } })
  return { user, orders }
})

const respondWithError = (error: unknown) => Effect.gen(function* () {
  const log = yield* EvlogLogger
  log.error(error instanceof Error ? error : String(error))
  const parsed = parseError(error)
  return HttpServerResponse.jsonUnsafe(
    { message: parsed.message, why: parsed.why, fix: parsed.fix, link: parsed.link },
    { status: parsed.status },
  )
})

const sendDigest = Effect.gen(function* () {
  const log = yield* EvlogLogger
  log.set({ digest: { recipients: 128 } })
  yield* Effect.logInfo('digest rendered')
  return { sent: 128 }
}).pipe(withLogger('send-digest', options))

const routes = Layer.mergeAll(
  HttpRouter.add('GET', '/', HttpServerResponse.html(testUI())),
  HttpRouter.add('GET', '/health', Effect.gen(function* () {
    const log = yield* EvlogLogger
    log.set({ route: 'health' })
    return HttpServerResponse.jsonUnsafe({ ok: true })
  })),
  HttpRouter.add('GET', '/users/:id', Effect.gen(function* () {
    const { id } = yield* HttpRouter.params
    return HttpServerResponse.jsonUnsafe(yield* findUser(id ?? 'unknown'))
  })),
  HttpRouter.add('GET', '/checkout', Effect.gen(function* () {
    const log = yield* EvlogLogger
    log.set({ cart: { items: 3, total: 9999 } })
    return yield* Effect.fail(createError({
      message: 'Payment failed',
      status: 402,
      why: 'Card declined by issuer',
      fix: 'Try a different card or payment method',
      link: 'https://docs.example.com/payments/declined',
    }))
  }).pipe(Effect.catch(respondWithError))),
  HttpRouter.add('POST', '/jobs/digest', Effect.map(sendDigest, result => HttpServerResponse.jsonUnsafe(result))),
)

const server = HttpRouter.serve(
  routes.pipe(Layer.provide(routerLayer({ ...options, exclude: ['/'] }))),
  { disableLogger: true },
).pipe(
  Layer.provide(NodeHttpServer.layer(createServer, { port: 3000 })),
  Layer.provide(loggerLayer()),
  Layer.provide(initLoggerLayer({ env: { service: 'effect-example' }, pretty: true })),
)

NodeRuntime.runMain(Layer.launch(server))
