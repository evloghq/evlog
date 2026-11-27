import { Hono } from 'hono'
import { evlog, type EvlogVariables } from 'evlog/hono'

export const app = new Hono<EvlogVariables>()
app.use(evlog())

app.post('/api/users', c => c.json({ ok: true }))
app.post('/api/payments/charge', c => c.json({ ok: true }))
