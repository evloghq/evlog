import { indent } from '../../map/utils'
import { defineFramework } from '../types'
import type { InitPlanner, MapAdapter } from '../types'

export const effect = defineFramework({
  id: 'effect',
  label: 'Effect',
  docs: '/integrate/frameworks/effect',
  /* Lowest priority: an app on Next, Hono or another framework that also uses
     Effect keeps its framework. Effect 3 serves HTTP from `@effect/platform`,
     which Effect 4 folded into `effect/http`, and `evlog/effect` needs 4. */
  detect: { deps: ['effect'], unlessDeps: ['@effect/platform'], specificity: 5 },
  accessor: '`yield* EvlogLogger`, or `yield* useLogger<Fields>()` for typed fields, from `evlog/effect` inside the handler effect',
  requestLogger: 'explicit',
  shape: {
    loggerCall: 'const log = yield* EvlogLogger',
    handler(route, body) {
      return [
        `HttpRouter.add('${route.method ?? '*'}', '${route.path}', Effect.gen(function* () {`,
        ...body.map(line => indent(1, line)),
        '}))',
      ]
    },
  },
  map: (): Promise<MapAdapter> => import('./map').then(module => module.default),
  init: (): Promise<InitPlanner> => import('./init').then(module => module.default),
})
