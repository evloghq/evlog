import { Hono } from 'hono'
import { evlog, type EvlogVariables } from 'evlog/hono'

export const app = new Hono<EvlogVariables>()
app.use(evlog())

app.post('/api/users', async (c) => {
  const log = c.get('log')
  const body = await c.req.json()

  log.set({
    user: { email: body.email, phone: body.phone },
    card: { number: body.cardNumber },
    session_token: body.sessionToken,
  })

  return c.json({ ok: true })
})
