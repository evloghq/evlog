import { Hono } from 'hono'
import { createError } from 'evlog'
import { evlog, type EvlogVariables } from 'evlog/hono'
import { db } from '../services.ts'
import { respond } from '../respond.ts'

export const app = new Hono<EvlogVariables>()
app.use(evlog())

app.onError(respond)

app.get('/api/users/:id', async (c) => {
  const user = await db.findUser(c.req.param('id'))
  if (!user) {
    throw createError({ status: 404, message: 'User not found' })
  }

  return c.json(user)
})
