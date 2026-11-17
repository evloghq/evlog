import { HttpRouter, HttpServerResponse } from 'effect/http'

export const HealthRoutes = HttpRouter.addAll([
  HttpRouter.route('GET', '/health', HttpServerResponse.jsonUnsafe({ ok: true })),
  HttpRouter.route('*', '/ping', HttpServerResponse.text('pong')),
])
