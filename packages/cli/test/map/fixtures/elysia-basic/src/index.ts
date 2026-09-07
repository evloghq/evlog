import { Elysia } from 'elysia'
import { evlog } from 'evlog/elysia'

const app = new Elysia()
  .use(evlog())
  .get('/health', () => ({ ok: true }))
  .post('/checkout', ({ log }) => {
    log.set({ user: { id: '123' } })
    log.audit({ action: 'checkout.completed', actor: { type: 'user', id: '123' } })
    return { ok: true }
  })

export default app
