import { Hono } from 'hono'
import { evlog, type EvlogVariables } from 'evlog/hono'
import { db } from '../services.ts'

export const app = new Hono<EvlogVariables>()
app.use(evlog())

app.get('/users/:id', async (c) => {
  const log = c.get('log')
  const userId = c.req.param('id')

  const user = await db.findUser(userId)
  log.set({ user: { id: userId, plan: user.plan } })

  return c.json(user)
})
