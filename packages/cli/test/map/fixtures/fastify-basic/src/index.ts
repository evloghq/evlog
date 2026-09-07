import Fastify from 'fastify'
import { evlog } from 'evlog/fastify'
import checkout from './checkout'
import health from './health'

const app = Fastify()

await app.register(evlog)
await app.register(checkout)
await app.register(health)

export default app
