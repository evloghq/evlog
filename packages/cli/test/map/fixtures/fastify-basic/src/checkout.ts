import type { FastifyPluginAsync } from 'fastify'

const checkout: FastifyPluginAsync = async (app) => {
  app.post('/checkout', async (request) => {
    request.log.set({ user: { id: '123' } })
    request.log.audit({ action: 'checkout.completed', actor: { type: 'user', id: '123' } })
    return { ok: true }
  })
}

export default checkout
