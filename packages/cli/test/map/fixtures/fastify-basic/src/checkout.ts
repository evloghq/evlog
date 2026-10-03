import type { FastifyInstance } from 'fastify'

export async function checkout(app: FastifyInstance) {
  app.route({
    method: 'POST',
    url: '/checkout',
    handler: async (request) => {
      const log = request.log
      log.set({ user: { id: '123' } })
      log.audit({ action: 'checkout.completed', actor: { type: 'user', id: '123' } })
      return { ok: true }
    },
  })
}
