import { Effect } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/http'
import { useLogger } from 'evlog/effect'

interface UserFields {
  user: { id: string }
}

export const UserRoute = HttpRouter.add('GET', '/users/:id', Effect.gen(function* () {
  const log = yield* useLogger<UserFields>()
  const { id } = yield* HttpRouter.params
  log.set({ user: { id: id ?? 'unknown' } })
  return HttpServerResponse.jsonUnsafe({ id })
}))
