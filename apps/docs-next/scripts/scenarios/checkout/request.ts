import { Hono } from 'hono'
import { evlog, type EvlogVariables } from 'evlog/hono'

export const app = new Hono<EvlogVariables>()
app.use(evlog())

app.post('/api/checkout', c => c.json({ ok: true }))
