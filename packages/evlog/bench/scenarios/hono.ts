import { Hono } from 'hono'
import { initLogger } from 'evlog'
import { evlog } from 'evlog/hono'

initLogger({ env: { service: 'my-app' } })

const app = new Hono()
app.use(evlog())

export default app
