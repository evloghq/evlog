import { Effect } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/http'
import { EvlogLogger } from 'evlog/effect'

export const CheckoutRoute = HttpRouter.add('POST', '/checkout', Effect.gen(function* () {
  const log = yield* EvlogLogger
  log.set({ user: { id: '123' }, cart: { items: 3 } })
  log.audit({ action: 'checkout.completed', actor: { type: 'user', id: '123' } })
  return HttpServerResponse.jsonUnsafe({ ok: true })
}))
