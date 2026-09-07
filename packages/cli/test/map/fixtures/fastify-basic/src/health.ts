import type { FastifyPluginAsync } from 'fastify'

const health: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => ({ ok: true }))
}

export default health
