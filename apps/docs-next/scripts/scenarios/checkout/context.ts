import { Hono } from 'hono'
import { evlog, type EvlogVariables } from 'evlog/hono'
import { db } from '../services.ts'

export const app = new Hono<EvlogVariables>()
app.use(evlog())

app.post('/api/checkout', async (c) => {
  const log = c.get('log')
  const { cartId } = await c.req.json()

  const cart = await db.findCart(cartId)
  log.set({ user: { id: cart.userId }, cart: { items: cart.items.length, total: cart.total } })

  return c.json({ ok: true })
})
