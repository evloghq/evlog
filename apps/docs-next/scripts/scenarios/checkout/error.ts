import { Hono } from 'hono'
import { createError } from 'evlog'
import { evlog, type EvlogVariables } from 'evlog/hono'
import { db, payments } from '../services.ts'
import { respond } from '../respond.ts'

export const app = new Hono<EvlogVariables>()
app.use(evlog())

app.onError(respond)

app.post('/api/checkout', async (c) => {
  const log = c.get('log')
  const { cartId } = await c.req.json()

  const cart = await db.findCart(cartId)
  log.set({ user: { id: cart.userId }, cart: { items: cart.items.length, total: cart.total } })

  const charge = await payments.charge(cart.total)
  if (!charge.success) {
    throw createError({
      status: 402,
      message: 'Payment failed',
      why: charge.declineReason,
      fix: 'Try a different payment method',
    })
  }

  return c.json({ ok: true })
})
