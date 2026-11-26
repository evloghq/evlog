import { Hono } from 'hono'
import { evlog, type EvlogVariables } from 'evlog/hono'
import { db } from '../services.ts'
import { respond } from '../respond.ts'
import { errors } from './errors.ts'

export const app = new Hono<EvlogVariables>()
app.use(evlog())

app.onError(respond)

app.get('/api/users/:id', async (c) => {
  const user = await db.findUser(c.req.param('id'))
  if (!user) {
    throw errors.USER_NOT_FOUND()
  }

  return c.json(user)
})

app.post('/api/users', async (c) => {
  const { email } = await c.req.json()
  if (!email.includes('@')) {
    throw errors.VALIDATION_FAILED({ field: 'email' })
  }

  return c.json({ ok: true })
})
