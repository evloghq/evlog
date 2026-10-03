import Fastify from 'fastify'
import { evlog } from 'evlog/fastify'
import { checkout } from './checkout'

const app = Fastify({ logger: false })

await app.register(evlog)
await app.register(checkout)

app.get('/health', async () => ({ ok: true }))

export default app
