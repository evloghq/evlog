import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { createError, parseError } from 'evlog'
import { evlog, type EvlogVariables } from 'evlog/hono'
import { db } from '../services.ts'

export const app = new Hono<EvlogVariables>()
app.use(evlog())

app.onError((error, c) => {
  const parsed = parseError(error)

  return c.json(
    {
      message: parsed.message,
      why: parsed.why,
      fix: parsed.fix,
      link: parsed.link,
    },
    parsed.status as ContentfulStatusCode,
  )
})

app.get('/users/:id', async (c) => {
  const log = c.get('log')
  const userId = c.req.param('id')

  const user = await db.findUser(userId)
  if (!user) {
    throw createError({
      status: 404,
      message: 'User not found',
      why: `No user has the id ${userId}`,
      fix: 'Check the id in the URL',
    })
  }
  log.set({ user: { id: userId, plan: user.plan } })

  return c.json(user)
})
