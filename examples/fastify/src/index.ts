import Fastify from 'fastify'
import { createError, initLogger, parseError, type EnrichContext } from 'evlog'
import { evlog, useLogger } from 'evlog/fastify'
import { createPostHogDrain } from 'evlog/posthog'
import { testUI } from './ui'

initLogger({
  env: { service: 'fastify-example' },
  pretty: true,
})

function findUserWithOrders(userId: string) {
  const log = useLogger()

  log.set({ user: { id: userId } })
  const user = { id: userId, name: 'Alice', plan: 'pro', email: 'alice@example.com' }

  const [local, domain] = user.email.split('@')
  log.set({ user: { name: user.name, plan: user.plan, email: `${local[0]}***@${domain}` } })

  const orders = [{ id: 'order_1', total: 4999 }, { id: 'order_2', total: 1299 }]
  log.set({ orders: { count: orders.length, totalRevenue: orders.reduce((sum, o) => sum + o.total, 0) } })

  return { user, orders }
}

const app = Fastify({ logger: false })

await app.register(evlog, {
  drain: createPostHogDrain(),
  enrich: (ctx: EnrichContext) => {
    ctx.event.runtime = 'node'
    ctx.event.pid = process.pid
  },
})

app.get('/', async (_request, reply) => {
  reply.type('text/html').send(testUI())
})

app.get('/health', async (request) => {
  request.evlog.set({ route: 'health' })
  return { ok: true }
})

app.get('/users/:id', async (request) => {
  const { id } = request.params as { id: string }
  const result = findUserWithOrders(id)
  return result
})

app.get('/checkout', async (_request, reply) => {
  const error = createError({
    message: 'Payment failed',
    status: 402,
    why: 'Card declined by issuer',
    fix: 'Try a different card or payment method',
    link: 'https://docs.example.com/payments/declined',
  })
  const parsed = parseError(error)
  reply.status(parsed.status).send({
    message: parsed.message,
    why: parsed.why,
    fix: parsed.fix,
    link: parsed.link,
  })
})

await app.listen({ port: 3000, host: '0.0.0.0' })
console.log('Fastify server started on http://localhost:3000')
